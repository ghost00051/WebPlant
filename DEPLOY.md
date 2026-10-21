# DEPLOY.md — порядок выкладки WebPlant

Документ описывает, как выкатывать Backend 1.2.6 (Docker Compose и Kubernetes) и Frontend
1.2.20 (статическая сборка + FTP), какие проверки обязательны и как откатываться.
Ответственный за применение миграций и раскатку — **владелец продукта** (роль; конкретное
лицо фиксируется в реестре доступов, см. `SECRETS.md` и `docs/REVIEW-CHECKLIST.md`).

> **Конвейер выкладки: бэкап → миграции → раскатка.**
> Миграции не применяются без свежего дампа БД и архива `uploads`. Обратный порядок
> («сначала миграции, потом бэкап») недопустим: откат схемы без дампа невозможен,
> down-миграций в проекте нет.
>
> **Конвейер фронта:** сборка → `npm run verify` → FTP-выгрузка → проверка ключевых URL.

## 0. Перед любым деплоем

| Проверка | Команда / место |
| --- | --- |
| CI зелёный на коммите | GitHub Actions → workflow `CI` (frontend + backend) |
| Версии зафиксированы | `Backend/package.json` (1.2.6), `Frontend/package.json` (1.2.20), `CHANGELOG.md` |
| Рабочее дерево чистое (для k8s важно: тег образа получает `-dirty-<хеш>`) | `git status --short` |
| Есть свежий бэкап | `Get-ChildItem Backend/backups` (см. §1) |
| Известно, какой стек сейчас обслуживает трафик | `curl -s https://server.checktheplants.ru/health` → поле `deployTarget` и `backgroundJobs` |
| Окно деплоя согласовано | §8 |

Определить активный режим nginx можно и по файлу: `Backend/nginx/conf.d/default.conf`
сравнивается с `Backend/k8s/nginx/compose.conf` / `canary.conf` / `k8s.conf`
(`switch-traffic.ps1` подменяет именно его).

## 1. Бэкап (обязательный шаг)

### 1.1 Compose-стек

```powershell
# из корня репозитория: запускает штатный backup.sh в контейнере ctp_backup
# (pg_dump -Fc + tar uploads в Backend/backups, проверка pg_restore --list,
#  retention 14 дней, опционально шифрование и offsite, heartbeat .last-success)
docker compose -f Backend/docker-compose.yml exec backup /bin/sh /usr/local/bin/backup.sh

# проверить, что файлы появились и не пустые
Get-ChildItem Backend/backups | Sort-Object LastWriteTime -Descending |
  Select-Object -First 4 Name,Length,LastWriteTime
Get-Content Backend/backups/.last-success
```

Скрипт завершается с ошибкой, если дамп пустой/нечитаемый, если не удалось шифрование при
заданном `BACKUP_ENCRYPTION_PASSPHRASE` или offsite-копирование при заданном
`BACKUP_OFFSITE_TARGET`; heartbeat в этом случае не обновляется.

Если контейнер `ctp_backup` остановлен, дамп БД можно снять напрямую (файл пишется внутри
контейнера в смонтированный `./backups`):

```powershell
docker compose -f Backend/docker-compose.yml exec -T postgres sh -c `
  'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /backups/webplant_manual_$(date -u +%Y%m%dT%H%M%SZ).dump'
```

> Не перенаправляйте вывод `pg_dump` в файл через `>` в PowerShell: Windows PowerShell 5.1
> пишет UTF-16 и дамп будет непригоден. Используйте `-f` внутри контейнера или `kubectl cp`.

### 1.2 Kubernetes

В кластере работает CronJob `db-backup` (ежедневно в 02:00 `Europe/Moscow`, retention 14 дней,
PVC `backend-backups`, heartbeat `/backups/.last-success`). Перед деплоем убедитесь, что
последний бэкап свежий, или снимите дамп вручную:

```powershell
# состояние CronJob и свежесть бэкапа (PVC backend-backups не смонтирован в backend,
# поэтому смотрим его отдельным одноразовым подом)
kubectl get cronjob,job -n webplant
kubectl run -n webplant backup-inspect --rm -it --restart=Never --image=postgres:16-alpine `
  --overrides='{"spec":{"containers":[{"name":"backup-inspect","image":"postgres:16-alpine","command":["sh","-c","ls -lh /backups; cat /backups/.last-success"],"volumeMounts":[{"name":"backups","mountPath":"/backups"}]}],"volumes":[{"name":"backups","persistentVolumeClaim":{"claimName":"backend-backups"}}]}}'

# ручной дамп БД (если нужно «здесь и сейчас»)
kubectl exec -n webplant statefulset/postgres -- sh -c `
  'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/webplant-latest.dump'
