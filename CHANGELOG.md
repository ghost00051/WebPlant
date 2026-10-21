# Changelog

Формат — [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версии — [SemVer](https://semver.org/lang/ru/).
Проект содержит **два независимо версионируемых пакета**: Backend (`Backend/package.json`) и
Frontend (`Frontend/package.json`). Фронт выкладывается по FTP отдельно от backend, поэтому
контракт API должен оставаться обратно совместимым (см. `docs/api/openapi.yaml`).

Тег `v<версия>` ставит git-хук `.githooks/pre-push` по версии из `Frontend/package.json`
(`WEBPLANT_VERSION_FILE=Backend/package.json` переключает источник версии). Из этого следует:
git-тег отражает версию фронта, версия backend фиксируется только в `Backend/package.json`.

Даты в разделах — даты коммитов из `git log`, в которых появилась соответствующая версия;
версия backend 1.2.6 появилась 2026-10-13 и не поднималась до 2026-10-20 включительно,
поэтому раздел включает изменения этого периода.

## [Unreleased]

### Added

* Журнал действий администратора `admin_audit_logs` (append-only, триггер запрещает
  `UPDATE`/`DELETE`), запись из админ-контроллеров, просмотр через `GET /api/admin/audit`,
  ретенция 365 дней через `purge_admin_audit_logs()` в ежедневной очистке.
* Отдельное согласие на маркетинговые письма: `users.marketing_email_opt_in` (+ `_at`,
  `_source`, `_opt_out_at`), чекбокс при регистрации, аудитория рассылок только по opt-in,
  отчёт о согласиях при создании рассылки.
* Отписка в один клик (RFC 8058): `GET/POST /api/users/unsubscribe` с HMAC-токеном,
  заголовки `List-Unsubscribe`/`List-Unsubscribe-Post` в письмах, HTML-страница
  подтверждения без JS.
* `GET /api/plants/export` — CSV активных растений (BOM UTF-8, `;`).
* `GET /api/system/metrics` — HTTP-метрики процесса для администратора (статусы, методы,
  маршруты, латентность).
* CronJob `db-backup` в Kubernetes (ежедневно 02:00 `Europe/Moscow`, PVC `backend-backups`,
  проверка дампа `pg_restore --list`, heartbeat `.last-success`, retention 14 дней) и
  ServiceAccount `webplant-backend` без RBAC и без монтирования токена.
* `Backend/.env.example` — шаблон окружения без секретов.
* Интеграционные тесты backend (`Backend/integration/`): миграции и их идемпотентность,
  ограничения схемы (уникальные индексы), транзакции и распределённая блокировка на живых
  Postgres и Redis; запуск — `RUN_INTEGRATION=1 npm run test:integration`, без флага кейсы
  помечаются `skip`.
* Линтер backend: `npm run lint` (`Backend/eslint.config.js`, ESLint 10).
* Нагрузочный профиль `Backend/scripts/load-test.k6.js` (k6).
* `ADMIN_PANEL_ALLOW_FRONTEND_ORIGIN` — временное разрешение админ-API с основного origin
  (по умолчанию `false`).
* Эксплуатационная документация: `README.md`, `ARCHITECTURE.md`, `DEPLOY.md`, `RUNBOOK.md`,
  `SECRETS.md`, `INCIDENT-RUNBOOK.md`, `CHANGELOG.md`, `THIRD_PARTY_NOTICES.md`.
* `docs/api/openapi.yaml` — контракт API (OpenAPI 3.1) для auth, users, plants, chat,
  notifications, push, system и admin-эндпоинтов.
* `docs/DATA-RETENTION.md` — сроки хранения данных, порядок удаления/экспорта, публикация
  изменений документов.
* `docs/REVIEW-CHECKLIST.md` — Definition of Ready/Done, чек-лист ревью PR, календарь
  регулярных проверок.
* `docs/ADR/0001-architecture.md` — ADR по стеку, cookie-сессиям, отдельному origin админки
  и Redis-локам.

### Changed

* CI расширен: backend-джоба гоняет линтер, миграции (включая повторный прогон на
  идемпотентность) и интеграционные тесты на сервисах PostgreSQL/Redis; добавлена джоба
  `security` (`npm audit`, `gitleaks`, CodeQL) и авто-issue `ci-failure`; добавлен
  `.github/dependabot.yml`.
* `backup.sh` проверяет дамп (`pg_restore --list`), пишет heartbeat `.last-success`,
  поддерживает опциональное шифрование (gpg/age) и offsite-копирование (rclone), падает
  при неудаче offsite, чтобы не давать ложный «успех».
* `validateJsonShape` — проверка формы JSON-тела для изменяющих запросов.

### Fixed

* Документация зафиксировала расхождение: `.gitignore` исключает `DEPLOY.md` и
  `upload-dist.ps1`, а `npm run deploy` ссылается на отсутствующий `deploy.mjs`
  (подробности — `README.md`, раздел «Известные ограничения репозитория»).

### Known issues

* JSON-экспорт аккаунта (`GET /api/users/me/export`) отдаёт пустые `wateredAt`, `daysLate`
  и `comment` в истории полива: поля строятся из несуществующих атрибутов модели
  (`action_at`, `hours_late`, `note`). До исправления используйте `GET /api/plants/history`
  или CSV `GET /api/plants/export`.
* Файлы фото чата (`uploads/chat`) не удаляются при ретенционной очистке `chat_logs` и при
  удалении чата из админки; удаляются только при удалении аккаунта.
* CronJob `db-backup` в Kubernetes не архивирует `uploads` — фото нужно архивировать
  отдельно.

## [1.2.6] — 2026-10-13 (Backend)

Версия в `Backend/package.json`: `1.2.6`. Изменения ниже — по коммитам `git log`
(2026-10-07 … 2026-10-20), версия в течение периода не менялась.

### Added

* Redis: кэш ответов ИИ, распределённые локи cron-задач, общий store rate-limit;
  circuit breaker и безопасная деградация при недоступном Redis (`Backend/redis.js`,
  `Backend/utils/distributedLock.js`, `Backend/utils/rateLimitStore.js`).
* Развёртывание в Kubernetes: namespace `webplant`, манифесты PostgreSQL/Redis/backend,
  ConfigMap/Secret, PVC, PDB, NodePort, gateway, скрипты `deploy.ps1`, `status.ps1`,
  `switch-traffic.ps1`, `restore-back.ps1`, `teardown.ps1` (`Backend/k8s/`).
* Сброс пароля по email: одноразовые токены (TTL 30 минут, хранение sha256-хэша),
  письма через SMTP, ограничения частоты, ссылка `/reset-password`.
* Почтовый сервис: приветственные письма, `MAIL_FROM`/`MAIL_REPLY_TO`, тестовая отправка
  и preview из админки, рассылки письмами (`mail_broadcasts`, `mail_broadcast_recipients`)
  с батчами и восстановлением зависших отправок.
* Админ-аналитика: обзор, таймсерии, разбивки, посещения (`site_visit_days`), телеметрия
  ИИ (`/api/admin/ai/metrics`, `/api/admin/ai/logs`), справочники пользователей, растений,
  поливов, фото и чата.
* Часовой пояс пользователя (`users.timezone`): расчёт суток и времени полива, пересчёт
  расписания при смене пояса; часовой пояс по умолчанию — `APP_TIME_ZONE`.
* Миниатюры фото растений (`sharp`), раздача `/uploads/thumbs`, скрипт
  `Backend/scripts/generate-plant-thumbs.mjs`.
* ИИ-помощник: советник по поливу с уточняющими вопросами, совет по времени суток,
  определение вида растения, чат с историей сессий, анализ фото; телеметрия вызовов,
  суточный бюджет, кэш Redis, фолбэк по данным приложения (`degraded`).
* Интенты чата: ответы по данным приложения без обращения к модели (`chatIntent.js`).
* Уведомления: утренняя сводка, напоминания «за день» и «в день полива», советы по уходу
  (`care_reminder`, `care_tip`), дедупликация по `dedupe_key`, распределённые локи и
  раздельные тики планировщика.
* Push-рассылки из админки: аудитория `all`/`users`, отложенная отправка, чанки,
  идемпотентность по `Idempotency-Key`, отмена, защита от дублей.
* Адаптивный интервал полива: обучение по истории поливов (`plants.metadata.prediction`),
  ограничение по группе растения и ±2 дня за событие, аудит
  `Backend/scripts/watering-prediction-audit.mjs`.
* Экспорт и удаление аккаунта: `GET /api/users/me/export` (формат
  `webplant-account-export` v1) и `DELETE /api/users/me` с подтверждением словом `УДАЛИТЬ`
  и паролем.
* Проверочные скрипты: `verify-notifications.ps1`, `admin-api-integration.mjs`,
  `send-test-mail.mjs`, `send-welcome-emails.mjs`, `normalize-watering-hours.mjs`,
  `apply-migrations.ps1`.

### Changed

* Схема БД расширена миграциями: `auth_sessions`, `passkeys`, `passkey_challenges`,
  `notification_preferences`, `notifications`, `push_broadcasts`, `push_broadcast_recipients`,
  `password_reset_tokens`, `mail_broadcasts`, `mail_broadcast_recipients`, `ai_advice_logs`,
  `plant_care_plans`, `site_visit_days`, `users.created_at`, `users.timezone`,
  `users.welcome_email_sent_at`, индексы уведомлений.
* Production-старт проверяет схему и завершается с подсказкой о миграции при расхождении.
* Планировщик вынесен в отдельные cron-задачи (напоминания, сводка, советы) с раздельными
  локами Redis.
* Пул соединений Sequelize и таймауты запросов вынесены в переменные окружения
  (`DB_POOL_*`, `DB_*_TIMEOUT_MS`, `DB_RETRY_MAX`).
* Ужесточены проверки окружения в production (`SECRET_KEY` ≥ 32 байт, HTTPS-`FRONTEND_URL`,
  конфигурация passkey, предупреждения по SMTP).

### Fixed

* Дубли и пропуски напоминаний при нескольких репликах и при недоступном Redis.
* Зависшие push- и mail-рассылки восстанавливаются (stale `sending`), прогресс
  сохраняется по чанкам.
* Ошибки планировщика больше не роняют процесс; каждый тик обёрнут в try/catch с логами.
* Исправлены проблемы кубернетеса и docker при деплое, возвращён BOM в `deploy.ps1`
  (без него PowerShell 5.1 не разбирает кириллицу).
* Исправлена выдача советов и чата при сбоях модели: возвращается фолбэк по данным
  приложения вместо `500`.
* Исправлены уведомления о поливе и диагностика по фото.

### Security

* Cookie-сессии с отзывом через `auth_sessions`, `httpOnly`/`Secure`/`SameSite=None`,
  домен `.checktheplants.ru`.
* Проверка `Origin`/`Sec-Fetch-Site` для изменяющих запросов, CORS-allowlist, ограничение
  `Content-Type` (`415`) и размера тела (100 kb).
* Подписанные гостевые токены (HMAC-SHA256 на `SECRET_KEY`), приём legacy-токенов ограничен
  30 днями.
* Passkeys (`@simplewebauthn/server`) с хранением челленджей в БД и истечением.
* Rate-limit на все публичные и админские группы эндпоинтов, общий store в Redis.
* bcrypt-хэши паролей, фиктивное сравнение при неизвестном email (защита от user enumeration
  по времени ответа), единые обобщённые сообщения об ошибках.
* `helmet`, `X-Robots-Tag: noindex`, `robots.txt` с запретом обхода, `X-Content-Type-Options`
  для `/uploads`.
* Журнал доступа и ошибок (`middleware/accessLog.js`), `_notif_smoke.mjs` исключён из образа
  (`.dockerignore`), потому что умеет чеканить реальные токены.

## [1.2.20] — 2026-10-20 (Frontend)

Версия в `Frontend/package.json`: `1.2.20`. Изменения — по коммитам `git log`
(2026-10-17 … 2026-10-20) и предшествующим правкам вёрстки, попавшим в эту версию.

### Added

* Админ-панель `Frontend/admin/` (обзор, посетители, пользователи, растения, поливы, фото,
  чат, рассылки и сервер), тёмная/светлая темы, графики на SVG без внешних библиотек,
  выгрузка CSV; отдельный `.htaccess` с CSP и запретом индексации.
* Экраны и логика вход/регистрация с passkey (`@simplewebauthn/browser`), сброс пароля по
  ссылке из письма, экран подтверждения удаления аккаунта с экспортом данных.
* Чат с ИИ: история переписки, список сессий, прикрепление и анализ фото, индикация
  деградированных ответов, тикер подсказок.
* Уведомления: колокольчик с непрочитанными, экран уведомлений, запрос разрешения на push,
  отписка, подсказка установки PWA.
* Публичные разделы: справочник растений, гайды по уходу, страницы контента, калькуляторы
  в «Инструментах», SEO-мета и sitemap.
* Панели администрирования рассылок (push и email) внутри фронта.
* E2E и smoke-проверки: `scripts/run-e2e.mjs`, `scripts/admin-panel-smoke.mjs`,
  `scripts/verify-build.mjs`, `scripts/verify-routing.mjs`,
  `scripts/check-security-headers.mjs`, `scripts/build-manifest.mjs`, `scripts/indexnow.mjs`.
* CI-workflow `.github/workflows/ci.yml`: lint, unit-тесты, сборка, проверки сборки/роутинга/
  CSP, артефакт `build-info.json`, a11y/E2E smoke (опционально).
* Git-хук `.githooks/pre-push`: автотег `v<версия>` по `Frontend/package.json`.

### Changed

* Доступность: skip-link, фокус-стили, ARIA-атрибуты, клавиатурная навигация, контраст тем.
* Производительность: разделение чанков (`react-vendor`, `router`, `vendor`), предгенерация
  публичных страниц, локальные шрифты Inter, миниатюры фото растений.
* UX: адаптивная навигация и мобильные панели, единые состояния загрузки/ошибок
  (`RouteFallback`, `ErrorBoundary`), темы оформления.
* Улучшено определение частоты полива в интерфейсе (интервалы по группам растений,
  подсказки по сезону, согласование с бэкендом).
* Сборка: `build` теперь включает генерацию изображений растений, SEO-мета, `vite build`,
  prerender и `build-info.json`; `verify` объединяет проверки сборки, роутинга, заголовков
  и манифеста.

### Fixed

* Исправлена конфигурация Vite (проксирование `/api`, снятие `Secure`/`SameSite=None` у
  cookie при локальной разработке, определение версии приложения).
* Исправлены ошибки чата и повторные отправки сообщений.
* Исправлены проблемы отображения фото (миниатюры, `loading`/`sizes`, fallback).

### Security

* Строгий CSP и security-заголовки в сборке и в админке (`.htaccess`), проверка
  `npm run verify`/`check-security-headers.mjs`.
* Cookie-сессии для API с `credentials: 'include'`, отсутствие токенов в `localStorage`.
* Проверки сборки защищают от попадания облачных заглушек и посторонних файлов в `dist`.
