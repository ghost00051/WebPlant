# Архитектура WebPlant («Лейка»)

Документ описывает фактическое устройство системы по коду репозитория: компоненты, потоки
запросов, схему БД, фоновые задачи и точки отказа. Версии: Backend 1.2.6, Frontend 1.2.20.

## 1. Верхнеуровневая схема

```text
        браузер пользователя                        браузер администратора
    https://checktheplants.ru                   https://admin.checktheplants.ru
   (React SPA, статика на хостинге,              (статические HTML/JS, выгрузка
    FTP-деплой Frontend/dist)                     Frontend/admin по FTP)
                │  fetch /api, cookie                │  fetch /api, cookie
                ▼                                    ▼
        ┌───────────────────────────────────────────────────────┐
        │ nginx :443 (compose, TLS Let's Encrypt, certbot)       │
        │ server.checktheplants.ru                               │
        │  /api,/uploads,/health → backend (режим compose)      │
        │                        или ctp_k8s_gateway:8090 (k8s) │
        └───────────────┬───────────────────────────────────────┘
                        │ HTTP (docker-сеть / gateway → NodePort 30080)
                        ▼
        ┌───────────────────────────────────────────────────────┐
        │ backend (Express 5, Node 22, процесс index.js)         │
        │  • REST /api/*  • cron-задачи  • раздача /uploads      │
        └───────┬───────────────┬──────────────┬────────────────┘
                │               │              │
                ▼               ▼              ▼
        PostgreSQL 16      Redis 7        внешние сервисы
        (данные)          (кэш ИИ, лок,   • Yandex Cloud AI (HTTPS,
                           rate-limit)      ai.api.cloud.yandex.net)
                                           • SMTP (письма)
                                           • push-сервисы браузеров
                                             (FCM/Mozilla/Apple, web-push)
```

Особенности:

* фронт и API живут на **разных origin** (`checktheplants.ru` и `server.checktheplants.ru`),
  поэтому cookie выдаются на домен `.checktheplants.ru` с `SameSite=None; Secure`;
* админка — **третий origin**, статический сайт без сборки; доступ только у `role = ADMIN`;
* TLS и Let's Encrypt остаются за compose-стеком (`ctp_nginx` + `ctp_certbot`), даже когда
  `/api` уже проксируется в Kubernetes (в кластере нет ingress-контроллера, порты 80/443
  заняты `ctp_nginx`);
* текущее содержимое `Backend/nginx/conf.d/default.conf` соответствует режиму `k8s`
  (весь трафик через `ctp_k8s_gateway:8090`); режим переключается
  `Backend/k8s/scripts/switch-traffic.ps1` (`compose` / `canary` / `k8s`), исходные
  конфиги лежат в `Backend/k8s/nginx/*.conf`.

## 2. Компоненты

| Компонент | Где | Ответственность |
| --- | --- | --- |
| SPA | `Frontend/src`, сборка `Frontend/dist` | вход/регистрация/passkey, растения, полив, фото, календарь, чат с ИИ, уведомления, профиль, публичные гайды, cookie-баннер, PWA |
| Админ-панель | `Frontend/admin` | обзор, посетители, пользователи, растения, поливы, фото, чат, push- и почтовые рассылки, `/health`, Docker-статистика |
| HTTP API | `Backend/index.js`, `Backend/routes/*.js` | REST, CORS/origin-политика, cookie-аутентификация, rate-limit, валидация, `/health`, `/livez`, статика `/uploads` |
| Бизнес-логика | `Backend/controllers/*.js`, `Backend/services/*.js` | полив и расписание, ИИ, push/mail, пароли, согласия, экспорт/удаление аккаунта |
| Планировщик | `Backend/jobs/*.js` | напоминания, утренняя сводка, советы по уходу, очистка, push/mail-рассылки |
| PostgreSQL 16 | compose `postgres`, k8s StatefulSet `postgres` | все данные приложения; миграции — SQL-файлы |
| Redis 7 | compose `redis`, k8s Deployment `redis` | кэш ИИ (`ctp:ai:*`), локи задач (`ctp:lock:*`), rate-limit (`ctp:rl:*`), идемпотентность рассылок (`ctp:idem:*`) |
| nginx | compose `ctp_nginx` (образ `Backend/nginx`) | TLS, редирект 80→443, прокси `/api`, `/uploads`, `/health`, HSTS |
| certbot | compose `ctp_certbot` | продление сертификатов Let's Encrypt каждые 12 часов |
| backup | compose `ctp_backup` | `pg_dump -Fc` + `tar.tar.gz` uploads раз в 24 часа, retention 14 дней |
| docker-socket-proxy | compose `ctp_docker_socket_proxy` | read-only доступ backend к Docker API для `/api/system/docker-stats` |
| Kubernetes-объекты | `Backend/k8s/*.yaml` | namespace `webplant`, ConfigMap `webplant-config`/`webplant-env`, Secret `webplant-secrets`, Deployment backend, StatefulSet postgres, Deployment redis, PVC (`backend-uploads` 5Gi, `redis-data` 1Gi, `backend-backups` 20Gi), PDB, NodePort 30080, ServiceAccount `webplant-backend` без RBAC и без монтирования токена |
| CronJob `db-backup` | `Backend/k8s/jobs/db-backup.cronjob.yaml` | ежедневно в 02:00 (`Europe/Moscow`): `pg_dump -Fc` в PVC `backend-backups`, проверка `pg_restore --list`, heartbeat `/backups/.last-success`, retention 14 дней (только БД, без `uploads`) |
| gateway | `Backend/k8s/gateway/nginx.conf.tpl` | контейнер `ctp_k8s_gateway:8090` — TCP-прокси на NodePort нод, публикует кластер в docker-сеть `kind` |