kubectl cp webplant/postgres-0:/tmp/webplant-latest.dump `
  "Backend/backups/webplant_k8s_$((Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')).dump"

# архив uploads: CronJob его не делает, снимайте отдельно
$pod = kubectl get pod -n webplant -l app=webplant-backend -o jsonpath='{.items[0].metadata.name}'
kubectl exec -n webplant $pod -- tar -czf /tmp/uploads.tar.gz -C /app/uploads .
kubectl cp "webplant/$pod:/tmp/uploads.tar.gz" Backend/backups/uploads_k8s.tar.gz
```

Проверка целостности дампа (не восстанавливая):

```powershell
docker run --rm -v "${PWD}/Backend/backups:/b" postgres:16-alpine `
  pg_restore --list /b/<файл>.dump | Select-Object -First 10
```

## 2. Миграции

Политика:

* миграции — только forward-only, идемпотентные SQL-файлы в `Backend/migrations/`,
  применяются по возрастанию имени (последние по состоянию репозитория:
  `20261025_create_admin_audit_logs.sql`, `20261026_add_marketing_consent.sql`);
* в одном релизе допустимы аддитивные изменения (новая таблица, новая nullable-колонка,
  новый индекс). Удаление/переименование колонок — отдельным релизом **после** выкладки
  кода, который перестал их использовать;
* backend в production проверяет схему при старте и падает, если моделей не хватает:
  `Database schema is missing required tables or columns: … Apply migration(s): …`;
* откат миграции = восстановление дампа БД (§9), down-миграций нет.

### 2.1 Compose

Миграции применяются автоматически сервисом `migrate` при запуске стека
(`docker compose -f Backend/docker-compose.yml up -d`), backend ждёт
`service_completed_successfully`. Вручную:

```powershell
docker compose -f Backend/docker-compose.yml run --rm migrate
# либо
powershell -File Backend/scripts/apply-migrations.ps1 -Target compose
```

### 2.2 Kubernetes

`deploy.ps1` применяет миграции сам (перед раскаткой, через
`Backend/scripts/apply-migrations.ps1`). Отдельно:

```powershell
powershell -File Backend/scripts/apply-migrations.ps1              # весь набор, k8s
powershell -File Backend/scripts/apply-migrations.ps1 -From 20261012  # начиная с указанной
```

## 3. Раскатка Backend

### 3.1 Compose

```powershell
# 1) сохранить текущий образ для быстрого отката (тег зависит от имени проекта)
docker compose -f Backend/docker-compose.yml images backend
docker tag backend-backend:latest webplant-backend:rollback

# 2) собрать и перезапустить ТОЛЬКО backend
docker compose -f Backend/docker-compose.yml build backend
docker compose -f Backend/docker-compose.yml up -d --no-deps backend

# 3) если менялись конфиги nginx (Backend/nginx/conf.d) — пересобрать nginx
docker compose -f Backend/docker-compose.yml build nginx
docker compose -f Backend/docker-compose.yml up -d --no-deps nginx
```

Важно:

* `up -d` **без** `--no-deps` может пересоздать соседние контейнеры, если в
  `docker-compose.yml` есть незакоммиченные правки (порты, тома, сборка nginx);
* для остановленного вручную контейнера возврат — `docker start ctp_backend`, а не
  `docker compose up -d backend`;
* пересборка только бэкенда без зависимостей: `docker compose -f Backend/docker-compose.yml up -d --build --no-deps backend`.

### 3.2 Kubernetes

```powershell
# обычное обновление: собрать образ, доставить на ноды, применить манифесты, дождаться RollingUpdate
powershell -File Backend/k8s/scripts/deploy.ps1

# только настройки (.env → Secret/ConfigMap), без пересборки образа
powershell -File Backend/k8s/scripts/deploy.ps1 -SkipBuild -SkipImageLoad

