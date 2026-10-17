# WebPlant в Kubernetes

Стек backend-части CheckThePlants («Лейка») для Kubernetes: PostgreSQL, Redis и два
экземпляра backend в namespace `webplant`, плюс шлюз наружу. Развёртывание живёт рядом
с рабочим `docker-compose` стеком и не изменяет его: данные только читаются.

```
        ┌──────────────── Windows-хост (он же боевой сервер) ────────────────┐
        │                                                                   │
        │  docker-compose (боевой)          Kubernetes (docker-desktop)     │
        │  ┌──────────────────────┐         namespace webplant              │
        │  │ ctp_nginx   :80/443  │         ┌────────────────────────────┐  │
        │  │ ctp_backend :5000    │         │ Deployment backend (x2)    │  │
        │  │ ctp_postgres:5433    │         │  Service backend:5000      │  │
        │  │ ctp_redis   :6379    │         │  Service backend-nodeport  │  │
        │  │ ctp_certbot, backup  │         │  :30080 (на каждой ноде)   │  │
        │  └──────────────────────┘         │ Deployment redis + PVC     │  │
        │                                   │ StatefulSet postgres + PVC │  │
        │  ctp_k8s_gateway :8090 ──────────▶│ PVC backend-uploads        │  │
        │  (nginx stream в сети kind)       └────────────────────────────┘  │
        └───────────────────────────────────────────────────────────────────┘
```

## Что где лежит

| Файл | Назначение |
| --- | --- |
| `00-namespace.yaml` | namespace `webplant` |
| `10-configmap.yaml` | настройки кластера (внутренние адреса, Redis, кэш ИИ, флаги) |
| `15-storage.yaml` | PVC `redis-data` (1Gi) и `backend-uploads` (5Gi) |
| `20-postgres.yaml` | Service + StatefulSet PostgreSQL 16, том 5Gi |
| `30-redis.yaml` | Service + Deployment Redis 7, AOF, `maxmemory 256mb`, пароль из секрета |
| `40-backend.yaml` | Deployment backend (2 реплики), Service, NodePort, PodDisruptionBudget |
| `jobs/image-loader.daemonset.yaml` | доставка локально собранного образа на ноды |
| `jobs/db-restore.job.yaml` | восстановление дампа боевой базы в PostgreSQL кластера |
| `jobs/uploads-restore.job.yaml` | перенос каталога `Backend/uploads` в PVC |
| `gateway/nginx.conf.tpl` | шаблон шлюза наружу (TCP-прокси на NodePort всех нод) |
| `nginx/compose.conf` | конфиг nginx: весь трафик на compose (исходный режим) |
| `nginx/canary.conf` | конфиг nginx: `/api` и `/uploads` на compose, `/health` в Kubernetes |
| `nginx/k8s.conf` | конфиг nginx: весь трафик в Kubernetes |
| `scripts/deploy.ps1` | полный деплой: секреты, образ, данные, backend, gateway |
| `scripts/switch-traffic.ps1` | переключение боевого трафика (compose/canary/k8s) с проверкой и откатом |
| `scripts/restore-back.ps1` | обратный перенос данных из кластера в compose (откат после переезда) |
| `scripts/status.ps1` | состояние подов, Redis, БД и health |
| `scripts/teardown.ps1` | удаление стека (опционально вместе с данными) |

Объекты `webplant-env` (ConfigMap) и `webplant-secrets` (Secret) создаёт `deploy.ps1`
из `Backend/.env`: секреты не хранятся в git, пароль Redis генерируется один раз и
переиспользуется при следующих деплоях. Пароль почты `SMTP_PASSWORD` тоже уходит
в Secret (перечислен в `$secretKeys`), остальные `SMTP_*`/`MAIL_*` — в ConfigMap.
Почта нужна для писем со ссылкой сброса пароля: пока `SMTP_PASSWORD` пуст,
восстановление пароля отвечает `503`, а `GET /health` показывает
`"mail": "not-configured"`. После заполнения пароля образ пересобирать не нужно, но
одного `deploy.ps1 -SkipBuild -SkipImageLoad` **недостаточно**: Secret обновится,
а поды продолжат работать со старыми переменными, потому что env читается только
при старте контейнера. Нужен ещё перезапуск подов:

```powershell
powershell -File Backend/k8s/scripts/deploy.ps1 -SkipBuild -SkipImageLoad
kubectl rollout restart deployment/backend -n webplant
```

