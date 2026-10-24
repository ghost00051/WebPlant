# WebPlant («Лейка»)

Веб-приложение для учёта комнатных растений: карточки растений, расписание и история полива,
фотографии, напоминания, push-уведомления и ИИ-помощник «Лейка» (в интерфейсе — Алиса),
который отвечает на вопросы по уходу, подбирает интервал полива, время полива и
диагностирует растение по фото. Дополнительно сайт содержит публичные справочники по
растениям и уходу (SEO-раздел) и отдельную админ-панель.

Боевые адреса:

| Что | Адрес |
| --- | --- |
| Сайт (фронтенд, SPA) | https://checktheplants.ru |
| API (backend) | https://server.checktheplants.ru/api |
| Админ-панель | https://admin.checktheplants.ru |
| pgAdmin (только за nginx, HTTPS) | https://pgadmin.checktheplants.ru |

Версии в репозитории (источник — `package.json`):

| Компонент | Версия | Файл |
| --- | --- | --- |
| Backend | **1.2.6** | `Backend/package.json` |
| Frontend | **1.2.20** | `Frontend/package.json` |

Версии независимы: фронт выкладывается по FTP отдельно от backend, поэтому контракт `/api`
должен оставаться обратно совместимым (см. `docs/api/openapi.yaml` и `CHANGELOG.md`).

## Стек

**Backend 1.2.6**

* Node.js 22 (`Backend/Dockerfile`, образ `node:22-alpine`), ESM, Express 5;
* Sequelize 6 + PostgreSQL 16 (`pg`, `pg-hstore`); миграции — обычные SQL-файлы
  в `Backend/migrations/`, применяются по возрастанию имени;
* Redis 7 (`redis`, `rate-limit-redis`) — кэш ответов ИИ, распределённые локи cron-задач,
  общий store для rate-limit;
* Yandex Cloud AI через SDK `openai` (`baseURL: https://ai.api.cloud.yandex.net/v1`,
  модели вида `gpt://<folder>/<model>`);
* аутентификация: `jsonwebtoken` (JWT в httpOnly cookie) + `auth_sessions` для отзыва,
  `bcrypt`, passkeys через `@simplewebauthn/server`;
* `web-push` (VAPID), in-app уведомления в БД;
* `nodemailer` (SMTP) — сброс пароля, приветственные письма, рассылки из админки;
* `multer` + `sharp` (загрузка фото и миниатюры), `helmet`, `cors`, `express-rate-limit`,
  `node-cron`, `dockerode` (телеметрия контейнеров в админке).

**Frontend 1.2.20**

* React 19, `react-router-dom` 7, `react-day-picker`, сборка Vite 8 (rolldown);
* PWA-манифест, service worker, темы оформления, passkeys в браузере
  (`@simplewebauthn/browser`);
* публичные страницы предгенерируются скриптом `scripts/prerender.mjs`, SEO-мета —
  `scripts/generate-seo-meta.mjs`;
* админка `Frontend/admin/` — статический сайт (HTML + CSS + ES-модули) без сборки,
  выкладывается в корень поддомена `admin.checktheplants.ru` как есть.

**Инфраструктура**

* Docker Compose (`Backend/docker-compose.yml`): `postgres`, `redis`, `migrate`,
  `backend`, `backup`, `nginx`, `certbot`, `docker-socket-proxy`;
* Kubernetes (`Backend/k8s/`, namespace `webplant`, Docker Desktop Kubernetes);
* nginx в compose держит 80/443 и TLS Let's Encrypt (certbot), конфиги
  `Backend/nginx/conf.d/default.conf` переключаются скриптом
  `Backend/k8s/scripts/switch-traffic.ps1` между режимами `compose` / `canary` / `k8s`;
* деплой фронта — FTP-выгрузка каталога `Frontend/dist` (см. `DEPLOY.md`).

## Структура репозитория