# фоновые задачи: без флагов сохраняется текущий режим
powershell -File Backend/k8s/scripts/deploy.ps1 -EnableBackgroundJobs
```

Что делает `deploy.ps1`: создаёт/обновляет `webplant-env` и `webplant-secrets` из
`Backend/.env`, применяет миграции, собирает образ с тегом `<версия>-<хеш>`
(`-dirty-<хеш>` при незакоммиченных правках), доставляет его DaemonSet'ом `image-loader`
на все ноды (10–25 минут, таймаут 30 минут, `-ImageLoadTimeoutMinutes`), применяет
манифесты, ждёт RollingUpdate (`maxUnavailable: 0`), пересоздаёт gateway и перезагружает
боевой nginx.

После смены `.env` поды нужно перезапустить — переменные окружения читаются только при
старте контейнера:

```powershell
kubectl rollout restart deployment/backend -n webplant
```

`kubectl rollout restart` не подхватывает новый код — для кода нужен `deploy.ps1`.

### 3.3 Переключение трафика (Kubernetes)

| Режим | `/api`, `/uploads` | `/health` | Когда |
| --- | --- | --- | --- |
| `compose` | compose | compose | обычная работа / полный откат |
| `canary` | compose | Kubernetes | проверка связки nginx → gateway → кластер без риска для данных |
| `k8s` | Kubernetes | Kubernetes | полный переезд |

```powershell
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target canary
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target k8s
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose
```

Скрипт подменяет `Backend/nginx/conf.d/default.conf`, проверяет `nginx -t` (при ошибке
возвращает предыдущий файл), делает graceful reload и сохраняет предыдущий конфиг в
`Backend/k8s/nginx/backups/`. В режиме `canary` записи остаются в compose-базе — у
кластера своя копия данных.

## 4. Раскатка Frontend (FTP)

Порядок:

```powershell
cd Frontend
npm ci
npm run build      # generate-plant-images → generate-seo-meta → vite build → prerender → build-manifest
npm run verify     # verify-build + verify-routing + check-security-headers + build-manifest --check
```

`npm run verify` должен завершиться успешно: он проверяет сборку, роутинг, CSP и
`dist/build-info.json` (версия/коммит/дата/маршруты). Артефакт сборки —
`Frontend/dist` (в git не попадает).

Выгрузка:

```powershell
# из корня репозитория; пароль берите из DEPLOY_PASSWORD/секрет-хранилища,
# не вписывайте его в историю команд на общей машине
powershell -File upload-dist.ps1 `
  -FtpHost <ftp-хост> -FtpUser <логин> `
  -FtpPassword $env:DEPLOY_PASSWORD `
  -RemoteRoot /www/checktheplants.ru -UseSsl -Verify
```

Полезные режимы `upload-dist.ps1`:

```powershell
powershell -File upload-dist.ps1 -FtpHost <host> -FtpUser <user> -FtpPassword <pass> -ListOnly     # что будет выгружено
powershell -File upload-dist.ps1 -FtpHost <host> -FtpUser <user> -FtpPassword <pass> -ListRemote   # что лежит на сервере
```

`-Verify` после выгрузки проверяет HEAD-запросами `/plants.html`, `/plants`,
`/plants/monstera`, `/care`, `/care/kak-chasto-polivat`, `/login`, `/robots.txt`,
`/sitemap.xml`.

Замечания:

* `upload-dist.ps1` сейчас в `.gitignore` — в чистом клоне его не будет; либо удалите
  строку из `.gitignore` и закоммитьте скрипт, либо выгружайте содержимое `Frontend/dist`
  вручную (FTP/FTPS-клиент, бинарный режим, корень сайта);
* `npm run deploy` (`node ../deploy.mjs`) **не работает**: файла `deploy.mjs` в репозитории
  нет, он в `.gitignore`;
* параметры FTP можно держать в `deploy.config.json` (образец —
  `deploy.config.example.json`, переменные `DEPLOY_*`, путь переопределяется
  `DEPLOY_CONFIG_PATH`); пароль в файле хранить не рекомендуется.

### 4.1 Админ-панель

Выкладывается отдельно и без сборки: содержимое `Frontend/admin/` копируется в корень
`admin.checktheplants.ru` (включая `.htaccess`). Подробности и проверки —
`Frontend/admin/README.md`. После выгрузки:

```powershell
npm run verify:admin          # headless-прогон панели
```

## 5. Проверки после деплоя

### 5.1 Backend

```powershell
# liveness — только процесс
curl.exe -s https://server.checktheplants.ru/livez

# readiness — БД + сводка подсистем
curl.exe -s https://server.checktheplants.ru/health
```

Ожидаемый ответ `/health`: `"status": "ok"`, `"redis": "ok"` (или `"disabled"`, если Redis
не сконфигурирован), `"mail": "ok"`/`"not-configured"`, `"push": {"configured": true}`,
`"backgroundJobs": true|false`, `"deployTarget": "compose"|"kubernetes"`, `"aiCache"`.
Ответ `503 {"status":"unavailable"}` — БД недоступна, см. `RUNBOOK.md` §2.