## Требования

* Docker Desktop с включённым Kubernetes (контекст `docker-desktop`, ноды `desktop-*`);
* Windows PowerShell 5.1 или новее (проверено на 5.1; скрипты в UTF-8 с BOM);
* заполненный `Backend/.env` (те же переменные, что и для compose-стека).

## Развёртывание

```powershell
# первый запуск: соберёт образ, доставит его на ноды, перенесёт данные из compose-стека
powershell -File Backend/k8s/scripts/deploy.ps1 -RestoreData

# обычное обновление после изменения кода
powershell -File Backend/k8s/scripts/deploy.ps1

# фоновые задачи (напоминания, рассылки, очистка): без флагов сохраняется текущий режим,
# -EnableBackgroundJobs / -DisableBackgroundJobs меняют его явно
powershell -File Backend/k8s/scripts/deploy.ps1 -EnableBackgroundJobs
```

Проверка состояния:

```powershell
powershell -File Backend/k8s/scripts/status.ps1
```

Пути в примерах указаны от корня репозитория (`WebPlant`). Сами скрипты определяют
свои каталоги от собственного расположения, поэтому запускать их можно откуда угодно —
важно лишь правильно указать путь к файлу скрипта: из каталога `Backend` это
`k8s/scripts/deploy.ps1`, а из любого места — полный путь к `.ps1`.

## Как выкатить изменение

**Изменился код backend** (любой файл в `Backend/`, включая `package.json`):

```powershell
powershell -File Backend/k8s/scripts/deploy.ps1
```

Скрипт соберёт образ с новым тегом, доставит его на все ноды, применит манифесты и
дождётся RollingUpdate. Обновление идёт при живых репликах (`maxUnavailable: 0`),
данные не трогаются — перенос базы и фото выполняется только с `-RestoreData`.
Гейтвей пересоздаётся, после чего скрипт сам перезагружает боевой nginx, чтобы
сбросить DNS-кэш. Занимает несколько минут: основное время — сборка образа и
доставка 90-МБ архива на шесть нод (если тег уже есть на нодах, шаг пропускается).

Тег образа: `<версия из package.json>-<хеш git>`, а при незакоммиченных правках
ещё и `-dirty-<хеш изменений>` — поэтому выкат без коммита тоже доезжает до нод.

Проверка и откат:

```powershell
kubectl rollout status deployment/backend -n webplant
kubectl logs -n webplant deployment/backend --tail=50
kubectl rollout undo deployment/backend -n webplant      # предыдущий образ уже на нодах
```

**Изменились только настройки** (`Backend/.env`, ConfigMap, Secret, флаги задач) —
пересобирать образ не нужно, но поды должны перезапуститься, потому что переменные
окружения читаются только при старте:

```powershell
# .env → Secret и ConfigMap, плюс перезапуск подов (образ не пересобирается)
powershell -File Backend/k8s/scripts/deploy.ps1 -SkipBuild -SkipImageLoad

# или вручную, если правили ConfigMap в кластере
kubectl rollout restart deployment/backend -n webplant
```

Важно: `kubectl rollout restart` сам по себе **не подхватит новый код** — без нового
образа поды запустятся из того же тега. Для кода нужен `deploy.ps1`.

**Изменилась схема базы** (новая таблица или колонка модели) — `deploy.ps1`
применяет миграции сам: перед раскаткой backend он запускает
`Backend/scripts/apply-migrations.ps1` и прогоняет все файлы из
`Backend/migrations` по возрастанию имени. Миграции идемпотентны, поэтому
повторный запуск ничего не меняет.

Это обязательный шаг: backend в production проверяет схему при старте и
**завершает запуск ошибкой**, если таблиц или колонок моделей нет в базе. Без
миграции поды уходят в `CrashLoopBackOff`, а `kubectl rollout status` падает по
таймауту с сообщением вида:

```text
Database schema is missing required tables or columns: site_visit_days.
Apply migration(s): Backend/migrations/20261012_create_admin_analytics.sql
```

Применить миграции отдельно (например, после `-RestoreData` из старого дампа или
если схема разошлась):

```powershell
# в кластере (по умолчанию)
powershell -File Backend/scripts/apply-migrations.ps1

# только новые миграции, начиная с указанной
powershell -File Backend/scripts/apply-migrations.ps1 -From 20261012

# в compose-стеке
powershell -File Backend/scripts/apply-migrations.ps1 -Target compose
```