## 3. Потоки

### 3.1 Аутентификация: cookie + CSRF-политика

Используются **httpOnly-cookie с JWT** и запись в `auth_sessions` для отзыва; localStorage
не используется. Код: `Backend/utils/authTokens.js`, `Backend/middleware/auth.js`,
`Backend/controllers/userController.js`.

| Cookie | Содержимое | Время жизни | Когда выдаётся |
| --- | --- | --- | --- |
| `token` | JWT `tokenType=session` с `jti`, либо JWT `tokenType=access` с `sid` | 24 ч (session), 15 мин (access) | вход/регистрация, обновление access |
| `refresh_token` | JWT `tokenType=refresh` с `jti` | 30 дней | только при `rememberMe: true` |
| `guest_token` | гостевой идентификатор (не JWT) | до входа/очистки | гостевые согласия и чат |

* без «запомнить меня» выдаётся `token` (session, 24 ч) и строка `auth_sessions` с
  `token_type='session'`;
* с `rememberMe: true` выдаются `token` (access, 15 мин) и `refresh_token` (refresh, 30 дней),
  в `auth_sessions` хранится одна строка `token_type='refresh'`; `refreshRememberedSession`
  на каждом запросе продлевает access-токен;
* в БД пишется только `sha256(jti)` (`token_hash`), сам токен не хранится;
* отзыв: `revokeAuthToken(s)` при login/logout/регистрации/сбросе пароля/passkey-входе
  ставит `auth_sessions.revoked_at`; middleware проверяет `revoked_at IS NULL` и `expires_at`;
* cookie: `httpOnly`, `secure` в production, `sameSite: 'none'` в production (нужно из-за
  разных origin), `domain` = `AUTH_COOKIE_DOMAIN` или `.checktheplants.ru`;
* **CSRF**: отдельного CSRF-токена нет. Для `POST/PUT/PATCH/DELETE` сервер проверяет
  `Origin` и `Sec-Fetch-Site`: запрос с недопустимого origin, кросс-сайтовый запрос без
  origin и любой запрос с auth-cookie **без** заголовка `Origin` получает `403`
  («Запрос с этого источника запрещён»);
* **CORS**: allowlist `FRONTEND_URL` + `ADMIN_PANEL_ORIGIN` (+ `LOCAL_DEV_ORIGINS` только
  вне production), `credentials: true`, разрешённые заголовки включают `Idempotency-Key`;
* **Content-Type**: для запросов с телом разрешены только `application/json`,
  `application/x-www-form-urlencoded`, `multipart/form-data` и `*+json`, иначе `415`;
* **лимиты тела**: `express.json({ limit: '100kb' })`, `urlencoded` — 100 kb,
  `parameterLimit: 1000`; файлы — до 5 МБ на файл (`Backend/middleware/upload.js`);
* **X-Robots-Tag: noindex, nofollow** ставится на все ответы API, `robots.txt` на API
  запрещает обход.

Роли: `users.role` = `USER` | `ADMIN` (`Backend/middleware/admin.js` → `403` для не-админа).
Уровень подписки — `users.privilege_level` (`free` / `premium` / `pro`).

### 3.2 Passkeys (WebAuthn)

Код: `Backend/controllers/passkeyController.js`, `Backend/utils/passkeyConfig.js`,
`Frontend/src/utils/passkey.js`, SDK `@simplewebauthn/server` и `@simplewebauthn/browser`.

* RP ID — `RP_ID`, ожидаемые origin'ы — `FRONTEND_ORIGIN`/`FRONTEND_URL`; в production
  конфигурация проверяется при старте (`validateProductionPasskeyConfig`);
