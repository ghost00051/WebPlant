# RUNBOOK.md — эксплуатация и инциденты WebPlant

Практические действия при сбоях Backend 1.2.6 и связанной инфраструктуры. Роли, каналы
связи и коммуникация — в `INCIDENT-RUNBOOK.md`; порядок плановых выкладок — в `DEPLOY.md`;
реестр секретов — в `SECRETS.md`.

Ответственный за реагирование и решения — **владелец продукта** (роль). Иных телефонов,
почт и «дежурных» в документе намеренно нет: контакт один — владелец продукта, канал
согласуется при инциденте (`INCIDENT-RUNBOOK.md`).

## 1. Первые 5 минут: 5xx и общая диагностика

### 1.1 Что проверить в первую очередь

```powershell
# 1) процесс жив?
curl.exe -s -o NUL -w "%{http_code}`n" https://server.checktheplants.ru/livez

# 2) БД и подсистемы
curl.exe -s https://server.checktheplants.ru/health

# 3) какой стек отвечает
curl.exe -s https://server.checktheplants.ru/health | Select-String -Pattern "deployTarget|backgroundJobs|redis|mail|push"
```

Поле `status` в `/health`:

| Ответ | Значение |
| --- | --- |
| `200 {"status":"ok",...}` | БД доступна, сервис готов обслуживать запросы |
| `503 {"status":"unavailable"}` | `sequelize.authenticate()` не прошёл — см. §2 |
| нет ответа / `502` / `504` | проблема в nginx/gateway или контейнер/поды не запущены |

### 1.2 Логи

```powershell
# compose
docker compose -f Backend/docker-compose.yml ps
docker compose -f Backend/docker-compose.yml logs --tail=200 backend
docker compose -f Backend/docker-compose.yml logs --tail=100 nginx