Compose-стек применяет те же миграции автоматически: сервис `migrate` в
`Backend/docker-compose.yml` запускается перед backend и должен завершиться
успешно (`condition: service_completed_successfully`). Вручную:
`docker compose run --rm migrate`.

Проверить, что схема в кластере не отстала от кода, можно одной командой:

```powershell
powershell -File Backend/k8s/scripts/status.ps1
```

Раздел «Схема базы и миграции» показывает число таблиц, наличие
`site_visit_days` и `users.created_at`, а при отставании сразу печатает команды
применения миграций и перезапуска подов. Если схема пустая (нет даже `users`),
`apply-migrations.ps1` и compose-сервис `migrate` остановятся с подсказкой
сначала восстановить данные из дампа.

**Изменился только frontend** — кластер не затрагивается, фронт собирается и
выкладывается отдельно (`Frontend/`).

## Redis: что он закрывает

Redis в кластере используется backend-ом в трёх местах (`Backend/redis.js`):

1. **Распределённые локи cron-задач** (`Backend/utils/distributedLock.js`).
   Напоминания о поливе, отложенные push-рассылки и ежедневная очистка выполняются
   один раз на весь кластер: ключи `ctp:lock:job:*`, TTL продлевается, пока задача
   выполняется. Если Redis недоступен, задача выполняется локально — как раньше.
2. **Общий store для rate-limit** (`Backend/utils/rateLimitStore.js`).
   Лимиты регистрации, входа, чата, загрузки фото и ИИ-подсказок считаются по всему
   кластеру (ключи `ctp:rl:*`). У всех лимитеров включён `passOnStoreError: true`,
   поэтому сбой Redis не блокирует пользовательские запросы.
3. **Кэш ответов ИИ** (`Backend/utils/aiCache.js`).
   Определение вида, совет по поливу и по времени полива кэшируются на
   `AI_CACHE_TTL_SECONDS` (по умолчанию 7 суток), ответы чата — на
   `AI_CHAT_CACHE_TTL_SECONDS` (10 минут), ключи `ctp:ai:*`. Экономит платные
   вызовы Yandex Cloud. Одновременные одинаковые запросы считаются один раз:
   первый берёт лок `ctp:lock:ai-cache:*`, остальные забирают готовый ответ из кэша.

Ручки настройки (см. `10-configmap.yaml`): `AI_CACHE_ENABLED`,
`AI_CACHE_TTL_SECONDS`, `AI_CHAT_CACHE_TTL_SECONDS`, `REDIS_KEY_PREFIX`,
`REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS`, `REDIS_FAILURE_THRESHOLD`,
`REDIS_BREAKER_COOLDOWN_MS`, `REDIS_DEBUG`.

Расход и таймауты ИИ (тоже в `10-configmap.yaml`):

| Переменная | Смысл |
| --- | --- |
| `AI_DAILY_REQUEST_BUDGET` | Суточный лимит обращений к модели на весь сервис. `0` или пусто — **лимита нет**. При исчерпании чат отвечает фолбэком по данным приложения, гости получают `503` |
| `AI_PRICE_INPUT_PER_1K`, `AI_PRICE_OUTPUT_PER_1K`, `AI_PRICE_CACHED_PER_1K`, `AI_PRICE_CURRENCY` | Тариф для оценки стоимости в админке; без них стоимость не считается |
| `AI_CHAT_TIMEOUT_MS`, `AI_ADVICE_TIMEOUT_MS` | Таймаут одного HTTP-вызова модели |
| `AI_CHAT_DEADLINE_MS`, `AI_ADVICE_DEADLINE_MS` | Сквозной дедлайн на весь запрос (включая ретраи) |
| `WATERING_ADVICE_MAX_QUESTIONS` | Потолок уточняющих вопросов советника (по умолчанию 6, максимум 10) |
| `AI_CHAT_GUEST_DAILY_LIMIT`, `AI_CHAT_USER_DAILY_LIMIT` | Суточные лимиты сообщений гостя и пользователя |
| `APP_TIME_ZONE` | Пояс для метрик и для пользователей без личного пояса |
| `CHAT_LOG_RETENTION_DAYS`, `AI_ADVICE_LOG_RETENTION_DAYS` | Срок хранения чатов и журнала подсказок; `0` — бессрочно |

При недоступном Redis суточный бюджет продолжает считаться локально
(счётчик в памяти пода) — иначе авария Redis снимала бы ограничитель стоимости.
Значение видно в ответе `GET /api/admin/ai/metrics` как `budget.localFallbackUsed`.