* регистрация ключа: `POST /api/users/passkey/register/start` (нужна авторизация) →
  браузер создаёт credential → `POST /api/users/passkey/register/finish`; челлендж хранится
  в `passkey_challenges` (`key`, `type`, `expires_at`) и удаляется при использовании;
* вход: `POST /api/users/passkey/login/start` (email опционален) → `POST …/login/finish`;
  после проверки подписи обновляются `passkeys.counter`/`last_used_at`, выдаются те же
  cookie, что и при парольном входе, гостевые данные привязываются к аккаунту;
* управление: `GET /api/users/passkey` (список устройств), `PATCH /api/users/passkey/:id`
  (имя), `DELETE /api/users/passkey/:id`, `GET /api/users/passkey/exists?email=…`
  (`{ hasPasskey }`, используется на форме входа).

### 3.3 ИИ-помощник «Лейка»

Код: `Backend/services/aiService.js` (≈1,8 тыс. строк), `Backend/utils/chatIntent.js`,
`Backend/utils/aiCache.js`, `Backend/utils/aiMetrics.js`, `Backend/controllers/chatController.js`.

Вызовы модели:

* SDK `openai`, `baseURL: https://ai.api.cloud.yandex.net/v1`;
* текстовые запросы — `model: gpt://<YANDEX_CLOUD_FOLDER>/<YANDEX_CLOUD_MODEL>`,
  изображения — `YANDEX_CLOUD_VISION_MODEL`;
* на каждый вызов действуют таймаут (`AI_*_TIMEOUT_MS`) и сквозной дедлайн (`AI_*_DEADLINE_MS`),
  при их истечении — повтор (для советов) либо фолбэк;
* суточный бюджет обращений `AI_DAILY_REQUEST_BUDGET` (при исчерпании — фолбэк, гости
  получают `503`);
* ответы кэшируются в Redis: советы — `AI_CACHE_TTL_SECONDS` (7 суток по умолчанию),
  ответы чата — `AI_CHAT_CACHE_TTL_SECONDS` (10 минут); одновременные одинаковые запросы
  считаются один раз через лок `ctp:lock:ai-cache:*`;
* телеметрия — счётчики и стоимость (`AI_PRICE_*`) в `/api/admin/ai/metrics`, журнал
  подсказок в `ai_advice_logs` (виды: `species`, `watering`, `time`, `care`) и
  `/api/admin/ai/logs`.

Эндпоинты:

| Эндпоинт | Что делает |
| --- | --- |
| `POST /api/chat/chat` | чат (гость или пользователь), локальные интенты по данным приложения без модели, история 40 сообщений |
| `POST /api/chat/photo` | анализ фото растения (multipart, до 5 файлов по 5 МБ), диагностика |
| `GET /api/chat/history`, `/sessions`, `DELETE /api/chat/history` | история переписки по сессиям |
| `POST /api/plants/suggest-species` | подсказка вида по названию |
| `POST /api/plants/watering-advice` | совет по интервалу полива (уточняющие вопросы + рекомендация) |
| `POST /api/plants/watering-time-advice` | совет по времени суток для полива |

Деградация: при ошибке модели (или отсутствии ключей) пользователю возвращается ответ,
собранный из данных приложения (`chatIntent.js`), с флагом `degraded: true`; в чат-лог
пишется причина. Гость при исчерпанном бюджете получает `503`.

Ограничения частоты ИИ: чат — 15 сообщений/мин с IP, гость — 40/сутки, пользователь —
300/сутки; фото в чате — 12/час; подсказки вида — 20/час на пользователя; советы по поливу
— 30/час.

### 3.4 Уведомления и push

Код: `Backend/jobs/reminderService.js`, `Backend/services/pushService.js`,
`Backend/utils/pushValidation.js`, `Frontend/src/utils/pushNotifications.js`.

* in-app уведомления хранятся в `notifications` с `dedupe_key` (уникальный индекс
  `user_id + dedupe_key`), типы: `watering_due`, `watering_day_before`, `morning_summary`,
  `care_reminder`, `care_tip`;
* push-подписки — `push_subscriptions` (`endpoint` уникален, `p256dh`, `auth`, `user_id`
  может быть `NULL` для гостя); при ошибках доставки ведутся `failed_attempts`,
  `last_error`, `invalidated_at`, `invalid_reason`; гостевая подписка привязывается к
  аккаунту при входе;
* ключи VAPID отдаются публично через `GET /api/push/vapid-public-key`;
* напоминания о поливе шлёт `reminderService` (интервал 10 минут, см. §6): «за день» —
  в окне 09–21 по поясу пользователя, «в день полива» — около назначенного часа
  (−5/+15 минут), авто-пропуск просроченного полива — через 24 часа (не более 100 за тик);