```text
WebPlant/
├── Backend/                     backend-сервис и инфраструктура вокруг него
│   ├── index.js                 точка входа Express: middleware, маршруты, /health, /livez
│   ├── db.js                    подключение Sequelize (пул, таймауты, retry)
│   ├── redis.js                 клиент Redis, circuit breaker, префикс ключей
│   ├── Dockerfile               node:22-alpine, npm ci --omit=dev, USER nodejs
│   ├── docker-compose.yml       боевой compose-стек (postgres/redis/migrate/backend/…)
│   ├── docker-compose.pgadmin.yml  pgAdmin (отдельная internal-сеть)
│   ├── .env.example             шаблон окружения backend (без секретов)
│   ├── backup.sh                pg_dump + tar uploads, проверка дампа, шифрование/offsite, retention 14 дней
│   ├── migrations/              SQL-миграции (применяются по имени, идемпотентны)
│   ├── models/                  модели Sequelize и associations.js
│   ├── routes/                  маршруты Express (users, plants, chat, notifications, push, admin…)
│   ├── controllers/             обработчики (в т.ч. adminAnalytics/Manage/Push/Mail/Ai)
│   ├── services/                ai, careAdvice/carePlan, push, mail, passwordReset, welcomeEmail
│   ├── middleware/              auth, guestToken, admin, upload, accessLog, validateJsonShape, validateParam
│   ├── jobs/                    reminderService, cleanExpiredTokens, push/mail broadcast jobs
│   ├── utils/                   schedule, prediction, locks, cache, audit, marketing consent, валидация
│   ├── integration/             интеграционные тесты (Postgres + Redis)
│   ├── scripts/                 apply-migrations.ps1, verify-notifications.ps1, load-test.k6.js, аудит полива
│   ├── nginx/                   Dockerfile + conf.d (default/pgadmin)
│   ├── certbot/                 рабочий каталог Let's Encrypt (не в git)
│   ├── backups/                 дампы БД и uploads (не в git, retention 14 дней)
│   └── k8s/                     манифесты (в т.ч. CronJob db-backup, ServiceAccount), gateway, deploy/rollback-скрипты
├── Frontend/
│   ├── src/                     React-приложение (component/, utils/, data/, styles/)
│   ├── admin/                   статическая админ-панель (свой README)
│   ├── public/                  статика, шрифты Inter, иконки, sitemap
│   ├── scripts/                 сборка, prerender, verify, e2e, admin-smoke, indexnow
│   ├── document/                PDF/DOCX юридических документов
│   └── vite.config.js           dev-proxy /api, chunking, версия приложения
├── .github/workflows/ci.yml     CI: frontend, backend (lint/unit/миграции/интеграция), security, a11y/E2E
├── .github/dependabot.yml       автоматические PR обновлений зависимостей
├── .githooks/                   pre-push: автотег v<version> из Frontend/package.json
├── docs/                        эксплуатационная документация и OpenAPI
├── ARCHITECTURE.md              компоненты, потоки, схема БД, фоновые задачи
├── DEPLOY.md                    порядок деплоя, проверки, откат, чек-лист
├── RUNBOOK.md                   инциденты, восстановление, ротации
├── INCIDENT-RUNBOOK.md          роли, каналы, коммуникация, постмортем
├── SECRETS.md                   реестр секретов и порядок ротации
├── CHANGELOG.md                 история версий (Keep a Changelog)
├── THIRD_PARTY_NOTICES.md       сторонние зависимости, шрифт, иллюстрации
├── upload-dist.ps1              FTP-выгрузка Frontend/dist (файл в .gitignore)
└── deploy.config.example.json   образец конфигурации FTP-деплоя без секретов
```

## Быстрый старт

### Требования