Проверить, что backend действительно видит Redis: `GET /health` возвращает
`"redis": "ok"` (значения: `ok`, `unavailable`, `disabled`).

Посмотреть ключи вручную:

```powershell
kubectl exec -n webplant deployment/redis -- redis-cli dbsize
kubectl exec -n webplant deployment/redis -- redis-cli --scan --pattern 'ctp:*'
```

Пароль Redis лежит в секрете `webplant-secrets` (`REDIS_PASSWORD`, `REDIS_URL`),
наружу порт не публикуется — доступ только внутри кластера и через
`kubectl port-forward svc/redis 6379:6379 -n webplant`.

## Особенности Docker Desktop Kubernetes

Их полезно знать, чтобы не искать несуществующие проблемы:

* **Локальные образы не видны кластеру.** `imagePullPolicy: Never` даёт
  `ErrImageNeverPull`, поэтому `deploy.ps1` кладёт `docker save` в каталог
  `.k8s-images` (в корне репозитория), раздаёт его контейнером `ctp_k8s_img_server`
  на порту 8099, а DaemonSet `image-loader` скачивает архив и импортирует его в
  containerd каждой ноды через `ctr`.
  * Доставка 92-МБ архива на шесть нод через NAT занимает 10–25 минут: `deploy.ps1`
    ждёт до 30 минут (`-ImageLoadTimeoutMinutes`), раз в 30 секунд печатает, на
    сколько нод образ уже доехал. Если время вышло, DaemonSet **не удаляется** и
    продолжает докачивать образ в фоне — подождите и повторите
    `deploy.ps1 -SkipBuild -SkipImageLoad`.
  * `image-loader` докачивает архив (`wget -c`) и сверяет его размер с
    `IMAGE_TAR_SIZE`: busybox wget на уже полном файле получает HTTP 416, и без
    проверки размера нода не понимает, что качать больше нечего. Повторный импорт
    битого архива начинается заново.
* **NodePort и LoadBalancer не проброшены на хост.** Поэтому наружу стек отдаёт
  контейнер `ctp_k8s_gateway` (nginx `stream`): он живёт в docker-сети `kind`,
  проксирует на NodePort `30080` всех нод с пассивным исключением упавших и
  публикует порт 8090.
  * с хоста — `http://localhost:8090`
  * из compose-стека — `http://ctp_k8s_gateway:8090`
* **Ingress-контроллера в кластере нет**, а порты 80/443 на хосте заняты
  `ctp_nginx`. TLS и Let's Encrypt остаются за compose-стеком (см. «Переключение
  трафика»).
* **Тома класса `standard` (RWO, local-path).** PVC привязывается к ноде, где впервые запланирован
  под, поэтому обе реплики backend и Job-ы переноса данных живут на одной ноде.
  Для разъезда по нодам нужен RWX-класс (NFS/CephFS) — тогда же имеет смысл
  добавить HPA.

## Перенос боевых данных

`deploy.ps1 -RestoreData` делает следующее:

1. `pg_dump -Fc` из контейнера `ctp_postgres` (compose-стек только читается);
2. `tar czf` из каталога `Backend/uploads`;
3. Job `db-restore-*` пересоздаёт базу в кластере и заливает дамп (`pg_restore`);
4. Job `uploads-restore-*` распаковывает фото в PVC и выставляет владельца `1001:1001`.

Без флага перенос выполняется автоматически, если база в кластере пустая.
Перед восстановлением реплики backend в кластере масштабируются в 0 и поднимаются
обратно после завершения Job-ов.

Чтобы перенести свежие данные перед переключением трафика, просто запустите скрипт
ещё раз с `-RestoreData`.

## Переключение трафика (cutover)

Управляет режимами `Backend/k8s/scripts/switch-traffic.ps1`. Скрипт подменяет
`Backend/nginx/conf.d/default.conf`, проверяет конфигурацию через `nginx -t`
(при ошибке возвращает предыдущий файл) и делает graceful reload — активные
соединения не рвутся. Предыдущий конфиг сохраняется в `k8s/nginx/backups/`.

| Режим | `/api` и `/uploads` | `/health` | Когда использовать |
| --- | --- | --- | --- |
| `compose` | compose | compose | текущий боевой режим, полный откат |
| `canary` | compose | Kubernetes | промежуточный шаг: проверить связку с кластером на живом домене, не рискуя данными |
| `k8s` | Kubernetes | Kubernetes | полный переезд |