* утренняя сводка — только пользователям с `notification_preferences.morning_summary_enabled`,
  в 09:00 по их часовому поясу, один раз в день (`last_morning_summary_date`);
* советы по уходу — окно 10–12 по поясу пользователя, флаг
  `notification_preferences.care_advice_enabled`, `last_care_advice_date`.

### 3.5 Рассылки из админки

**Push-рассылки** (`push_broadcasts`, `push_broadcast_recipients`, `adminPushRoutes.js`):

* создание — `POST /api/admin/push/broadcasts`; поддерживается заголовок `Idempotency-Key`
  (8–200 символов `[A-Za-z0-9._:-]`): повтор с тем же ключом возвращает существующую
  рассылку, ключ живёт 24 часа (Redis `ctp:idem:push:<key>` + уникальный индекс в БД);
* защита от дублей: одинаковая рассылка (title+body+url+target_mode+include_guests+автор)
  отклоняется с `409`;
* аудитория: `target_mode='all'` (все подписки, включая гостей при `include_guests`) или
  `target_mode='users'` (конкретные `userIds`, для них создаются строки
  `push_broadcast_recipients`);
* отправка — `pushBroadcastJob` раз в минуту, чанками (`chunk_size`, 100–500, по умолчанию
  200), прогресс в `last_processed_id`/`sent_count`/`failed_count`; зависшие в `sending`
  дольше 10 минут восстанавливаются; отмена — `POST …/broadcasts/:id/cancel`.

**Почтовые рассылки** (`mail_broadcasts`, `mail_broadcast_recipients`, `adminMailRoutes.js`):

* черновик/preview — `POST /api/admin/mail/preview`, тестовое письмо —
  `POST /api/admin/mail/test` (5 запросов / 10 минут);
* создание — `POST /api/admin/mail/broadcasts`, отправка батчами
  (`MAIL_BROADCAST_BATCH_SIZE`, по умолчанию 100, максимум 1000) с задержкой
  `MAIL_BROADCAST_DELAY_MS`; зависшие в `sending` дольше 6 часов помечаются как ошибка;
* статусы рассылки: `pending` → `sending` → `sent` / `failed` / `canceled`.

### 3.6 Публичные страницы и аналитика посещений
* публичные справочники (`Frontend/src/data/plants.js`, `careArticles.js`) собираются
  в статические HTML скриптом `Frontend/scripts/prerender.mjs`, `sitemap.xml` и
  `build-info.json` создаются на этапе сборки;
* визиты: `POST /api/system/visit` (`visitorId`, `path`), пишутся в `site_visit_days`
  (одна строка на посетителя в сутки, `views` инкрементируется, IP не сохраняется);
  фронт вызывает эндпоинт только при согласии на аналитику (`Frontend/src/utils/visits.js`);
  лимит — 180 запросов/час на IP; агрегаты доступны в админке (`/api/admin/analytics/*`,
  `/api/admin/visits`);
* cookie-согласия: `user_cookie_consents` (типы `technical`, `analytics`, `marketing`,
  `personalization`) и юридические согласия `user_legal_consents`
  (`privacy_policy`, `terms_of_service`, версия документа, IP, user-agent); гостевые
  согласия и сообщения чата привязываются к аккаунту при регистрации/входе
  (`Backend/utils/linkGuestData.js`).

### 3.7 Фотографии растений

1. `POST /api/upload` (multipart `photos`, до 2 файлов по 5 МБ) — `multer` пишет файл с
   расширением `.upload`, проверка сигнатуры (JPEG/PNG/WebP/HEIC) и переименование в
   `<32 hex>.<ext>` в `Backend/uploads/plants`;
2. ответ `201 { urls, thumbs }`; миниатюра создаётся `sharp` и отдаётся через
   `/uploads/thumbs` (`Backend/utils/plantPhotoThumb.js`);
3. привязка к растению — `POST /api/plants` или `POST /api/plants/:id/photos`; принимаются
   только пути вида `/uploads/plants/<32hex>.<ext>`, для которых файл существует;
4. раздача — `express.static('uploads', { maxAge: '365d', immutable: true })`;
5. осиротевшие файлы (нет строки в `plant_photos`) удаляются ежедневной очисткой
   (`Backend/utils/plantPhotoCleanup.js`).

### 3.8 Маркетинговые рассылки, согласие и отписка

* отдельное согласие — `users.marketing_email_opt_in` (+ `_at`, `_source`,
  `marketing_email_opt_out_at`), по умолчанию `false`; при регистрации передаётся
  `marketingConsent` (чекбокс в форме);