* Node.js 22+ и npm (в CI используется Node 24, в образе — `node:22-alpine`);
* PostgreSQL 16 (локально, в Docker или внешний) — без него backend не стартует;
* по желанию: Redis 7 (кэш ИИ, локи, общий rate-limit), Docker Desktop, доступ к Yandex Cloud AI;
* Windows PowerShell 5.1+ для скриптов `Backend/k8s/scripts/*.ps1` и
  `Backend/scripts/apply-migrations.ps1`.

### Backend локально

```powershell
cd Backend
npm ci
Copy-Item .env.example .env   # шаблон в репозитории; заполните DB_*, SECRET_KEY и остальное
npm run dev          # node --watch index.js, порт из PORT (по умолчанию 5000)
```

Проверка:

```powershell
curl http://localhost:5000/livez
curl http://localhost:5000/health
```

Особенности локального запуска:

* при `NODE_ENV !== 'production'` схема создаётся автоматически (`sequelize.sync()`),
  миграции можно не применять; в production схема **проверяется при старте** и сервис
  падает, если таблиц/колонок моделей не хватает;
* `SECRET_KEY` нужен всегда (им подписываются JWT), в production — не короче 32 байт;
* `BACKGROUND_JOBS_ENABLED=false` отключает cron-задачи (напоминания, рассылки, очистку);
* без Redis сервис работает в деградированном режиме (`/health` → `"redis": "unavailable"`),
  без SMTP восстановление пароля отвечает `503`, без ключей ИИ чат отвечает фолбэком.

### Backend в Docker Compose

```powershell
# из корня репозитория; файл окружения — Backend/.env
docker compose -f Backend/docker-compose.yml up -d --build
docker compose -f Backend/docker-compose.yml ps
curl http://localhost/health          # nginx проксирует /health на активный backend
```

`/health` через nginx работает только если `Backend/nginx/conf.d/default.conf` указывает на
живой upstream: в режиме `compose` это `backend:5000`, в режиме `k8s` — контейнер
`ctp_k8s_gateway:8090` (переключение — `Backend/k8s/scripts/switch-traffic.ps1`). Если
gateway не запущен, проверяйте backend напрямую: `docker compose -f Backend/docker-compose.yml exec backend node -e "fetch('http://127.0.0.1:5000/health').then(r=>r.text()).then(console.log)"`.

Что происходит при `up -d`:

1. поднимаются `postgres` и `redis` (с healthcheck);
2. сервис `migrate` применяет все `Backend/migrations/*.sql` и завершается;
3. стартует `backend` (`depends_on: migrate: service_completed_successfully`);
4. `backup` раз в 24 часа делает дамп БД и архив `uploads` в `Backend/backups`;
5. `nginx` поднимается после healthy-backend, `certbot` продлевает сертификаты.

Полный разбор порядка выкладки, проверок и откатов — в `DEPLOY.md`.

### Frontend локально

```powershell
cd Frontend
npm ci
Copy-Item .env.example .env    # при необходимости поправьте адрес API
npm run dev                    # Vite, http://localhost:5173
```

`vite.config.js` проксирует `/api` на `VITE_API_PROXY_TARGET` (по умолчанию
`https://server.checktheplants.ru`), подменяет `Origin` на `VITE_API_PROXY_ORIGIN` и
снимает `Secure`/`SameSite=None` у проксируемых cookie — чтобы вход работал с localhost.

Сборка и проверки:

```powershell
cd Frontend
npm run build      # generate-plant-images → generate-seo-meta → vite build → prerender → build-manifest
npm run verify     # verify-build + verify-routing + check-security-headers + build-manifest --check
npm run verify:admin
```

## Переменные окружения

Значения в репозитории не хранятся: `Backend/.env` (и `Frontend/.env`) в `.gitignore`.
В Kubernetes те же имена приходят из ConfigMap `webplant-config`, ConfigMap `webplant-env`
и Secret `webplant-secrets` (создаются `Backend/k8s/scripts/deploy.ps1` из `Backend/.env`).

### Backend — обязательные в production