```powershell
# промежуточный (канареечный) режим
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target canary

# полный переезд: сначала перенести свежие данные и включить фоновые задачи
powershell -File Backend/k8s/scripts/deploy.ps1 -RestoreData -EnableBackgroundJobs
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target k8s

# откат в одну команду
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose
```

Как понять, какой стек ответил: в ответе `/health` поле `backgroundJobs`
(`true` — compose, `false` — Kubernetes). Скрипт печатает это после переключения.

Почему `/api` в режиме `canary` остаётся на compose: backend в кластере работает
со своей копией базы, поэтому записи (регистрации, поливы, фото) разошлись бы
между стеками. Промежуточный режим проверяет именно связку nginx → gateway →
кластер, а данные остаются в одном месте.

Если нужно, чтобы оба стека можно было держать включёнными одновременно (например,
для плавного переезда с фоновыми задачами в обоих), направьте их на один Redis —
локи `ctp:lock:job:*` общие, и каждая cron-задача выполнится один раз.
Проще всего указать в `Backend/.env` compose-стека тот же `REDIS_URL`, что и в
секрете кластера (`kubectl get secret webplant-secrets -n webplant -o jsonpath='{.data.REDIS_URL}'`).

Остановить лишний стек после переезда: `docker compose stop backend postgres backup`
(nginx и certbot остаются на месте и продолжают держать TLS).

Альтернатива для «полноценного» переезда: поднять в кластере ingress-контроллер
(например, ingress-nginx) и cert-manager, освободив порты 80/443, — но это уже
отдельная задача, потому что сейчас их занимает `ctp_nginx`.

## Обновление и откат приложения

```powershell
# собрать и выкатить новую версию (RollingUpdate, maxUnavailable: 0)
powershell -File Backend/k8s/scripts/deploy.ps1

# откатить на предыдущий образ
kubectl rollout undo deployment/backend -n webplant

# посмотреть историю ревизий
kubectl rollout history deployment/backend -n webplant
```

Если трафик уже идёт в кластер, после обновления фоновые задачи должны остаться
включёнными — иначе cron замолчит: `deploy.ps1 -EnableBackgroundJobs`.

Откат данных после полного переезда (`-Target k8s`) — только через обратный
перенос, иначе compose покажет состояние на момент переключения:

```powershell
powershell -File Backend/k8s/scripts/restore-back.ps1
powershell -File Backend/k8s/scripts/switch-traffic.ps1 -Target compose
```

Образ собирается из текущего состояния `Backend/`, тег по умолчанию —
`<версия из package.json>-<хеш git>`; при незакоммиченных правках добавляется
`-dirty-<хеш изменений>`, иначе loader счёл бы образ уже доставленным. На нодах
хранятся только текущий и предыдущий образы (для `rollout undo`), остальные
теги удаляются на шаге доставки. Нужный тег можно задать явно: `-Tag my-build`.

Для диагностики:

```powershell
kubectl logs -n webplant deployment/backend --tail=100
kubectl describe pod -n webplant -l app=webplant-backend
kubectl exec -n webplant deployment/backend -- node -e "fetch('http://127.0.0.1:5000/health').then(r=>r.text()).then(console.log)"
```

## Тесты и проверка Redis

Юнит-тесты backend не требуют Redis:

```powershell
cd Backend
npm test
```

Интеграционный тест распределённой блокировки (`utils/distributedLock.test.js`)
запускается только при заданном `REDIS_TEST_URL`. Проверка против Redis кластера
(пароль берётся из секрета и в консоль не выводится):

```powershell
kubectl port-forward -n webplant svc/redis 16379:6379   # в отдельном окне
$b64 = kubectl get secret webplant-secrets -n webplant -o jsonpath='{.data.REDIS_PASSWORD}'
$pass = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($b64))
$env:REDIS_TEST_URL = "redis://default:$pass@127.0.0.1:16379/0"
cd Backend; node --test utils/distributedLock.test.js
```

## Удаление стека

```powershell
# снять рабочие нагрузки, сохранив тома и секреты
powershell -File Backend/k8s/scripts/teardown.ps1

# удалить всё вместе с данными кластера (необратимо) и шлюзом
powershell -File Backend/k8s/scripts/teardown.ps1 -RemoveData -RemoveGateway
```