* аудитория почтовой рассылки — только `marketing_email_opt_in = true`
  (`mailBroadcastService`), в ответе создания рассылки есть отчёт
  `consent: {optedIn, unsubscribed, withoutConsent, warning}`; получатели без согласия
  пропускаются (`skipped_no_consent`);
* отписка в один клик (RFC 8058): `GET/POST /api/users/unsubscribe?uid=<id>&token=<token>`
  отдаёт HTML-страницу (`utils/unsubscribePage.js`), письма содержат заголовки
  `List-Unsubscribe` и `List-Unsubscribe-Post: List-Unsubscribe=One-Click`;
* токен отписки — HMAC-SHA256 от `unsubscribe:<user_id>` на `SECRET_KEY`
  (`utils/marketingConsent.js`), в БД не хранится; после ротации `SECRET_KEY` старые ссылки
  перестают работать;
* лимит обращений к отписке — 30 запросов за 15 минут с IP.

### 3.9 Аудит действий администратора и метрики

* каждое изменяющее действие админ-API (`deletePlant`, `deleteUser`, `deleteWatering`,
  `deletePhoto`, удаление чата, обновление пользователя, рассылки) пишется в
  `admin_audit_logs` (`utils/adminAudit.js`): `admin_id`, `action`, `target_type`,
  `target_id`, `payload` (ключи `password|token|cookie|secret` вырезаются), `ip`,
  `user_agent`. Таблица append-only (триггер запрещает `UPDATE`/`DELETE`), очистка —
  только `purge_admin_audit_logs()` (365 дней);
* просмотр журнала — `GET /api/admin/audit` (фильтры `action`, `adminId`, `limit`,
  `offset`; лимит чтения админ-API — 120 запросов в минуту);
* HTTP-метрики процесса доступны администратору: `GET /api/system/metrics`
  (`middleware/accessLog.js`: счётчики по статусам, методам, латентности и маршрутам);
* CSV-выгрузка растений для пользователя — `GET /api/plants/export` (BOM UTF-8, `;`,
  до 5000 активных растений).

## 4. Схема базы данных

СУБД — PostgreSQL 16. Модели: `Backend/models/*.js`, связи — `Backend/models/associations.js`,
DDL — `Backend/migrations/*.sql`. `timestamps: false` в `Backend/db.js`: колонки
`created_at`/`updated_at` описаны в моделях явно. Миграции идемпотентны
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