Валидация выполняется при старте (`validateProductionConfig()` в `Backend/index.js`).

| Переменная | Назначение | Обязательна |
| --- | --- | --- |
| `NODE_ENV` | `production` включает проверку схемы, secure-cookie, строгие origin | да (production) |
| `PORT` | порт HTTP, по умолчанию 5000 | нет |
| `DB_NAME` | имя базы PostgreSQL | да |
| `DB_USER` | пользователь БД | да |
| `DB_PASSWORD` | пароль БД | да |
| `DB_HOST` | хост БД (`postgres` в compose/k8s, `localhost` локально) | нет (default `localhost`) |
| `DB_PORT` | порт БД (default 5432) | нет |
| `SECRET_KEY` | подпись JWT; в production ≥ 32 байт | **да** |
| `FRONTEND_URL` | HTTPS-origin(ы) фронта через запятую; используется в CORS, письмах, passkey | **да** |
| `FRONTEND_ORIGIN` | origin для проверки passkey (WebAuthn) | **да** |
| `RP_ID` | Relying Party ID для passkey (`checktheplants.ru`) | **да** |
| `VAPID_SUBJECT` | контакт владельца push-подписки (`mailto:`/URL) | **да** |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | ключи web-push | **да** |
| `RP_NAME` | отображаемое имя для passkey (по умолчанию «Лейка») | нет |
| `PASSKEY_REQUIRE_USER_VERIFICATION` | требовать биометрию/PIN при passkey-входе (по умолчанию `true`) | нет |

### Backend — функциональные (без них сервис работает в деградированном режиме)

