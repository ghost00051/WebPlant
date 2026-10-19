# Fixes: push delivery / broadcast / idempotency (task-6)

Реализация фиксов по аудиту `state/notif-audit/02-push-delivery.md` (task-2).
Владелец: push-auditor. Правки только в файлах своего write-scope; `Backend/index.js`, `routes`, `middleware`, `package.json`, `Frontend` не менялись.

**Статус: все пункты D-01…D-15 реализованы.** `cd Backend && node --test` — **195/195 pass** (включая 19 новых тестов в `Backend/services/pushService.test.js` и `Backend/utils/pushBroadcastValidation.test.js`). Product-код запускался только через импорты/тесты; живая БД/Redis/сеть в проверках не использовались.

---

## 1. Миграция

**Файл:** `Backend/migrations/20261022_push_delivery_hardening.sql` (идемпотентная: `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DO $$ … pg_constraint`; новых таблиц нет).

Новые колонки (ровно те, что добавлены Lead'ом в `MIGRATION_FILES_BY_TABLE`):

* `push_subscriptions`: `last_success_at TIMESTAMPTZ`, `last_error TEXT`, `failed_attempts INTEGER NOT NULL DEFAULT 0`, `invalidated_at TIMESTAMPTZ`, `invalid_reason VARCHAR(120)`;
* `push_broadcasts`: `idempotency_key VARCHAR(200)`, `started_at TIMESTAMPTZ`, `updated_at TIMESTAMPTZ`, `last_processed_id INTEGER NOT NULL DEFAULT 0`, `chunk_size INTEGER NOT NULL DEFAULT 200`;
* `push_broadcast_recipients`: `status VARCHAR(16) NOT NULL DEFAULT 'pending'`, `attempts INTEGER NOT NULL DEFAULT 0`, `sent_at TIMESTAMPTZ`, `last_error TEXT`.

Индексы: `idx_push_subscriptions_invalidated_at` (partial), `idx_push_broadcasts_idempotency` (**partial UNIQUE** on `idempotency_key WHERE NOT NULL`), `idx_push_broadcasts_status_updated`, `idx_push_broadcast_recipients_status`; CHECK `status IN ('pending','sent','failed')`.

Модели обновлены под эти колонки:
`Backend/models/PushSubscription.js`, `Backend/models/PushBroadcast.js`, `Backend/models/PushBroadcastRecipient.js`.

> В non-production `sequelize.sync()` не добавляет колонки в уже существующие таблицы — на dev/staging-БД с прежней схемой нужно применить SQL вручную (production идёт через `migrate`).

---

## 2. Что изменено по пунктам ТЗ

### D-01 — broadcast resume/checkpoint (главный фикс)

`Backend/services/pushBroadcastService.js`:

* `createBroadcast` (`:70-150`) всегда создаёт рассылку в `pending` (никакой синхронной отправки в HTTP-запросе), сохраняет `chunk_size` (env `PUSH_BROADCAST_CHUNK_SIZE`, clamp 100–500, default 200), `last_processed_id=0`, `started_at=null`, `updated_at`, `idempotency_key`; для `target_mode='users'` создаёт `push_broadcast_recipients` со `status='pending'`.
* `sendBroadcast` (`:264-435`) теперь чанкованный и возобновляемый: страницы `PushSubscription` по `id > last_processed_id` (`LIMIT chunk_size`), после каждого чанка `persistProgress` (до 3 попыток) атомарно сохраняет `sent_count/failed_count/removed_count/last_processed_id/chunk_size/updated_at`; для `users`-рассылки параллельно обновляет per-recipient статусы (`applyRecipientProgress`, `:189-245`).
* `sent_at` ставится **только при завершении**; по завершении `status='sent'` (даже при `failed_count>0` — partial), `total_subscriptions = sent+failed` (число реально обработанных). `status='failed'` — только fatal (VAPID не настроен) (`:268-299`); прочие ошибки не превращают рассылку в `failed`.
* `recoverStaleSending` (`:437-475`): `sending` без прогресса >10 мин (`updated_at`, fallback `started_at`/`created_at`) возвращается в `pending` с сохранённым курсором — вместо прежнего «warn и пропускаем».
* `retryBroadcast` (`:477-525`): только `failed` → `pending`, сброс `last_processed_id`/счётчиков/`started_at`/`sent_at` и статусов получателей (в транзакции).

`Backend/jobs/pushBroadcastJob.js`:

* на каждом тике сначала `recoverStaleSending`, затем `listPendingDue`; захват `pending→sending` с `started_at` (если ещё не было) и `updated_at`;
* при исключении: `fatal` → `failed`, иначе — **возврат в pending** (следующий тик продолжит с курсора; если и это не удалось, сработает stale-recovery).

`Backend/controllers/adminPushController.js`: `retryBroadcast(req,res)` (`:302-337`) — `400` некорректный id, `404` нет рассылки, `409` статус не `failed`, `503` push не настроен, `200 {retried, broadcast, queued}`. Роут уже добавлен security-auditor'ом (`POST /api/admin/push/broadcasts/:id/retry`).

### D-02 — политика ошибок и карантин

`Backend/services/pushService.js`:

* `classifyPushError` (`:76-94`): 404/410 → `expired`; 400/401/403/413 (и прочие 4xx) → `invalid`; 429/5xx/timeout/network → `retryable`.
* `deliverOne` (`:250-355`): expired → `destroy()` (ошибка destroy теперь ловится отдельно и не рвёт батч); invalid → `invalidated_at + invalid_reason`, подписка больше не выбирается (`invalidated_at: null` во всех выборках); retryable → `failed_attempts++`, `last_error`; после **5** попыток (`QUARANTINE_AFTER_FAILURES`) — карантин; успех → `failed_attempts=0`, `last_error=null`, `last_success_at` (с разумным троттлингом записи: не чаще ~раза в сутки на подписку, а также при выходе из ошибки).
* результат `sendToSubscriptions` дополнен `quarantined`; `total` = число активных подписок; `success` прежний (`sent>0`), ключи `total/sent/failed/removed` сохранены для обратной совместимости.

### D-03/D-04 — идемпотентность через БД, атомарно

* `Backend/controllers/adminPushController.js`: Redis GET/SET в критическом пути больше не используются. Порядок: `findByIdempotencyKey` (230) → content-dedupe 10 мин → `createBroadcast`; на `SequelizeUniqueConstraintError`/`23505` — повторный поиск и `200 {deduplicated:true, broadcast, existingStatus, queued}` (`:200-256`). `idempotency_key` пишется в той же транзакции, что и рассылка (`pushBroadcastService.js:118`).
* TTL сохранён семантически: ключ в БД живёт бессрочно (unique index), но для `sent/failed/canceled` старше 24 ч (`IDEMPOTENCY_TTL_MS`) освобождается (`isIdempotencyKeyExpired`/`releaseExpiredIdempotencyKey` в `adminPushController.js:62-98`), чтобы старые клиенты с контентным ключом не блокировались навсегда. Для `pending/sending` ключ не освобождается (нельзя плодить дубль запланированной рассылки).
* `Backend/utils/broadcastIdempotency.js`: `find/remember` оставлены только для mail-рассылок (комментарий в шапке), `remember` переведён на `SET … NX`; push их не импортирует.

### D-05 — чанки/конкурентность/память, маскирование логов

* `pushService`: собственный worker-pool `mapWithConcurrency` (`:184-212`), env `PUSH_CONCURRENCY` (default 10, clamp 1–50); никаких новых зависимостей. `sendToSubscriptions` больше не держит `findAll` всех подписок — broadcast сам читает страницы.
* Логи ошибок: только `sub=#id`, `fp=sha256(endpoint).slice(0,12)` (`endpointFingerprint`, `:59-63`), `statusCode/reason`; полный endpoint не печатается. Ошибки/endpoint'ы не возвращаются в API (наружу только счётчики и статусы).

### D-06 — наблюдаемость

* `push_subscriptions`: `last_success_at/last_error/failed_attempts/invalidated_at/invalid_reason`.
* `push_broadcasts`: счётчики, `status`, `started_at/sent_at/updated_at`, `last_processed_id/chunk_size` отдаются в `GET /api/admin/push/overview` (`OVERVIEW_ATTRIBUTES` в `adminPushController.js:22-38`; добавлены `invalidated` и `pushStatus`).
* `pushService` экспортирует **named** `getPushStatus()` (`:55-57`) и метод на default-инстансе; Lead подключил его в `/health` (namespace-import, fallback-safe).
* `push_broadcast_recipients` даёт per-user статус для `target_mode='users'`; по завершении оставшиеся `pending` финализируются в `failed`.

### D-07 — VAPID

`pushService.js:34-57`: `setVapidDetails` в `try/catch` на импорте; при отсутствии/невалидных ключах процесс **не падает**, push выключается, причина в `getPushStatus().error`. `ensureConfigured()` вызывается в `sendToUser` и `sendToSubscriptions` (`:367-377`, `:380-398`); ошибка помечена `fatal=true` для джобы. Создание любой рассылки без VAPID (включая scheduled) → `503` (`adminPushController.js:184-191`); `GET /api/push/vapid-public-key` → `503` (`pushController.js:16-24`).

### D-08 — размер payload

* `Backend/utils/pushBroadcastValidation.js`: `MAX_PUSH_PAYLOAD_BYTES=3800`, `measurePushPayloadBytes()` считает UTF-8 байты реального JSON (`title/body/icon/badge/data.url`); `validateBroadcastInput` отклоняет oversized с `400` (сообщение «Уведомление слишком длинное…»); `payloadBytes` возвращается в `value`.
* `pushService.buildPushPayload` (`:148-180`) защитно урезает `body`/`title` (и при необходимости `icon`/`data`), чтобы reminder-пути не отправили >4096 байт.

### D-09 — Redis недоступен

Идемпотентность рассылки больше не зависит от Redis (БД + unique index); при недоступном Redis content-dedupe/DB работают. Деградация локов остаётся задокументированной (`distributedLock`, audit): CAS `pending→sending` + возобновляемость снижают риск дублей; при потере лока посреди чанка возможен повтор ≤chunk_size подписок (см. §5).

### D-10 — частичные сбои БД

`persistProgress` после каждого чанка с ретраями; при фатальной ошибке сохранения джоба возвращает рассылку в `pending` (курсор — последний сохранённый), следующий тик продолжит. Курсор/счётчики не теряются вместе с процессом: всё, что успешно сохранено, лежит в БД.

### D-11 — валидация контроллера

Сохранены/используются: `validateBroadcastInput` (лимиты title/body/url/icon, `userIds` до 1000 с дедупликацией, окно планирования 30 с…365 дн, payload ≤3800 байт), `isValidBroadcastId`, ограниченные `limit/offset/search` в `listRecipients`. Rate-limit — только в routes (security).

### D-12 — stale-детектор

Критерий по `updated_at` (обновляется после каждого чанка), fallback `started_at`/`created_at`; «зависшая» рассылка не логируется вечно, а возвращается в `pending` (`pushBroadcastService.js:437-475`).

### D-13 — cleanup

`Backend/jobs/cleanExpiredTokens.js`:

* `GUEST_PUSH_RETENTION_DAYS` (env, default 30) для гостевых подписок; удаляются только давно неактивные (`created_at` **и** `updated_at` старше cutoff), чтобы активные гостевые подписки не исчезали;
* `INVALIDATED_PUSH_RETENTION_DAYS` (env, default 30) для карантинных (`invalidated_at` старше cutoff);
* активные подписки пользователей не трогаются.

### D-14 — subscribe/unsubscribe

`Backend/controllers/pushController.js`:

* `subscribe`: если endpoint принадлежит **другому** user (включая anonymous-запрос, `user_id != null && != userId`) → `409`, никакого «отвязывания»; обновление своей/гостевой строки → `200`, создание → `201`; гонка `findOne/create` ловится (`SequelizeUniqueConstraintError` → повторный findOne → update), `500` больше не возникает; при повторной подписке сбрасываются `invalidated_at/reason/failed_attempts/last_error`.
* `unsubscribe`: `req.user?.id`; авторизованный удаляет только `endpoint + user_id=<id>`, гость — только `endpoint + user_id IS NULL`; всегда `200` (в т.ч. 0 строк), некорректный endpoint — `400`. Роут уже переведён security на `optionalAuth`.

### D-15 — мёртвый/legacy код

* Удалены из `pushService`: `sendToAll`, `sendToFiltered` (не используются; проверено grep).
* Удалены из `pushController`: `sendToUser`, `sendToAll`, `getStats`; routes `/api/push/send`, `/send-all`, `/stats` удалены security-auditor'ом, grep по `Backend` подтверждает отсутствие ссылок.
* `broadcastIdempotency.js` оставлен для mail; push его критический путь не использует.

---

## 3. Совместимость интерфейсов

* `pushService.sendToUser(userId, title, body, icon?, data?)` — сигнатура и ключи результата (`success,total,sent,failed,removed`) сохранены; добавлен `quarantined`. `reminderService` (`sendNotificationPush` из `notificationService.js`) использует `result.sent`/`failed` — работает.
* `pushService.sendToSubscriptions(subscriptions, title, body, icon?, data?)` — совместим; внутри теперь pool/классификация.
* `adminPushController: getOverview/listRecipients/createBroadcast/cancelBroadcast/retryBroadcast`; `pushController: getVapidPublicKey/subscribe/unsubscribe`.
* `createBroadcast` сервиса принимает доп. `idempotencyKey`; старые вызовы без него работают.

---

## 4. Тесты и проверки

Новые тесты:

* `Backend/services/pushService.test.js` (12): классификация ошибок (404/410/400/401/403/413/429/5xx/timeout/network), fingerprint без утечки endpoint, урезание oversized payload, полный сценарий `sendToSubscriptions` (1 успех, 410→destroy, 400→карантин, 500→failed_attempts/карантин после 5), сброс состояния при успехе, пропуск invalidated, worker-pool, `getPushStatus`.
* `Backend/utils/pushBroadcastValidation.test.js` (10): валидация title/body/url/userIds/scheduledFor/includeGuests, payload >3800 байт → отказ, `measurePushPayloadBytes`, `resolveScheduledStatus`, `isValidBroadcastId`, `normalizeIdempotencyKey` (UUID/формат/trim).

Команды/результаты:

```
cd Backend && node --test
ℹ tests 195  ℹ pass 195  ℹ fail 0

cd Backend && node --test services/pushService.test.js utils/pushBroadcastValidation.test.js
ℹ tests 19   ℹ pass 19   ℹ fail 0
```

Дополнительно вручную проверены импорты всех изменённых модулей и роутов (`import(...)`) без запуска сервера; удалённые методы нигде не referenced.

---

## 5. Остаточные риски и ограничения (честно)

1. **Требуется применить миграцию** до старта новой версии backend (production schema check упадёт, если колонок нет). В non-prod `sequelize.sync()` не добавляет колонки в существующие таблицы.
2. **At-least-once на границе чанка.** Если `persistProgress` не сохранится после успешной отправки чанка (БД умерла ровно между отправкой и UPDATE) и процесс упадёт, после восстановления этот чанк (≤`chunk_size`, default 200) может быть отправлен повторно. Для точного exactly-once нужна отдельная таблица доставок на подписку — в согласованную схему не входила.
3. **Старые «зависшие» `sending`-рассылки с `last_processed_id=0`** после релиза будут восстановлены и досланы целиком; если они уже частично ушли до релиза, возможны дубли. Рекомендуется перед деплоем проверить/вручную закрыть такие строки (SQL в отчёте аудита — `status='sending'`).
4. **Немедленный карантин на 400/401/403/413**: глобальная ошибка конфигурации VAPID (не ошибка подписки) отправит в карантин весь список. Это согласовано с ТЗ; лечится повторной подпиской клиента (client-auditor C-03) и алертом на `invalidated`. Желателен мониторинг `pushStatus`/доли quarantined.
5. **Повтор чанка при потере Redis-лока** (несколько реплик + Redis недоступен): `recoverStaleSending` использует окно 10 мин, а чанк при `PUSH_CONCURRENCY=1` и `chunk_size=500` может идти дольше 10 мин (теоретически). При дефолтных значениях (200, concurrency 10) максимум ~3.3 мин — запас есть; рекомендуется не опускать concurrency ниже 2–3 при больших рассылках.
6. **VAPID-конфиг снимается один раз при импорте**: смена env требует рестарта (как и раньше).
7. **Нет интеграционных тестов с реальными PG/Redis** (в этой задаче не было разрешено поднимать сервисы). State machine проверена код-ревью и чистыми юнит-тестами; рекомендуется staging-прогон: создать рассылку на тестовую БД → убить процесс в середине → проверить resume без дублей/потерь, и проверить unique-index идемпотентности параллельными запросами.
8. **Cleanup гостевых подписок** теперь требует и `created_at`, и `updated_at` старше retention; строки с `updated_at IS NULL` (совсем старые) не удаляются — безопасный перекос.
9. `push_broadcasts` не имеет `last_error`-колонки (не входила в согласованный список): причина fatal-провала видна только в логах и через `retry`.

## 6. Cross-file (уже сделано / осталось)

* **Lead:** `MIGRATION_FILES_BY_TABLE` — 14 ключей к `20261022_push_delivery_hardening.sql` (сделано); `/health` → `getPushStatus()` (сделано); CORS `Idempotency-Key` (сделано).
* **security-auditor:** retry-route, `unsubscribe → optionalAuth`, удаление legacy-роутов, `validateSubscriptionForSend` (сделано; мой pushService использует его через namespace-import с внутренним fallback).
* **client-auditor:** admin-панель должна генерировать **UUID** на каждое намерение отправки (не content-hash) и переиспользовать его только для retry того же запроса; кнопка retry для `failed` → новый endpoint (сделано в C-13 по их ТЗ); error-message 409 остаётся защитным.