```text
users (id, email уникальный, password, name, username уникальный, phone, bio,
       role USER|ADMIN, privilege_level, timezone, welcome_email_sent_at, created_at,
       marketing_email_opt_in, marketing_email_opt_in_at, marketing_email_opt_in_source,
       marketing_email_opt_out_at)
 │
 ├─1:N─ plants (id, user_id→users, name, species, location, description,
 │        watering_interval_days, watering_time_of_day morning|day|evening,
 │        last_watered_at, next_watering_at, is_active, notify_morning,
 │        notify_day_before, reminder_weekdays JSONB, metadata JSONB, created_at, updated_at)
 │        │
 │        ├─1:N─ plant_photos (id, plant_id→plants, url, sort_order, is_main,
 │        │        metadata JSONB, created_at, updated_at)
 │        ├─1:N─ watering_logs (id, plant_id→plants, user_id→users,
 │        │        action watered|skipped, action_at, scheduled_for, hours_late,
 │        │        note, metadata JSONB, created_at)
 │        └─1:1─ plant_care_plans (plant_id PK→plants, plan JSONB, source, season,
 │                 model, generated_at, created_at, updated_at)
 │
 ├─1:N─ chat_logs (id, user_id→users NULL для гостя, session_id UUID, role user|assistant|system,
 │        text, input_tokens, output_tokens, error, metadata JSONB, created_at)
 ├─1:N─ ai_advice_logs (id, user_id→users ON DELETE SET NULL, kind species|watering|time|care,
 │        plant_name, species, season, result_type, interval_days, time_of_day,
 │        confidence, questions_asked, source, latency_ms, created_at)
 ├─1:N─ notifications (id, user_id→users, plant_id, type, title, body, url,
 │        dedupe_key, payload JSONB, scheduled_for, read_at, created_at)
 │        UNIQUE (user_id, dedupe_key)
 ├─1:1─ notification_preferences (user_id PK→users, morning_summary_enabled,
 │        care_advice_enabled, last_care_advice_date, dark_theme_enabled, theme_mode,
 │        last_morning_summary_date, created_at, updated_at)
 ├─1:N─ push_subscriptions (id, user_id→users NULL, endpoint UNIQUE, p256dh, auth,
 │        user_agent, last_success_at, last_error, failed_attempts,
 │        invalidated_at, invalid_reason, created_at, updated_at)
 ├─1:N─ auth_sessions (id, user_id→users, token_hash UNIQUE = sha256(jti),
 │        token_type session|refresh, expires_at, revoked_at, created_at)
 ├─1:N─ passkeys (id, user_id→users, credential_id UNIQUE, public_key, counter,
 │        transports JSONB, device_name, user_agent, created_at, last_used_at)
 ├─1:N─ passkey_challenges (id, user_id→users NULL, challenge UNIQUE, type
 │        registration|authentication, key, expires_at, created_at)
 ├─1:N─ password_reset_tokens (id, user_id→users, token_hash UNIQUE, expires_at,
 │        used_at, requested_ip, user_agent, created_at)
 ├─1:N─ user_cookie_consents (id, user_id→users NULL, guest_token, consent_type,
 │        is_accepted, version, accepted_at, expires_at, is_revoked, revoked_at,
 │        revoked_reason, ip_address, user_agent, source, metadata JSONB,
 │        created_at, updated_at)
 ├─1:N─ user_legal_consents (id, user_id→users NULL, consent_type privacy_policy|
 │        terms_of_service, is_accepted, document_version, accepted_at, revoked_at,
 │        expires_at, guest_token, ip_address, user_agent, source, metadata JSONB,
 │        created_at, updated_at)
 ├─1:N─ site_visit_days (id, visitor_id, day DATE, user_id→users ON DELETE SET NULL,
 │        views, first_path, referrer_host, device, created_at, updated_at)
 │        UNIQUE (visitor_id, day)
 ├─1:N─ push_broadcast_recipients (id, broadcast_id→push_broadcasts, user_id→users,
 │        status pending|sent|failed, attempts, sent_at, last_error, created_at)
 │        UNIQUE (broadcast_id, user_id)
 └─1:N─ mail_broadcast_recipients (id, broadcast_id→mail_broadcasts, user_id→users,
          email, status pending|sent|failed|skipped, attempts, error, sent_at, created_at)
          UNIQUE (broadcast_id, user_id)

push_broadcasts (id, title, body, icon, url, target_mode all|users, include_guests,
       status pending|sending|sent|failed|canceled, scheduled_for, sent_at,
       total_subscriptions, sent_count, failed_count, removed_count,
       idempotency_key UNIQUE (partial), started_at, updated_at, last_processed_id,
       chunk_size, created_by→users ON DELETE SET NULL, created_at)

mail_broadcasts (id, subject, body, cta_label, cta_url, target_mode all|users,
       status pending|sending|sent|failed|canceled, scheduled_for, sent_at,
       total_recipients, sent_count, failed_count, skipped_count,
       created_by→users ON DELETE SET NULL, created_at)

admin_audit_logs (id BIGSERIAL, admin_id→users ON DELETE SET NULL, action, target_type,
       target_id, payload JSONB, ip INET, user_agent, created_at)
       append-only: триггер trg_admin_audit_logs_append_only запрещает UPDATE/DELETE,
       кроме ON DELETE SET NULL для admin_id и purge_admin_audit_logs();
       retention 365 дней; индексы по created_at, (admin_id, created_at), (target_type, target_id)
```

Ключевые индексы: `users.username` (unique), `users.created_at`, `plants (user_id)`,
`plants (user_id, is_active)`, `plants (next_watering_at)`, `plant_photos (plant_id, sort_order)`,
`watering_logs (plant_id, action_at)`, `watering_logs (user_id, action_at)`,
`chat_logs (user_id, created_at)`, `chat_logs (session_id, created_at)`,
`chat_logs ((metadata->>'guestToken'), created_at)`, `notifications (user_id, dedupe_key)`
(unique), `notifications (user_id, created_at, id)`, `notification_preferences` частичные
индексы по `morning_summary_enabled`/`care_advice_enabled`, `push_subscriptions.endpoint`
(unique), `push_subscriptions.invalidated_at` (partial), `push_broadcasts
(status, scheduled_for)`, `push_broadcasts (status, updated_at)`, `push_broadcasts
(idempotency_key)` (unique partial), `mail_broadcasts (status, scheduled_for)`,
`auth_sessions (user_id)`, `auth_sessions (expires_at)`, `passkeys.credential_id` (unique),
`passkey_challenges.key`, `password_reset_tokens.expires_at`, `site_visit_days
(visitor_id, day)` (unique), `site_visit_days (day)`, `site_visit_days (user_id, day)`.