```powershell
# compose
docker compose -f Backend/docker-compose.yml ps
docker compose -f Backend/docker-compose.yml logs --tail=100 backend

# kubernetes
kubectl rollout status deployment/backend -n webplant
kubectl logs -n webplant deployment/backend --tail=50
powershell -File Backend/k8s/scripts/status.ps1
```

`status.ps1` показывает поды, сервисы/endpoints, PVC, состояние Redis, схему БД
(в том числе наличие `site_visit_days` и `users.created_at`) и подсказывает команды, если
схема отстала.

Дополнительно (администраторская сессия):

```powershell
# HTTP-метрики процесса: счётчики по статусам/методам/маршрутам, латентность
curl.exe -s https://server.checktheplants.ru/api/system/metrics -b cookies.txt

# журнал действий администратора (последние 20)
curl.exe -s "https://server.checktheplants.ru/api/admin/audit?limit=20" -b cookies.txt

# свежесть бэкапа: compose — файл heartbeat в ./backups, k8s — CronJob db-backup
Get-Content Backend\backups\.last-success -ErrorAction SilentlyContinue
kubectl get jobs -n webplant -l app=db-backup
```

Функциональный смоук (5 минут):

1. вход существующим аккаунтом (cookie выдаются, `/api/users/me` отвечает);
2. создание растения и отметка полива (проверить `201` и обновлённый `next_watering_at`);
3. сообщение в чат (`POST /api/chat/chat`) — ответ без `degraded`;
4. список уведомлений (`GET /api/notifications`) и счётчик непрочитанных;
5. админка: вход под `role = ADMIN`, раздел «Обзор» загружается.

Проверка уведомлений и идемпотентности (на одноразовой БД):

```powershell
powershell -File Backend/scripts/verify-notifications.ps1
```

### 5.2 Frontend

```powershell
curl.exe -I https://checktheplants.ru/
curl.exe -I https://checktheplants.ru/login
curl.exe -s https://checktheplants.ru/build-info.json
curl.exe -s https://checktheplants.ru/robots.txt
curl.exe -s https://checktheplants.ru/sitemap.xml | Select-Object -First 5
```

`build-info.json` должен содержать версию `1.2.20`, коммит и список маршрутов, совпадающие
с текущим релизом.

### 5.3 TLS

```powershell
docker compose -f Backend/docker-compose.yml exec certbot certbot certificates
```

Срок действия должен быть больше 30 дней (certbot продлевает каждые 12 часов, см.
`RUNBOOK.md` §5).

## 6. Миграции и совместимость версий при раздельном деплое

* фронт и backend версионируются независимо (1.2.20 / 1.2.6). Новые поля API добавляются
  так, чтобы старый фронт продолжал работать: новые поля опциональны, существующие
  не удаляются и не меняют тип в одном релизе;
* удаление поля/эндпоинта — через деprecation-период (минимум один релиз фронта);
* порядок при изменениях контракта: сначала backend (обратно совместимый), затем frontend;
* контракт зафиксирован в `docs/api/openapi.yaml`; при изменении API правка спеки входит в
  тот же PR (см. `docs/REVIEW-CHECKLIST.md`).

## 7. Откат

### 7.1 Откат кода (Kubernetes)

```powershell
kubectl rollout undo deployment/backend -n webplant
kubectl rollout history deployment/backend -n webplant
kubectl rollout status deployment/backend -n webplant
```

Предыдущий образ уже лежит на нодах (`image-loader` хранит текущий и предыдущий теги),
поэтому откат занимает секунды. Откат не возвращает схему БД: если релиз включал миграцию,
совместимость обеспечивается аддитивностью миграций.

### 7.2 Откат кода (Compose)

```powershell
# образ, сохранённый в §3.1
docker tag webplant-backend:rollback backend-backend:latest
docker compose -f Backend/docker-compose.yml up -d --no-deps backend
```

Если образ не сохраняли — выкатить предыдущий коммит:

```powershell
git switch --detach <предыдущий-тег-или-коммит>
docker compose -f Backend/docker-compose.yml build backend
docker compose -f Backend/docker-compose.yml up -d --no-deps backend
```

### 7.3 Откат после переезда в Kubernetes (данные)

```powershell
# перенести данные из кластера обратно в compose и вернуть трафик
powershell -File Backend/k8s/scripts/restore-back.ps1
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose
```

`restore-back.ps1` умеет `-SkipUploads` и `-KeepBackendStopped`.

### 7.4 Откат данных (БД и uploads)

Полное восстановление из дампа — `RUNBOOK.md` §7. Кратко: остановить writers, `pg_restore`
в чистую БД, проверить схему (backend сам проверит при старте), распаковать uploads,
выставить владельца `1001:1001`, поднять сервис.