| Переменная | Назначение |
| --- | --- |
| `ADMIN_PANEL_ORIGIN` | origin(ы) админки для CORS (без пути, через запятую) |
| `ADMIN_PANEL_ALLOW_FRONTEND_ORIGIN` | временно разрешить админ-API с основного origin фронта (`false` по умолчанию; ослабляет изоляцию админки) |
| `LOCAL_DEV_ORIGINS` | HTTP-origin'ы localhost/приватных IP для локальной отладки (только не-production) |
| `AUTH_COOKIE_DOMAIN` | домен cookie (по умолчанию в production `.checktheplants.ru`; `host-only` отключает) |
| `APP_TIME_ZONE` | часовой пояс по умолчанию (`Europe/Moscow` в ConfigMap) |
| `REDIS_URL` | строка подключения Redis; альтернатива — `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_USERNAME`, `REDIS_DB` | разбор адреса Redis по частям |
| `REDIS_KEY_PREFIX` | префикс ключей (`ctp`) |
| `REDIS_CONNECT_TIMEOUT_MS`, `REDIS_COMMAND_TIMEOUT_MS` | таймауты Redis |
| `REDIS_FAILURE_THRESHOLD`, `REDIS_BREAKER_COOLDOWN_MS` | circuit breaker Redis |
| `REDIS_DEBUG` | подробные логи Redis (`true`) |
| `YANDEX_CLOUD_FOLDER` | folder ID Yandex Cloud для `gpt://<folder>/<model>` |
| `YANDEX_CLOUD_API_KEY` | API-ключ сервисного аккаунта Yandex Cloud |
| `YANDEX_CLOUD_MODEL` | модель для чата/советов (default `deepseek-v4-flash/latest`) |
| `YANDEX_CLOUD_VISION_MODEL` | модель для анализа фото (default `deepseek-v4.1-flash/latest`) |
| `AI_CACHE_ENABLED`, `AI_CACHE_TTL_SECONDS`, `AI_CHAT_CACHE_TTL_SECONDS` | кэш ответов ИИ в Redis |
| `AI_DAILY_REQUEST_BUDGET` | суточный лимит обращений к модели (0/пусто — без лимита) |
| `AI_CHAT_TIMEOUT_MS`, `AI_ADVICE_TIMEOUT_MS`, `AI_VISION_TIMEOUT_MS` | таймауты одного вызова модели |
| `AI_CHAT_DEADLINE_MS`, `AI_ADVICE_DEADLINE_MS`, `AI_VISION_DEADLINE_MS` | сквозной дедлайн запроса |
| `AI_CHAT_GUEST_DAILY_LIMIT`, `AI_CHAT_USER_DAILY_LIMIT` | суточные лимиты сообщений чата |
| `WATERING_ADVICE_MAX_QUESTIONS` | потолок уточняющих вопросов советника |
| `AI_PRICE_INPUT_PER_1K`, `AI_PRICE_OUTPUT_PER_1K`, `AI_PRICE_CACHED_PER_1K`, `AI_PRICE_CURRENCY` | тариф для оценки стоимости в админке |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | отправка писем (без них сброс пароля и рассылки → `503`) |
| `MAIL_FROM`, `MAIL_REPLY_TO` | адрес отправителя и reply-to |
| `MAIL_BROADCAST_BATCH_SIZE`, `MAIL_BROADCAST_SYNC_BATCH`, `MAIL_BROADCAST_DELAY_MS`, `MAIL_BROADCAST_DEDUPE_WINDOW_MS` | параметры рассылок писем |
| `PUSH_CONCURRENCY` | параллелизм отправки push |
| `UNSUBSCRIBE_URL_BASE` | базовый URL страницы отписки от рассылок (по умолчанию `<FRONTEND_URL>/unsubscribe`) |
| `CHAT_LOG_RETENTION_DAYS`, `AI_ADVICE_LOG_RETENTION_DAYS` | сроки хранения чатов и журнала ИИ (0 — бессрочно) |
| `NOTIFICATION_RETENTION_DAYS` | срок хранения уведомлений |
| `GUEST_PUSH_RETENTION_DAYS`, `INVALIDATED_PUSH_RETENTION_DAYS` | сроки хранения push-подписок |
| `BACKUP_RETENTION_DAYS` | срок хранения дампов (по умолчанию 14 дней) |
| `BACKUP_ENCRYPTION_PASSPHRASE` | пароль шифрования бэкапов (gpg/age); пусто — без шифрования |
| `BACKUP_OFFSITE_TARGET` | offsite-копирование дампов через `rclone`; пусто — выключено |
| `BACKGROUND_JOBS_ENABLED` | `false` полностью отключает cron-задачи |
| `DEPLOY_TARGET` | метка окружения в `/health` (`compose` / `kubernetes`) |
| `DB_POOL_MAX`, `DB_POOL_MIN`, `DB_POOL_ACQUIRE_MS`, `DB_POOL_IDLE_MS`, `DB_POOL_EVICT_MS` | пул соединений Sequelize |
| `DB_STATEMENT_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS`, `DB_RETRY_MAX` | таймауты и ретраи запросов |
| `DOCKER_HOST`, `DOCKER_STATS_ENABLED`, `DOCKER_EXPECTED_STOPPED`, `DOCKER_COMPOSE_PROJECT` | телеметрия контейнеров в админке (`DOCKER_STATS_ENABLED=false` отключает); в кластере — `DOCKER_HOST` до `docker-socket-proxy`, список намеренно остановленных в `DOCKER_EXPECTED_STOPPED`, фильтр по compose-проекту в `DOCKER_COMPOSE_PROJECT` |
| `DEPLOY_PROTOCOL`, `DEPLOY_HOST`, `DEPLOY_PORT`, `DEPLOY_USER`, `DEPLOY_PASSWORD`, `DEPLOY_REMOTE_ROOT`, `DEPLOY_SITE_URL`, `DEPLOY_CONFIG_PATH` | параметры FTP-деплоя фронта (`deploy.config.example.json`, `.env.example`) |

### Frontend