Миграции: `Backend/migrations/*.sql` применяются по возрастанию имени. Отдельного
фреймворка миграций нет — это осознанное решение (см. `docs/ADR/0001-architecture.md`).
В production backend при старте сверяет модели с фактической схемой
(`queryInterface.showAllTables()` + `describeTable()`); при расхождении процесс завершается
с `Database schema is missing required tables or columns: … Apply migration(s): …`.
В непроизводственной среде вместо этого выполняется `sequelize.sync()`.

## 5. Границы доверия и защита

* все данные растений/поливов/фото изолированы по `user_id` (каждый запрос фильтрует по
  `req.user.id`); админ-API не фильтрует по владельцу, но требует `role = ADMIN`;
* гость идентифицируется cookie `guest_token`; гостевые чаты и согласия хранятся с
  `user_id IS NULL` и `metadata.guestToken`, при входе привязываются к аккаунту;
* фото принимаются только с проверкой сигнатуры файла, имена генерируются случайно,
  путь allowlist'ом ограничен `/uploads/plants/<32hex>.<ext>`;
* админка не имеет собственного бэкенда и собственных прав: любые действия проверяются
  на сервере (`requireAdmin`);
* сервер не отдаёт стек ошибок клиенту: обработчик возвращает обобщённые сообщения
  (`Некорректный запрос`, `Internal server error`), детали — в логах
  (`middleware/accessLog.js`, `logError`);
* секреты в коде отсутствуют, читаются из окружения (`SECRETS.md`).

## 6. Фоновые задачи и распределённые локи

Планировщик работает **внутри процесса backend** (`startServer()` в `Backend/index.js`);
при `BACKGROUND_JOBS_ENABLED=false` задачи не запускаются. Уникальность выполнения в
нескольких репликах обеспечивает Redis-лок
(`Backend/utils/distributedLock.js`): `SET key token NX PX ttl`, продление TTL, снятие
через Lua-скрипт только своим токеном; ключи с префиксом `REDIS_KEY_PREFIX` (`ctp`).

| Задача | Расписание | Ключ лока | TTL лока | Что делает |
| --- | --- | --- | --- | --- |
| `reminderService.reminderTick` | каждые 10 минут (`*/10 * * * *`) | `job:reminder-tick` | 10 мин | авто-пропуск просроченных поливов (>24 ч, ≤100 за тик), напоминание «за день» (09–21 локально), напоминание «в день полива» (±5/15 мин) |
| `reminderService.morningSummaryTick` | каждые 10 минут | `job:morning-summary-tick` | 30 мин | утренняя сводка в 09:00 локально, один раз в день на пользователя |
| `reminderService.careAdviceTick` | каждые 10 минут | `job:care-advice-tick` | 30 мин | совет по уходу в окне 10–12 локально, не чаще раза в день |
| `startCleanupJob` | при старте и раз в 24 часа | `job:cleanup-expired` | 30 мин | гостевые согласия, чаты/журналы ИИ старше retention, истёкшие `auth_sessions`/челленджи/токены сброса, осиротевшие файлы фото, `site_visit_days` > 400 дней, старые уведомления и push-подписки, `admin_audit_logs` > 365 дней (через `purge_admin_audit_logs()`) |
| `startPushBroadcastJob` | каждую минуту (`* * * * *`) | `job:push-broadcast` | 2 мин | отправка запланированных/отложенных push-рассылок чанками, восстановление зависших |
| `startMailBroadcastJob` | каждую минуту | `job:mail-broadcast` | 3 мин | отправка почтовых рассылок батчами |
| CronJob `db-backup` (Kubernetes) | ежедневно 02:00 `Europe/Moscow` | — | — | `pg_dump -Fc` в PVC `backend-backups`, проверка дампа, heartbeat `.last-success`, retention 14 дней. Не часть backend-процесса: отдельный Job в кластере, `concurrencyPolicy: Forbid` |

Особенности и ограничения:

* если Redis недоступен, `acquireLock` возвращает «взят» с `degraded: true` — каждая
  реплика выполнит задачу; при двух репликах это означает дубли уведомлений
  (в БД дедупликация по `dedupe_key` спасает in-app уведомления, но не push-отправку);
* локи работают только внутри одного кластера с общим Redis: два независимых стека
  (compose и k8s) со своими Redis не координируются — при одновременной работе обоих
  возможны двойные напоминания (описано в `Backend/k8s/README.md`);
* счётчик суточного бюджета ИИ при недоступном Redis считается локально в памяти пода;
* `PUSH_BROADCAST_CHUNK_SIZE` (100–500) задаёт размер чанка push-рассылки;
* один процесс backend обслуживает и HTTP, и cron — при горизонтальном масштабировании
  нужно оставить `BACKGROUND_JOBS_ENABLED=true` только там, где разрешены локи.