Источники дампов: compose — `Backend/backups/webplant_<stamp>.dump` (пишет `ctp_backup`);
k8s — `/backups/db-<stamp>.dump` на PVC `backend-backups` (пишет CronJob `db-backup`).
Дампы можно расшифровать, если включён `BACKUP_ENCRYPTION_PASSPHRASE` (gpg/age;
пароль — в секретах, см. `SECRETS.md`).

### 7.5 Откат фронта

Версионирования статики на хостинге нет, поэтому:

1. держите локально архив предыдущего `Frontend/dist` (или знайте коммит из
   `dist/build-info.json`);
2. соберите предыдущую версию (`git switch --detach <тег>; npm ci; npm run build; npm run verify`);
3. выгрузите её тем же `upload-dist.ps1` и проверьте `build-info.json`.

## 8. Окно деплоя и ответственный

| Параметр | Значение |
| --- | --- |
| Ответственный за миграции и раскатку | **владелец продукта** (роль) |
| Согласование | владелец продукта; для изменений схемы — обязательное ревью PR по `docs/REVIEW-CHECKLIST.md` |
| Рекомендуемое окно | рабочие дни, **11:00–17:00 МСК** |
| Избегать | 09:00 по часовому поясу пользователей (утренняя сводка), моментов активных рассылок, пятницы после 16:00 и периодов маркетинговых анонсов |
| Максимальная длительность | compose — 15 минут; k8s — до 60 минут (сборка + доставка образа 10–25 минут) |
| Заморозка | за 24 часа до крупного анонса/акции и на время инцидента (см. `INCIDENT-RUNBOOK.md`) |
| Внеплановый деплой | допускается при инциденте, решение фиксируется в постмортеме |

## 9. Чек-лист деплоя

**До выкладки**

- [ ] CI зелёный, PR прошёл ревью (`docs/REVIEW-CHECKLIST.md`)
- [ ] обновлены версии в `package.json` и `CHANGELOG.md`
- [ ] изменения API отражены в `docs/api/openapi.yaml`; обратная совместимость сохранена
- [ ] новые миграции аддитивны и идемпотентны
- [ ] сделаны дамп БД и архив `uploads`, файлы проверены на размер/целостность (§1)
- [ ] известно, какой стек обслуживает трафик (`/health` → `deployTarget`)
- [ ] окно деплоя согласовано с владельцем продукта (§8)

**Миграции**

- [ ] миграции применены (`migrate` / `apply-migrations.ps1`), ошибок в логе нет
- [ ] при отставании схемы backend не уходит в `CrashLoopBackOff`

**Раскатка backend**

- [ ] образ собран, тег содержит версию и хеш коммита
- [ ] rollout завершён (`kubectl rollout status` / `compose ps` — `healthy`)
- [ ] `/livez` и `/health` отвечают `200`, `redis`/`mail`/`push` в ожидаемом состоянии
- [ ] в логах нет `unhandled_error`, `health_check_failed`, ошибок миграций
- [ ] фоновые задачи включены там, где должны (`backgroundJobs` в `/health`)

**Фронтенд**

- [ ] `npm run build` и `npm run verify` прошли
- [ ] `dist/build-info.json` содержит ожидаемую версию и коммит
- [ ] выгрузка завершилась без ошибок, `-Verify`/ручная проверка ключевых URL успешна
- [ ] админка выгружена и `npm run verify:admin` прошёл (если менялась)

**После выкладки**

- [ ] смоук: вход, создание растения, полив, чат, уведомления, админка
- [ ] `verify-notifications.ps1` (при изменениях в уведомлениях/рассылках)
- [ ] `/api/system/metrics` и `/api/admin/audit` отвечают администратору
- [ ] бэкап свежий: `Backend/backups/.last-success` (compose) / Job `db-backup` (k8s)
- [ ] сертификат TLS действует > 30 дней
- [ ] свободное место на диске достаточно (§4 `RUNBOOK.md`)
- [ ] запись о выкладке внесена в `CHANGELOG.md`/трекер, ответственный и время зафиксированы

**Откат (если нужно)**

- [ ] решение об откате принято владельцем продукта, зафиксировано время
- [ ] `kubectl rollout undo` или возврат предыдущего образа выполнен
- [ ] при проблемах с данными — `restore-back.ps1` + `switch-traffic.ps1 -Target compose`
- [ ] `/health`, смоук и логи проверены повторно
- [ ] инцидент оформлен по `INCIDENT-RUNBOOK.md`, назначен постмортем