# kubernetes
kubectl get pods -n webplant -o wide
kubectl logs -n webplant deployment/backend --tail=200
kubectl logs -n webplant deployment/backend --previous --tail=100   # упавший под
kubectl describe pod -n webplant -l app=webplant-backend
```

В логах backend ищите маркеры:

| Маркер | Что означает |
| --- | --- |
| `health_check_failed` | `/health` не смог подключиться к БД |
| `unhandled_error` | необработанное исключение в запросе (обработчик вернул `500`) |
| `❌ Ошибка при запуске сервера:` + `Database schema is missing required tables or columns` | не применены миграции (см. `DEPLOY.md` §2) |
| `⚠️ Redis недоступен` / `Redis:` | деградация Redis (§3) |
| `⚠️ YANDEX_CLOUD_FOLDER или YANDEX_CLOUD_API_KEY не заданы` | ИИ отключён (§6) |
| `⚠️ SMTP не настроен` | письма не отправляются (§6) |
| `❌ Ошибка отправки push-рассылки` / `планировщика` | сбой фоновых задач |
| `⚠️ Не удалось очистить журнал действий администраторов` | `purge_admin_audit_logs()` не выполнилась (журнал `admin_audit_logs` растёт) |

### 1.3 Типовые причины 5xx

| Симптом | Проверка | Действие |
| --- | --- | --- |
| `503` на `/health` и на всех `/api/*` | `docker compose ps postgres`, `pg_isready` | §2 |
| `500` на конкретном эндпоинте | логи с `unhandled_error`, время запроса | откатить последний релиз (`DEPLOY.md` §7), сохранить логи |
| `429` вместо `200` | `ctp:rl:*` в Redis, лимиты в `ARCHITECTURE.md` §7 | дождаться окна либо снизить лимит осознанно (код) |
| `413` на загрузке фото | размер файла > 5 МБ | попросить фото меньшего размера |
| `415` на POST | клиент не прислал `Content-Type` | исправить клиент |
| `403 «Запрос с этого источника запрещён»` | origin не в allowlist, нет `Origin` при cookie | проверить `FRONTEND_URL`/`ADMIN_PANEL_ORIGIN` |
| `502/504` от nginx | `docker compose logs nginx`, живость upstream (`backend:5000` или `ctp_k8s_gateway:8090`) | поднять upstream, проверить режим `switch-traffic` |

Если причина не ясна за 15 минут — эскалация по `INCIDENT-RUNBOOK.md`, при необходимости
откат релиза (`DEPLOY.md` §7).

### 1.4 Метрики и журнал действий

```powershell
# HTTP-метрики процесса (администратор): по статусам, методам, маршрутам, латентности
curl.exe -s https://server.checktheplants.ru/api/system/metrics -b cookies.txt

# журнал действий администратора: массовые удаления, смена ролей, рассылки
curl.exe -s "https://server.checktheplants.ru/api/admin/audit?limit=50" -b cookies.txt
kubectl exec -n webplant statefulset/postgres -- psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" `
  -c "SELECT created_at, admin_id, action, target_type, target_id FROM admin_audit_logs ORDER BY id DESC LIMIT 20;"
```

`admin_audit_logs` — append-only (триггер запрещает `UPDATE`/`DELETE`), поэтому «почистить
журнал» вручную нельзя: записи удаляются только функцией `purge_admin_audit_logs()`
(365 дней) в ежедневной очистке.

## 2. PostgreSQL недоступен

Признаки: `/health` → `503 {"status":"unavailable"}`, в логах `health_check_failed`,
любые `/api/*` отвечают `500`.

```powershell
# compose: состояние и логи
docker compose -f Backend/docker-compose.yml ps postgres
docker compose -f Backend/docker-compose.yml logs --tail=100 postgres
docker compose -f Backend/docker-compose.yml exec postgres sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

# kubernetes
kubectl get statefulset,pod -n webplant -l app=postgres
kubectl logs -n webplant statefulset/postgres --tail=100
kubectl exec -n webplant statefulset/postgres -- sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Что делать:

1. **Проверить диск** — самая частая причина: `pg_isready` не отвечает, в логах
   `No space left on device` → §4.
2. **Проверить память/OOM**: `docker inspect ctp_postgres --format '{{.State.OOMKilled}}'`,
   `kubectl describe pod -n webplant -l app=postgres` (события `OOMKilled`).
3. **Перезапустить БД**:
   ```powershell
   docker compose -f Backend/docker-compose.yml restart postgres
   kubectl rollout restart statefulset/postgres -n webplant
   ```
4. **Проверить соединения и долгие запросы**:
   ```sql
   SELECT count(*), state FROM pg_stat_activity GROUP BY state;
   SELECT pid, now() - query_start AS dur, left(query, 120)
   FROM pg_stat_activity WHERE state <> 'idle' ORDER BY dur DESC LIMIT 10;
   ```
   Долгий запрос можно снять: `SELECT pg_cancel_backend(<pid>);`
   (backend ограничивает запросы `DB_STATEMENT_TIMEOUT_MS`/`DB_QUERY_TIMEOUT_MS`, по
   умолчанию 30 с; пул — `DB_POOL_MAX`, по умолчанию 10).
5. **Повреждённый том/данные** — восстановление из дампа (§7).
6. После восстановления проверить `/health`, смоук из `DEPLOY.md` §5.1.

При недоступной БД backend не «падает», а возвращает `503` на `/health`; liveness-проба в
k8s смотрит `/livez` (не БД), поэтому поды не перезапускаются бесконечно.

## 3. Redis недоступен

Признаки: `/health` → `"redis": "unavailable"` (или `"disabled"`, если Redis вообще не
сконфигурирован), в логах `⚠️ Redis: сбой`, `⚠️ Redis недоступен... приостанавливаю
обращения на 30 с`.

Что перестаёт работать:

| Функция | Поведение без Redis |
| --- | --- |
| Кэш ИИ (`ctp:ai:*`) | каждый запрос идёт в модель — растёт расход и задержка |
| Распределённые локи (`ctp:lock:*`) | лок считается взятым (`degraded: true`) — задачу выполняет каждая реплика: при 2+ репликах возможны дубли push |
| Rate-limit (`ctp:rl:*`) | `passOnStoreError: true` — запросы не блокируются; у push-подписки `false` — она вернёт ошибку |
| Суточный бюджет ИИ | считается локально в памяти процесса (значение видно в `/api/admin/ai/metrics` → `budget.localFallbackUsed`) |
| Идемпотентность рассылок (`ctp:idem:*`) | остаётся защита уникальным индексом в БД |

```powershell
# compose
docker compose -f Backend/docker-compose.yml ps redis
docker compose -f Backend/docker-compose.yml exec redis sh -c 'redis-cli ping'
docker compose -f Backend/docker-compose.yml logs --tail=100 redis

# kubernetes (пароль берётся из секрета, в консоль не выводится)
kubectl get pod -n webplant -l app=redis
kubectl exec -n webplant deployment/redis -- redis-cli ping
kubectl logs -n webplant deployment/redis --tail=100
```

Действия:

1. перезапустить: `docker compose -f Backend/docker-compose.yml restart redis` /
   `kubectl rollout restart deployment/redis -n webplant`;
2. проверить память: в конфигурации `maxmemory 256mb`, `maxmemory-policy allkeys-lru`,
   AOF `appendfsync everysec`, `save 900 1`; при `OOM command not allowed` —
   освободить память или поднять лимит (изменение конфигурации → `DEPLOY.md`);
3. после восстановления убедиться, что `/health` → `"redis": "ok"` и в логах
   `соединение восстановлено`;
4. помните: при 2+ репликах backend и недоступном Redis напоминания могут дублироваться —
   на это время разумно оставить одну реплику (`kubectl scale deployment/backend -n webplant --replicas=1`).

## 4. Переполнение диска

Признаки: `ENOSPC` в логах, ошибки загрузки фото, `pg_dump` завершается ошибкой,
`/health` может оставаться `ok`.

```powershell
# свободное место на хосте (Windows) и в контейнерах
Get-PSDrive C | Select-Object Used,Free
docker system df

# размеры каталогов
"{0:N1} GB" -f ((Get-ChildItem Backend\uploads -Recurse -File | Measure-Object Length -Sum).Sum / 1GB)
"{0:N1} GB" -f ((Get-ChildItem Backend\backups -Recurse -File | Measure-Object Length -Sum).Sum / 1GB)
Get-ChildItem Backend\backups | Sort-Object LastWriteTime | Select-Object -First 10 Name,Length

# kubernetes: занятость PVC
kubectl exec -n webplant deployment/backend -- df -h /app/uploads
```

Что чистить (по убыванию эффекта):

1. **старые бэкапы** — штатный retention 14 дней (`BACKUP_RETENTION_DAYS`, `backup.sh`
   удаляет файлы старше 14 дней по `mtime`); при нехватке места можно удалить лишние
   вручную, но **минимум один свежий дамп и один архив uploads должны остаться**;
2. **логи Docker** — `docker system df -v`, при необходимости
   `docker compose -f Backend/docker-compose.yml logs --tail=0` и ротация на уровне
   Docker-демона;
3. **осиротевшие фото** — ежедневная очистка (`cleanExpiredAuthData`) удаляет файлы, на
   которые нет строк в `plant_photos`; ускорить: перезапустить backend (задача стартует
   при старте процесса);
4. **миниатюры** — `Backend/uploads/thumbs` можно удалить целиком: они пересоздаются
   по запросу (`plantThumbRequestHandler`) или скриптом
   `cd Backend; node scripts/generate-plant-thumbs.mjs`;
5. **`redis_data`** — `maxmemory 256mb`, AOF; при разрастании проверить
   `kubectl exec -n webplant deployment/redis -- redis-cli dbsize`.

В Kubernetes отдельный PVC `backend-backups` (20Gi) занят дампами CronJob `db-backup`:
retention 14 дней, но при больших объёмах проверяйте занятость
(`kubectl get pvc -n webplant`) и при необходимости освобождайте старые `db-*.dump` через
одноразовый под с этим PVC (корневой файловой системой контейнера всё равно нельзя
пользоваться — она read-only).

После очистки обязательно проверить, что создаётся новый бэкап:
`docker compose -f Backend/docker-compose.yml exec backup /bin/sh /usr/local/bin/backup.sh`
(compose) или `kubectl create job -n webplant --from=cronjob/db-backup db-backup-manual`
(Kubernetes).

## 5. Истечение TLS-сертификата

Признаки: браузер показывает ошибку сертификата, `curl` возвращает ошибку TLS,
`certbot` пишет `Certificate not yet due for renewal` или ошибку валидации.

```powershell
# сроки действия сертификатов
docker compose -f Backend/docker-compose.yml exec certbot certbot certificates

# журнал продления
docker compose -f Backend/docker-compose.yml logs --tail=100 certbot

# проверка сайта
curl.exe -vI https://checktheplants.ru/ 2>&1 | Select-String -Pattern "SSL|expire|HTTP/"
```

Продление (certbot в compose продлевает автоматически каждые 12 часов):

```powershell
docker compose -f Backend/docker-compose.yml exec certbot certbot renew
docker compose -f Backend/docker-compose.yml exec nginx nginx -t
docker compose -f Backend/docker-compose.yml exec nginx nginx -s reload
```

Если продление не проходит:

1. проверить, что порт 80 доступен из интернета и `/.well-known/acme-challenge/`
   отдаётся из `Backend/certbot/www` (nginx: `location /.well-known/acme-challenge/`);
2. проверить DNS доменов `checktheplants.ru`, `server.checktheplants.ru`,
   `admin.checktheplants.ru`, `pgadmin.checktheplants.ru`;
3. выпустить сертификат вручную (пример для API-домена):
   ```powershell
   docker compose -f Backend/docker-compose.yml exec certbot certbot certonly `
     --webroot -w /var/www/certbot -d server.checktheplants.ru
   ```
4. перезагрузить nginx после успешного выпуска.

Продление сертификата не затрагивает сессии и данные. Пока сертификат недействителен,
сайт и API недоступны целиком — это инцидент уровня «критический»
(`INCIDENT-RUNBOOK.md`).

## 6. SMTP и Yandex Cloud AI

### 6.1 SMTP

Признаки: `POST /api/users/password-reset/request` → `503`, письма не приходят, в логах
`❌ Запрошен сброс пароля, но SMTP не настроен` или ошибки `nodemailer`; `/health` →
`"mail": "not-configured"`.

```powershell
# 1) статус в /health
curl.exe -s https://server.checktheplants.ru/health | Select-String -Pattern "mail"

# 2) проверка соединения и пробное письмо (получатель — аргумент или SMTP_USER)
cd Backend
node scripts/send-test-mail.mjs адрес@example.com
```

Действия:

1. проверить `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
   `MAIL_FROM`, `MAIL_REPLY_TO` в `Backend/.env` (compose) или в Secret/ConfigMap
   кластера (`deploy.ps1 -SkipBuild -SkipImageLoad` + `kubectl rollout restart`);
2. после смены пароля почты **обязателен перезапуск backend** — переменные читаются только
   при старте;
3. если провайдер блокирует отправку (лимиты, «подозрительная активность») — проверить
   кабинет провайдера, при необходимости сменить пароль приложения (ротация — `SECRETS.md`);
4. если письма уходят, но не доходят — проверить SPF/DKIM домена у хостинга почты;
5. рассылки из админки при недоступном SMTP переходят в `failed`; после восстановления
   их нужно пересоздать (повторная отправка существующей рассылки не предусмотрена).

### 6.2 Yandex Cloud AI

Признаки: чат отвечает с `degraded: true` («Модель сейчас недоступна…»), советы по поливу
приходят с `source: "fallback"`, в логах `❌ Ошибка рекомендации полива`, `⚠️ Чат без
модели`. Гость при исчерпанном суточном бюджете получает `503`.

```powershell
# состояние ИИ в админке (под администраторской cookie)
curl.exe -s https://server.checktheplants.ru/api/admin/ai/metrics -b cookies.txt
curl.exe -s "https://server.checktheplants.ru/api/admin/ai/logs?limit=20" -b cookies.txt
```

Действия:

1. проверить `YANDEX_CLOUD_FOLDER`, `YANDEX_CLOUD_API_KEY`, `YANDEX_CLOUD_MODEL`
   (и `YANDEX_CLOUD_VISION_MODEL` для фото);
2. проверить квоты и баланс сервисного аккаунта в Yandex Cloud; при ошибке ключа —
   ротация (`SECRETS.md` §YANDEX_CLOUD_API_KEY);
3. проверить бюджет: `AI_DAILY_REQUEST_BUDGET` (0/пусто — без лимита); при исчерпании
   поднять лимит осознанно или дождаться суток;
4. проверить таймауты/дедлайны (`AI_CHAT_TIMEOUT_MS`, `AI_ADVICE_TIMEOUT_MS`,
   `AI_CHAT_DEADLINE_MS`, `AI_ADVICE_DEADLINE_MS`, `AI_VISION_*`): слишком жёсткие значения
   дают фолбэк даже при доступной модели;
5. при недоступном Redis кэш не работает → больше платных вызовов, это ожидаемо (§3).

## 7. Восстановление БД и uploads

### 7.1 Compose: восстановление БД из дампа

> Полное восстановление перезаписывает текущую базу. Данные, созданные после дампа,
> будут потеряны (RPO — см. §9). Перед началом сохраните текущее состояние, если есть
> шанс, что оно понадобится.

```powershell
# 1) остановить писателей
docker compose -f Backend/docker-compose.yml stop backend

# 2) выбрать дамп
Get-ChildItem Backend\backups\webplant_*.dump | Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 Name,Length,LastWriteTime

# 3) пересоздать базу и восстановить (файл лежит в ./backups → /backups)
#    если бэкап зашифрован (BACKUP_ENCRYPTION_PASSPHRASE), сначала расшифруйте:
#    gpg --output <файл>.dump --decrypt <файл>.dump.gpg   (или age --decrypt -o …)
docker compose -f Backend/docker-compose.yml exec -T postgres sh -c `
  'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose -f Backend/docker-compose.yml exec -T postgres sh -c `
  'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error /backups/<файл>.dump'

# 4) проверить схему (backend сам упадёт, если чего-то не хватает)
docker compose -f Backend/docker-compose.yml up -d --no-deps backend
docker compose -f Backend/docker-compose.yml logs --tail=50 backend

# 5) при отставании схемы — применить миграции
powershell -File Backend/scripts/apply-migrations.ps1 -Target compose
```

Признак успеха: в логах `✅ База данных подключена успешно!` и `✅ Схема production-базы
проверена`, `/health` → `status: ok`.

### 7.2 Kubernetes: восстановление БД

Дампы CronJob `db-backup` лежат на PVC `backend-backups` (`/backups/db-<stamp>.dump`).
Скопировать нужный файл на хост можно одноразовым подом с этим PVC и `kubectl cp`:

```powershell
kubectl run -n webplant backup-fetch --rm -it --restart=Never --image=postgres:16-alpine --overrides='{"spec":{"containers":[{"name":"backup-fetch","image":"postgres:16-alpine","command":["sh","-c","ls -lh /backups; cat /backups/.last-success"],"volumeMounts":[{"name":"backups","mountPath":"/backups"}]}],"volumes":[{"name":"backups","persistentVolumeClaim":{"claimName":"backend-backups"}}]}}'
# либо восстановить прямо из пода с PVC, если дамп уже доступен в кластере
```

```powershell
# 1) остановить backend (RollingUpdate не нужен — масштабируем в 0)
kubectl scale deployment/backend -n webplant --replicas=0

# 2) положить дамп в под postgres
kubectl cp Backend/backups/<файл>.dump webplant/postgres-0:/tmp/db.dump

# 3) пересоздать базу и восстановить (переменные POSTGRES_* есть в поде)
kubectl exec -n webplant statefulset/postgres -- sh -c `
  'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-privileges --exit-on-error /tmp/db.dump'

# 4) миграции и запуск
powershell -File Backend/scripts/apply-migrations.ps1
kubectl scale deployment/backend -n webplant --replicas=1
kubectl rollout status deployment/backend -n webplant
kubectl logs -n webplant deployment/backend --tail=50
```

Job-шаблоны `Backend/k8s/jobs/db-restore.job.yaml` и `uploads-restore.job.yaml` —
служебные (заполняются `deploy.ps1 -RestoreData` и `restore-back.ps1`), вручную их
применять не нужно.

### 7.3 Восстановление uploads

```powershell
# compose: остановить backend, распаковать архив в Backend/uploads с владельцем 1001
docker compose -f Backend/docker-compose.yml stop backend
docker run --rm `
  -v "${PWD}/Backend/uploads:/target" `
  -v "${PWD}/Backend/backups:/backups:ro" `
  alpine:3 sh -c 'rm -rf /target/* && tar -xzf /backups/uploads_<stamp>.tar.gz -C /target && chown -R 1001:1001 /target'

# миниатюры можно не восстанавливать — они пересоздаются
cd Backend
node scripts/generate-plant-thumbs.mjs

cd ..
docker compose -f Backend/docker-compose.yml start backend
```

```powershell
# kubernetes: скопировать архив в под backend и распаковать (tar выполняется от uid 1001)
$pod = kubectl get pod -n webplant -l app=webplant-backend -o jsonpath='{.items[0].metadata.name}'
kubectl cp Backend/backups/uploads_<stamp>.tar.gz "webplant/$pod:/tmp/uploads.tar.gz"
kubectl exec -n webplant $pod -- sh -c 'tar -xzf /tmp/uploads.tar.gz -C /app/uploads && ls /app/uploads | head'
```

Проверка: открыть карточку растения с фото, убедиться, что `/uploads/plants/...` и
`/uploads/thumbs/...` отдают `200`.

## 8. Утечка секретов и ротация

Порядок действий при подозрении на утечку:

1. зафиксировать факт и время в `INCIDENT-RUNBOOK.md` (журнал инцидента);
2. **считать скомпрометированным** секрет и ротировать его по таблице ниже;
3. проверить логи на аномалии: `unhandled_error`, всплеск `/api/users/registration`,
   `/api/admin/*`, входы не из тех регионов (`middleware/accessLog.js`);
4. при утечке персональных данных — процедура уведомления по `INCIDENT-RUNBOOK.md`
   (в т.ч. РКН, 72 часа);
5. запись о ротации внести в `SECRETS.md` (дата, кто, что изменено).

### 8.1 SECRET_KEY (ротация с отзывом всех сессий)

`SECRET_KEY` подписывает JWT доступа, JWT обновления **и** гостевые токены (HMAC).
После смены ключа все пользователи выходят из аккаунтов, гостевые cookie становятся
недействительными (гость получит новый токен, старая гостевая переписка/согласия
перестанут к нему привязываться).

```powershell
# 1) бэкап
docker compose -f Backend/docker-compose.yml exec backup /bin/sh /usr/local/bin/backup.sh

# 2) отозвать ВСЕ активные сессии
docker compose -f Backend/docker-compose.yml exec -T postgres sh -c `
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;"'

# 3) сгенерировать новый ключ (≥32 байт; 48 байт в base64url)
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# 4) записать в Backend/.env (compose) или в Secret кластера
#    compose: SECRET_KEY=<новое значение>, затем перезапуск
docker compose -f Backend/docker-compose.yml up -d --no-deps backend

#    kubernetes: обновить .env и Secret, перезапустить поды
powershell -File Backend/k8s/scripts/deploy.ps1 -SkipBuild -SkipImageLoad
kubectl rollout restart deployment/backend -n webplant
```

Проверка: `/health` → `ok`, вход существующим аккаунтом работает (пользователи вводят
пароль заново), старые cookie не принимаются.

Побочные эффекты, о которых нужно предупредить заранее:

* гостевые cookie (`guest_token` подписан HMAC на том же ключе) перестают проверяться —
  гость получает новый токен, старая гостевая переписка/согласия к нему больше не
  привязываются;
* ссылки отписки от рассылок (`/unsubscribe?uid&token`, HMAC от `unsubscribe:<user_id>`)
  становятся недействительными — после ротации их нужно перегенерировать в новых письмах
  (старые письма перестанут отписывать);
* `password_reset_tokens` и `passkey_challenges` не затронуты (случайные значения/хэши),
  но токены сброса всё равно рекомендуется аннулировать при подозрении на компрометацию:
  `DELETE FROM password_reset_tokens;`

### 8.2 VAPID

```powershell
cd Backend
npx web-push generate-vapid-keys     # выводит public/private, значения не коммитить
```

1. записать `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` в окружение/Secret;
2. перезапустить backend (env читается при старте);
3. **старые push-подписки перестанут доставляться** — они привязаны к прежнему ключу;
   пометить их недействительными, чтобы очистка удалила их через 30 дней:
   ```sql
   UPDATE push_subscriptions SET invalidated_at = now(), invalid_reason = 'vapid-rotated'
   WHERE invalidated_at IS NULL;
   ```
4. пользователям нужно заново включить уведомления в интерфейсе (клиент получает новый
   публичный ключ через `GET /api/push/vapid-public-key`);
5. проверить `/health` → `"push": {"configured": true}` и тестовое уведомление из админки.

### 8.3 SMTP_PASSWORD

1. сменить пароль (пароль приложения) в кабинете почтового провайдера;
2. обновить `SMTP_PASSWORD` в `.env`/Secret;
3. перезапустить backend, проверить `node scripts/send-test-mail.mjs адрес@example.com`
   (из каталога `Backend`);
4. письма сброса пароля и рассылки должны снова уходить; в админке отправить тестовое письмо.

### 8.4 YANDEX_CLOUD_API_KEY

1. выпустить новый API-ключ сервисного аккаунта в Yandex Cloud;
2. обновить `YANDEX_CLOUD_API_KEY` (при необходимости — `YANDEX_CLOUD_FOLDER`,
   `YANDEX_CLOUD_MODEL`);
3. перезапустить backend;
4. проверить чат и совет по поливу (ответ без `degraded`, `source: "ai"` или `"cache"`),
   метрики в `/api/admin/ai/metrics`;
5. отозвать старый ключ в Yandex Cloud.

### 8.5 DB_PASSWORD

```powershell
# 1) сменить пароль в PostgreSQL (интерактивно, чтобы не экранировать кавычки в PowerShell)
docker compose -f Backend/docker-compose.yml exec postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres'
# в приглашении psql:
#   ALTER ROLE "<DB_USER>" WITH PASSWORD '<новый пароль>';

# 2) обновить DB_PASSWORD в Backend/.env (тот же .env читают сервисы migrate и backup)
# 3) перезапустить backend и служебные контейнеры
docker compose -f Backend/docker-compose.yml up -d --no-deps backend
docker compose -f Backend/docker-compose.yml restart backup
```

В Kubernetes `DB_PASSWORD` хранится в Secret `webplant-secrets`; PostgreSQL читает его при
инициализации тома, поэтому смена пароля в работающем StatefulSet выполняется через
`ALTER USER` + обновление Secret, иначе поды не переподключатся.

### 8.6 REDIS_PASSWORD

1. `docker compose -f Backend/docker-compose.yml exec redis redis-cli -a <текущий> CONFIG SET requirepass <новый>`
   (или перезапуск с новым `REDIS_PASSWORD` в `.env`);
2. обновить `REDIS_PASSWORD` (compose) либо Secret `webplant-secrets`
   (`REDIS_PASSWORD` и `REDIS_URL`) и перезапустить redis + backend;
3. проверить `/health` → `"redis": "ok"`;
4. при смене Redis все локи и кэш пропадают — это безопасно (данные не хранятся в Redis).

### 8.7 Пароли FTP и админки

* FTP: сменить пароль в панели хостинга, обновить `DEPLOY_PASSWORD`/секрет-хранилище,
  проверить выгрузку `upload-dist.ps1 -ListRemote`;
* админка: сменить пароль учётной записи с `role = ADMIN` (вход на сайте), затем
  `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = <id> AND revoked_at IS NULL;`;
* pgAdmin: сменить пароль пользователя pgAdmin и пароль БД (§8.5), доступ — только через
  nginx по HTTPS (`Backend/PGADMIN.md`).

## 9. RPO/RTO

| Показатель | Значение | Комментарий |
| --- | --- | --- |
| **RPO** | **24 часа** | compose: `ctp_backup` раз в 24 часа (`backup.sh`, `sleep 86400`) делает дамп БД **и** архив `uploads`; Kubernetes: CronJob `db-backup` ежедневно в 02:00 `Europe/Moscow` делает **только** дамп БД, `uploads` архивируются отдельно (`DEPLOY.md` §1.2). Retention 14 дней. Перед плановым деплоем делается дополнительный дамп (`DEPLOY.md` §1), тогда RPO для этого окна близок к нулю |
| Что входит в бэкап | `webplant_<stamp>.dump` + `uploads_<stamp>.tar.gz` (compose); `db-<stamp>.dump` (k8s) | compose: `Backend/backups`, `umask 077`, heartbeat `.last-success`; k8s: PVC `backend-backups`, heartbeat `/backups/.last-success`. Шифрование (`BACKUP_ENCRYPTION_PASSPHRASE`, gpg/age) и offsite (`BACKUP_OFFSITE_TARGET`, rclone) — по настройке; при их отсутствии дампы лежат в открытом виде |
| **RTO** | **цель ≤ 2 часов** | **не измерен**: фактическое время восстановления зависит от размера БД/архива и опыта оператора; тестовое восстановление нужно провести по `docs/REVIEW-CHECKLIST.md` (restore-тест) и зафиксировать факт |
| Ответственный | владелец продукта | принимает решение о восстановлении, фиксирует потери и время |
| Что теряется при восстановлении | записи, созданные после дампа (до 24 часов), файлы фото за тот же период | в отчёте инцидента указать окно потерь |

Проверка бэкапа без восстановления:

```powershell
# compose: дамп + heartbeat
Get-ChildItem Backend\backups | Sort-Object LastWriteTime -Descending | Select-Object -First 4
Get-Content Backend\backups\.last-success
docker run --rm -v "${PWD}/Backend/backups:/b" postgres:16-alpine pg_restore --list /b/<файл>.dump | Select-Object -First 5

# k8s: последний Job и его лог
kubectl get jobs -n webplant -l app=db-backup
kubectl logs -n webplant job/<последний-job> | Select-Object -Last 20
```

## 10. Что делать после устранения

1. Проверить `/health`, `/livez`, смоук из `DEPLOY.md` §5.1.
2. Убедиться, что фоновые задачи работают: в логах `⏰ ReminderService запущен`,
   `📢 PushBroadcastJob запущен`, `✉️ MailBroadcastJob запущен` (или
   `⏸ Фоновые задачи отключены` при `BACKGROUND_JOBS_ENABLED=false`).
3. Проверить, что создаётся свежий бэкап (после инцидентов с диском/БД — обязательно):
   heartbeat `.last-success` обновился, Job `db-backup` в статусе `Complete`.
4. Просмотреть `admin_audit_logs` за период инцидента (были ли подозрительные
   административные действия).
5. Оформить постмортем без виноватых (`INCIDENT-RUNBOOK.md`): таймлайн, корневая причина,
   потери, что улучшить (в т.ч. правки этого документа).
6. Если менялись секреты — обновить записи в `SECRETS.md`.