## 7. Ограничения частоты (rate-limit)

Общий store — Redis (`Backend/utils/rateLimitStore.js`, ключи `ctp:rl:*`), у большинства
лимитеров `passOnStoreError: true` (сбой Redis не блокирует пользователей), у подписки на
push — `false` (лучше отказать, чем создать дубль).

| Что | Лимит |
| --- | --- |
| Регистрация | 5 / час (IP) |
| Вход | 10 / 15 мин (IP) |
| Вход и регистрация passkey | 10 / 15 мин и 10 / час |
| Проверка username | 30 / мин |
| Вход passkey: старт / завершение | 30 / 15 мин (старт) и 10 / 15 мин (завершение) |
| Отписка от рассылки (`/api/users/unsubscribe`) | 30 / 15 мин (IP) |
| Сброс пароля: запрос / проверка / смена | 5 / час, 30 / 15 мин, 10 / 15 мин |
| Чат | 15 / мин (IP), гость 40/сутки, пользователь 300/сутки (IP/пользователь) |
| Фото в чате | 12 / час |
| История чата | 120 / мин |
| Подсказка вида | 20 / час (пользователь) |
| Советы по поливу | 30 / час (пользователь) |
| Запись полива/растения/фото | 120 / 15 мин (пользователь) |
| Загрузка фото растения | 10 / час (пользователь) |
| Уведомления: чтение / изменения | 300 / мин и 120 / мин |
| Экспорт / удаление аккаунта | 10 / час и 5 / час |
| Настройки уведомлений | 60 / мин |
| Push-подписка | 10 / 15 мин, 50 / сутки; отписка 30 / 15 мин |
| Админ-API: чтение / изменения | 120 / мин и 60 / мин |
| Push-рассылки | 20 / час и 60 / сутки; операции 30 / 10 мин |
| Почтовые рассылки / тест письма | 30 / 10 мин и 5 / 10 мин |
| Визит (`/api/system/visit`) | 180 / час |

## 8. Точки отказа

| Точка | Признак | Влияние | Что делать |
| --- | --- | --- | --- |
| PostgreSQL | `/health` → `503 {"status":"unavailable"}`, логи `health_check_failed` | сервис неработоспособен: нет входа, растений, чата | `RUNBOOK.md` §2 |
| Redis | `/health` → `"redis": "unavailable"` | нет кэша ИИ (рост расходов), нет общих rate-limit, локи задач деградируют, возможны дубли напоминаний при >1 реплике | `RUNBOOK.md` §3 |
| Yandex Cloud AI (ключ/квота/сеть) | ответы чата с `degraded: true`, советы с `source: "fallback"`, `503` для гостей при бюджете | ухудшение качества ответов, но сервис жив | `RUNBOOK.md` §6 |
| SMTP | сброс пароля `503`, `/health` → `"mail": "not-configured"` / ошибки отправки | нет писем сброса пароля, приветственных и рассылок | `RUNBOOK.md` §6 |
| Push-сервисы браузеров | рост `failed_attempts`, `invalidated_at` в `push_subscriptions` | push не доходит, in-app уведомления работают | `RUNBOOK.md` §6 |
| Диск (uploads, дампы, логи) | `ENOSPC`, ошибки загрузки фото, падение `pg_dump` | нельзя загрузить фото, бэкапы не создаются | `RUNBOOK.md` §4 |
| TLS-сертификат | браузер ругается, `certbot` не продлил | полная недоступность сайта и API | `RUNBOOK.md` §5 |
| nginx / gateway | `502`/`504` от nginx, `/health` не отвечает | недоступность API при живом backend | `RUNBOOK.md` §1 |
| Одна реплика backend (k8s `replicas: 1`) | rolling update без запаса, PDB `minAvailable: 1` | короткая недоступность при перезапуске | `DEPLOY.md` |
| Тома `standard` (RWO, local-path) в k8s | поды backend и Job'ы на одной ноде | нет отказоустойчивости ноды | `Backend/k8s/README.md` |
| Резервное копирование | нет свежего дампа / нет `.last-success` | RPO 24 ч, потеря данных за сутки | `RUNBOOK.md` §7, §9 |
| FTP-деплой фронта | рассинхрон версий фронта и API | старый клиент может не знать новых полей | `DEPLOY.md`, `docs/api/openapi.yaml` |
| CI | красный workflow | релиз блокируется | `.github/workflows/ci.yml` |

RPO/RTO и процедуры восстановления — в `RUNBOOK.md`. Порядок выкладки и откатов — в
`DEPLOY.md`. Реестр секретов — в `SECRETS.md`.