| Переменная | Назначение |
| --- | --- |
| `VITE_API_URL` | базовый URL API (по умолчанию `https://server.checktheplants.ru/api`) |
| `VITE_API_PROXY_TARGET` | цель dev-прокси `/api` (по умолчанию боевой API) |
| `VITE_API_PROXY_ORIGIN` | подменяемый `Origin` для dev-прокси |
| `VITE_APP_VERSION` | подставляется Vite из `package.json` (не задаётся вручную) |

Секреты и порядок их ротации — в `SECRETS.md`.

## Тесты и проверки

| Команда | Что проверяет |
| --- | --- |
| `cd Backend; npm test` | unit-тесты backend (`node --test`): auth, guest-токены, Redis, планировщик, расписание полива, ИИ, push/mail-валидация, экспорт/удаление аккаунта (интеграционные кейсы без `RUN_INTEGRATION=1` помечаются `skip`) |
| `cd Backend; RUN_INTEGRATION=1 npm run test:integration` | интеграционные тесты на живых Postgres и Redis: миграции и их идемпотентность, ограничения схемы, транзакции, распределённая блокировка (нужны `DB_*` и `REDIS_URL`) |
| `cd Backend; npm run lint` | ESLint для backend (`eslint.config.js`) |
| `cd Frontend; npm test` | unit-тесты фронта (`node --test "src/**/*.test.js"`) |
| `cd Frontend; npm run lint` | ESLint (0 ошибок в CI) |
| `cd Frontend; npm run build` | сборка + prerender + `dist/build-info.json` |
| `cd Frontend; npm run verify` | сборка, роутинг, security-заголовки/CSP, манифест |
| `cd Frontend; npm run verify:admin` | headless-прогон админ-панели (8 разделов) |
| `cd Frontend; npm run test:e2e` | E2E через `scripts/run-e2e.mjs` (нужен Chrome; в CI `WEBPLANT_E2E_REQUIRED=1`) |
| `powershell -File Backend/scripts/verify-notifications.ps1` | проверка уведомлений/идемпотентности на одноразовой БД |
| `node Backend/scripts/admin-api-integration.mjs seed|verify` | 94 проверки админ-API на отдельной тестовой БД |
| `cd Backend; node scripts/watering-prediction-audit.mjs --days=365` | read-only аудит адаптивного интервала полива |
| `k6 run Backend/scripts/load-test.k6.js` | нагрузочный профиль (нужен установленный [k6](https://k6.io); запускать на тестовой среде) |

Интеграционный тест распределённой блокировки запускается только при заданном
`REDIS_TEST_URL` (`node --test utils/distributedLock.test.js`). Подробности — в
`Backend/k8s/README.md`.

CI (`.github/workflows/ci.yml`) на каждый push/PR:

* `frontend` — `npm ci` → lint → unit → build → verify → артефакт `build-info.json`;
* `backend` — lint → unit → подготовка БД (`scripts/init-integration-db.mjs`) → применение
  всех миграций → повторный прогон (идемпотентность) → интеграционные тесты на сервисах
  PostgreSQL и Redis (`RUN_INTEGRATION=1`);
* `security` — `npm audit --audit-level=high` (backend и frontend), `gitleaks`
  (скан секретов), CodeQL (`javascript-typescript`, `security-and-quality`);
* `notify-failure` — создаёт/обновляет issue с меткой `ci-failure`;
* `a11y-smoke` — опционально: axe-smoke, E2E, admin-smoke (если в чекауте есть
  `state/frontend-audit/tools/audit.mjs`).

Обновления зависимостей приходят PR-ами от `.github/dependabot.yml`. Прикладные секреты в
CI не используются (только `GITHUB_TOKEN` и, при необходимости, `GITLEAKS_LICENSE`).

## Где документация

| Документ | О чём |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | компоненты, потоки (auth, passkeys, ИИ, push, рассылки), схема БД, фоновые задачи и локи, точки отказа |
| [DEPLOY.md](DEPLOY.md) | порядок деплоя (бэкап → миграции → раскатка), compose и k8s, FTP-деплой фронта, проверки, откат, окно и ответственный, чек-лист |
| [RUNBOOK.md](RUNBOOK.md) | инциденты: 5xx, БД, Redis, диск, TLS, SMTP/ИИ, утечка секретов; восстановление БД и uploads; ротации; RPO/RTO |
| [INCIDENT-RUNBOOK.md](INCIDENT-RUNBOOK.md) | роли и каналы при инциденте, шаблоны коммуникации, статус-страница, уведомление РКН, постмортем |
| [SECRETS.md](SECRETS.md) | реестр секретов: где хранится, владелец, ротация, действия при утечке |
| [CHANGELOG.md](CHANGELOG.md) | версии Backend 1.2.6 и Frontend 1.2.20, раздел Unreleased |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | лицензии зависимостей, шрифт Inter, иллюстрации |
| [docs/api/openapi.yaml](docs/api/openapi.yaml) | контракт API (OpenAPI 3.1) |
| [docs/DATA-RETENTION.md](docs/DATA-RETENTION.md) | сроки хранения данных, удаление и экспорт, публикация изменений документов |
| [docs/REVIEW-CHECKLIST.md](docs/REVIEW-CHECKLIST.md) | Definition of Ready/Done, чек-лист ревью PR, календарь регулярных проверок |
| [docs/ADR/0001-architecture.md](docs/ADR/0001-architecture.md) | решение по стеку, cookie-сессиям, отдельному origin админки и Redis-локам |
| [Backend/k8s/README.md](Backend/k8s/README.md) | Kubernetes: деплой, cutover, Redis, перенос данных, диагностика |
| [Backend/PGADMIN.md](Backend/PGADMIN.md) | pgAdmin, доступ к БД, изоляция сетей |
| [Frontend/admin/README.md](Frontend/admin/README.md) | админ-панель: разделы, выгрузка на поддомен, CSP |
| [.githooks/README.md](.githooks/README.md) | автотег версии при push |

## Известные ограничения репозитория

* `.gitignore` содержит строки `DEPLOY.md` и `upload-dist.ps1`: файл `DEPLOY.md` создан в
  рабочем каталоге, но **не попадёт в git**, пока правило не удалено; `upload-dist.ps1`
  (FTP-выгрузка) по этой же причине не версионируется. Рекомендуется убрать обе строки
  и закоммитить документ и скрипт — см. `DEPLOY.md`, раздел «FTP-деплой фронта».
* `Frontend/package.json` содержит скрипт `deploy` (`node ../deploy.mjs`), но файла
  `deploy.mjs` в репозитории нет (он в `.gitignore`) — `npm run deploy` не работает.
  Рабочий способ выгрузки фронта — `upload-dist.ps1` (см. `DEPLOY.md`).
* Фоновые задачи выполняются внутри процесса backend; единственность выполнения в
  нескольких репликах обеспечивают Redis-локи, при недоступном Redis каждая реплика
  выполняет задачу сама (см. `ARCHITECTURE.md`).
* Шрифт Inter (OFL 1.1) лежит в `Frontend/public/fonts/`, текст лицензии в репозиторий
  не добавлен (см. `THIRD_PARTY_NOTICES.md`).
* В JSON-экспорте аккаунта (`GET /api/users/me/export`) поля истории полива
  `wateredAt`/`daysLate`/`comment` приходят пустыми (формируются из несуществующих
  атрибутов модели). Для полной истории используйте `GET /api/plants/history` или CSV
  `GET /api/plants/export`; пробел описан в `docs/DATA-RETENTION.md` §3.
* В Kubernetes CronJob `db-backup` сохраняет только дамп БД; архив `uploads` туда не
  входит — фото нужно архивировать отдельно (`DEPLOY.md` §1.2, `RUNBOOK.md` §7.3).
