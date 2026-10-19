# Фиксы безопасности подсистемы уведомлений (task-7)

**Задача:** task-7 — «Fix notification security/rate-limit/lifecycle defects» (по отчёту `state/notif-audit/03-security.md`, аудит task-3).
**Исполнитель:** security-auditor.
**Область записи (соблюдена):** `Backend/routes/pushRoutes.js`, `Backend/routes/adminPushRoutes.js`, `Backend/routes/notificationRoutes.js`, `Backend/routes/userRoutes.js`, `Backend/utils/pushValidation.js`, новый `Backend/utils/pushValidation.test.js`, этот лог.
**Не трогал:** `Backend/index.js`, контроллеры, сервисы, модели, middleware, Frontend, package.json — их изменения выполняют push-auditor (task-6) и Lead.

---

## 1. Статус фиксов

| ID | Было (аудит task-3) | Что сделано | Статус |
|---|---|---|---|
| S-01 / NS-01 | Анонимная накрутка push-подписок, нет квот | `POST /api/push/subscribe`: два limiter'а — 10/15 мин и 50/сутки; ключ = `user:<id>` для залогиненных, `ipKeyGenerator(ip)` для гостей; `passOnStoreError:false` (fail-closed при сбое Redis-store); allowlist хостов сохранён | ✅ |
| S-02 / NS-07 | Гость не может отозвать push (`requireAuth`) | `POST /api/push/unsubscribe`: `requireAuth → optionalAuth` (+ limiter 30/15 мин по IP); контроллер (task-6) удаляет `user_id IS NULL` строку по endpoint для гостя, свою — для залогиненного, всегда 200 | ✅ |
| S-04 / NS-04 | Legacy `/api/push/send`, `/send-all`, `/stats` живы | Маршруты удалены из `pushRoutes.js`; `requireAdmin`-импорт убран. Контроллерные методы удалены push-auditor'ом (проверено probe-ом). Доказано: в `Backend/routes/` ссылок нет (grep), во Frontend не использовались | ✅ |
| S-05 / NS-05 | Нет rate-limit на админ-рассылках | `adminPushRoutes.js`: 20/час + 60/сутки на создание рассылки, 30/10 мин на cancel/retry; ключ `admin:<id>`; `requireAdmin` сохранён | ✅ |
| retry | Нужен `POST /api/admin/push/broadcasts/:id/retry` | Маршрут добавлен: `requireAdmin` (router-level) + mutation limiter; вызывает `adminPushController.retryBroadcast` (push-auditor, task-6). Защитный `typeof`-wrapper: до появления метода — 501 вместо краша импорта роутера | ✅ |
| S-06 / NS-06 | Нет rate-limit на чтении уведомлений/настройках | `notificationRoutes.js`: GET list + unread-count 300/мин, PATCH read/read-all 120/мин, ключ `user:<id>`; `userRoutes.js`: PATCH notification-preferences 60/мин | ✅ |
| S-07 / NS-02, NS-01 | Слабая валидация подписки; нет перепроверки на отправке | `utils/pushValidation.js`: общий жёсткий валидатор + `validateSubscriptionForSend(sub)` (defense-in-depth на отправке, использует push-auditor в `pushService.js`), сохранена совместимость `isValidPushSubscription`. 12 unit-тестов | ✅ |
| S-08 | mail opt-out, `/health`, шум/прочее | Вне области task-7; зафиксировано в §6. `/health` минимизация — рекомендация Lead (index.js); mail-рассылки без opt-out — смежная зона | ➖ note |
| CORS | `Idempotency-Key` не в `allowedHeaders` → preflight ломает админ-UI | **Уже применено Lead'ом в `index.js`** (см. §5): `allowedHeaders` включает `Idempotency-Key`, добавлен `maxAge: 600`. Проверено по коду | ✅ (Lead) |
| guest CSRF | `hasAuthCookie` не учитывал `guest_token` | **Уже применено Lead'ом в `index.js`**: `hasAuthCookie` = `token \|\| refresh_token \|\| guest_token`. Проверено по коду | ✅ (Lead) |

---

## 2. Изменения по файлам

### 2.1 `Backend/routes/pushRoutes.js` (переписан)

Было: subscribe 20/15 мин (по IP), unsubscribe под `requireAuth`, три legacy admin-маршрута.
Стало:

- `pushRoutes.js:9-11` — константы окон.
- `pushRoutes.js:13-17` — `subscriptionKey(req)`: `user:<id>` если есть сессия (не наказываем общий NAT/CGNAT), иначе `ipKeyGenerator(req.ip)` (IPv6-safe).
- `pushRoutes.js:19-28` — `subscriptionLimiter`: 10 запросов / 15 мин, store-prefix `push-subscription`, `passOnStoreError:false` (fail-closed: при сбое Redis-хранилища запрос отклоняется, а не проходит без учёта квоты — рекомендация аудита NS-01).
- `pushRoutes.js:30-38` — `subscriptionDailyLimiter`: 50 запросов / 24 ч, prefix `push-subscription-daily`, fail-closed.
- `pushRoutes.js:40-47` — `unsubscribeLimiter`: 30 запросов / 15 мин (по IP), prefix `push-unsubscribe`.
- `pushRoutes.js:49` — `GET /vapid-public-key` (без изменений).
- `pushRoutes.js:51-58` — `POST /subscribe`: `optionalAuth → subscriptionLimiter → subscriptionDailyLimiter → контроллер`. `optionalAuth` стоит до лимитеров намеренно: ключ должен быть user-id, при этом для гостя он дешёвый (без обращения к БД, если нет cookie).
- `pushRoutes.js:60-62` — `POST /unsubscribe`: `unsubscribeLimiter → optionalAuth → контроллер` (гость больше не получает 401).
- Legacy-маршруты `POST /send`, `POST /send-all`, `GET /stats` и импорт `requireAdmin` удалены.

### 2.2 `Backend/routes/adminPushRoutes.js`

- `:9` — `router.use(requireAdmin)` (сохранено, все маршруты админские).
- `:11-13` — `adminKey(req)`: `admin:<id>` / fallback IP.
- `:15-23` — `broadcastHourlyLimiter`: 20/час, prefix `admin-push-broadcast`.
- `:25-33` — `broadcastDailyLimiter`: 60/сутки, prefix `admin-push-broadcast-daily`.
- `:35-43` — `broadcastMutationLimiter`: 30/10 мин, prefix `admin-push-broadcast-mutation`.
- `:45-46` — overview/recipients без изменений.
- `:48-53` — `POST /broadcasts`: hourly + daily limiter'ы + контроллер.
- `:54-58` — `POST /broadcasts/:id/cancel`: mutation limiter.
- `:59-67` — **новый** `POST /broadcasts/:id/retry`: mutation limiter + вызов `adminPushController.retryBroadcast(req,res,next)`; при отсутствии метода (неполный деплой) — 501 `{message}` вместо падения импорта роутера.

### 2.3 `Backend/routes/notificationRoutes.js`

- `:9` — `router.use(requireAuth)` (сохранено).
- `:11-15` — `notificationKey(req)`: `user:<id>` / fallback IP.
- `:17-26` — `notificationReadLimiter`: 300/мин, prefix `notification-read`.
- `:28-37` — `notificationMutationLimiter`: 120/мин, prefix `notification-mutation`.
- `:39-42` — маршруты: list/unread-count под read-limiter, read-all/:id/read под mutation-limiter.

### 2.4 `Backend/routes/userRoutes.js`

- `:2` — `import rateLimit, { ipKeyGenerator } from 'express-rate-limit'`.
- `:85-93` — `notificationPreferenceLimiter`: 60/мин, ключ `user:<id>` / fallback IP, prefix `user-notification-preferences`.
- `:122-127` — `PATCH /me/notification-preferences`: `requireAuth → notificationPreferenceLimiter → контроллер`. GET настроек не ограничивался (дешёвое чтение по требованию Lead).

### 2.5 `Backend/utils/pushValidation.js` (переработан, API совместим)

Контракт:

```js
validateSubscriptionForSend(sub) -> { ok: true } | { ok: false, reason: string }
isValidPushSubscription(sub) -> boolean   // = validateSubscriptionForSend(sub).ok (поведение прежнее)
```

Что проверяется (`pushValidation.js:28-58,60-75,88-107`):

- endpoint: строка, длина **≤ 2048** (`MAX_PUSH_ENDPOINT_LENGTH`), нет control-chars/whitespace (`/[\s\u0000-\u001F\u007F]/`), валидный URL, только `https:`, порт `''` или `443`, без `user:pass`, непустой path, host из allowlist (`fcm.googleapis.com`, `fcm.googleapis.cn`, `web.push.apple.com`, `push.services.mozilla.com`, `push.services.mozilla.org`, `notify.windows.com` + поддомены), и **литерально нижний регистр хоста** в исходной строке (`endpoint-host-case`) — URL-парсер нормализует hostname, проверка добавлена для defense-in-depth.
- keys: `p256dh` после base64url-декодирования **ровно 65 байт**, `auth` — **ровно 16 байт**; строгий `[A-Za-z0-9_-]+` (без `=`, `+`, `/`).
- обе формы: вложенная `{endpoint, keys:{p256dh,auth}}` (PushSubscription.toJSON) и плоская `{endpoint, p256dh, auth}` (строка БД) — push-auditor использует её в `pushService.js:127-136` с internal fallback.
- reason-коды (без PII, удобны для логов/quarantine): `subscription-invalid`, `endpoint-missing`, `endpoint-invalid`, `endpoint-too-long`, `endpoint-control-chars`, `endpoint-protocol`, `endpoint-port`, `endpoint-credentials`, `endpoint-path`, `endpoint-host`, `endpoint-host-case`, `keys-invalid`, `p256dh-invalid`, `auth-invalid`.
- экспортирован `isAllowedPushHost(hostname)` (проверен тестами; может переиспользоваться).

### 2.6 `Backend/utils/pushValidation.test.js` (новый)

12 тестов, покрытие: allow fcm/fcm.cn/apple/mozilla(2)/windows(+поддомен), deny http/javascript:/data:/ftp/relative/invalid, порты 8443/80 vs 443, credentials в URL, uppercase-host, control-chars/пробелы/tab/newline/NUL, граница 2048/2049, отсутствие/тип endpoint, вложенная и плоская формы keys, длины 64/66 и 15/17, не-base64url (`=`,`+`,`/`,`!`), пустые/нестроковые/non-object/arrays, `isAllowedPushHost` exact vs suffix, совместимость `isValidPushSubscription`.

---

## 3. Сводная таблица лимитов (только route-level, как согласовано)

| Endpoint | Окно | Limit | Ключ | Store prefix | Fail при ошибке store |
|---|---|---|---|---|---|
| `POST /api/push/subscribe` | 15 мин | 10 | `user:<id>` / IP | `push-subscription` | fail-closed (`passOnStoreError:false`) |
| `POST /api/push/subscribe` | 24 ч | 50 | `user:<id>` / IP | `push-subscription-daily` | fail-closed |
| `POST /api/push/unsubscribe` | 15 мин | 30 | IP | `push-unsubscribe` | существующий стиль (fail-open) |
| `POST /api/admin/push/broadcasts` | 1 ч | 20 | `admin:<id>` | `admin-push-broadcast` | fail-open |
| `POST /api/admin/push/broadcasts` | 24 ч | 60 | `admin:<id>` | `admin-push-broadcast-daily` | fail-open |
| `POST /api/admin/push/broadcasts/:id/cancel` | 10 мин | 30 | `admin:<id>` | `admin-push-broadcast-mutation` | fail-open |
| `POST /api/admin/push/broadcasts/:id/retry` | 10 мин | 30 | `admin:<id>` | `admin-push-broadcast-mutation` | fail-open |
| `GET /api/notifications`, `GET /api/notifications/unread-count` | 1 мин | 300 | `user:<id>` / IP | `notification-read` | fail-open |
| `PATCH /api/notifications/read-all`, `PATCH /api/notifications/:id/read` | 1 мин | 120 | `user:<id>` / IP | `notification-mutation` | fail-open |
| `PATCH /api/users/me/notification-preferences` | 1 мин | 60 | `user:<id>` / IP | `user-notification-preferences` | fail-open |

Все сообщения — на русском, `standardHeaders:true`, `legacyHeaders:false` — как в существующем стиле; store подключается через `rateLimitStoreOptions(...)` (`utils/rateLimitStore.js`), без новых зависимостей.

---

## 4. Проверки (выполнено)

```text
cd Backend
node --test utils/pushValidation.test.js   -> tests 12, pass 12, fail 0
node --test                                -> tests 189, pass 189, fail 0   (интеграция с task-6)
node --check routes/pushRoutes.js          -> OK
node --check routes/adminPushRoutes.js     -> OK
node --check routes/notificationRoutes.js  -> OK
node --check routes/userRoutes.js          -> OK
node --check utils/pushValidation.js       -> OK
node --check utils/pushValidation.test.js  -> OK
```

Дополнительно — `state/notif-audit/scratch/routes.probe.mjs` (одноразовый probe, не прод-код): импортирует реальные роутеры/контроллеры, проверяет:

```text
pushRoutes:        GET /vapid-public-key, POST /subscribe, POST /unsubscribe
adminPushRoutes:   GET /overview, GET /recipients, POST /broadcasts,
                   POST /broadcasts/:id/cancel, POST /broadcasts/:id/retry
notificationRoutes:GET /unread-count, GET /, PATCH /read-all, PATCH /:id/read
userRoutes:        GET + PATCH /me/notification-preferences
assert: кол-во handler'ов (лимитеры реально навешаны), router-level requireAuth/requireAdmin,
        adminPushController.retryBroadcast === function, legacy sendToUser/sendToAll/getStats удалены
ROUTES PROBE OK
```

Grep-доказательство удаления legacy-маршрутов: в `Backend/routes/` нет `push/send`, `send-all`, `sendToAll`, `sendToUser`, `/stats` для push (совпадения `plantRoutes.js` — это `plantController.getStats`, не push). Во Frontend legacy-эндпоинты не использовались (проверено grep по `Frontend/` до изменений).

---

## 5. Кросс-файловые изменения (выполнены другими владельцами)

### Lead — `Backend/index.js` (уже применено в рабочем дереве, проверено чтением)

```diff
 app.use(cors({
     ...
-    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
+    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'Idempotency-Key'],
+    maxAge: 600
 }))
...
-        const hasAuthCookie = Boolean(req.cookies?.token || req.cookies?.refresh_token)
+        const hasAuthCookie = Boolean(
+            req.cookies?.token ||
+            req.cookies?.refresh_token ||
+            req.cookies?.guest_token
+        )
```

Строки в текущем файле: `index.js:163-171` (CORS), `index.js:179-195` (CSRF/origin middleware). Это ровно те изменения, о которых просил аудит (S «CORS Idempotency-Key», S «guest CSRF»); от Lead дополнительных действий по ним не требуется — только не откатывать при мерже.

### push-auditor — task-6 (проверено интеграционно, ничего от меня не требуется)

- `adminPushController.retryBroadcast` существует (`async retryBroadcast`), таймаут-семантика 400/404/409/503/200 согласована; мой роутер вызывает его как `retryBroadcast(req, res, next)`.
- `pushController.unsubscribe` стал гостевым: использует `req.user?.id ?? null` (строки ~98-130) — соответствует `optionalAuth` в роутере.
- `pushController.sendToUser/sendToAll/getStats` удалены (probe подтверждает `undefined`) — legacy-роутов нет.
- `pushService.js` использует **мой** `validateSubscriptionForSend` (`pushService.js:127-136`, namespace-import + internal fallback) — defense-in-depth на отправке работает.
- `index.js` получил `getPushStatus`/`describePushStatus` от push-auditor — к моим файлам отношения не имеет.

---

## 6. Остаточные риски и заметки (вне области task-7)

1. **Нет глобального limiter'а на `/api`** — аудит NS-06 рекомендовал; изменений в `index.js` по этому пункту не делал (вне моей области). Рекомендация Lead: `app.use('/api', rateLimit({...}))` или `limit_req` на edge-nginx; иначе распределённый по многим аккаунтам флуд чтения уведомлений остаётся возможным (per-user лимиты его не ловят).
2. **Per-user ключи**: атакующий с N аккаунтами получает N×50 подписок/сутки. Регистрация ограничена 5/ч/IP, но при ферме прокси это всё ещё возможно; глобальный лимитер/подтверждение владения устройством (в аудите NS-01) — следующий шаг.
3. **`passOnStoreError:false` для subscribe**: при устойчивом сбое Redis-хранилища подписка будет отвечать 500 (fail-closed). Это осознанный выбор (защита от обхода квоты), поведение стоит упомянуть в мониторинге/алерте Redis.
4. **`unsubscribe` и остальные лимитеры остаются fail-open** при ошибках store (существующий стиль `rateLimitStoreOptions`); для unsubscribe это приемлемо (нужен точный capability-endpoint), менять общий util — вне области.
5. **`/health`** по-прежнему отдаёт `deployTarget`, redis/mail status, `backgroundJobs`, aiCache (аудит NS-11) — изменение только в `index.js` (Lead). Мною не трогалось.
6. **Mail-рассылки без opt-out/`List-Unsubscribe`** (аудит NS-12) — смежная mail-зона, не входит в task-7; нужен отдельный фикс.
7. **PII/endpoint в логах** (аудит NS-08) — зона task-6 (`pushService.js`), частично закрыта push-auditor'ом (маскирование endpoint, `validateSubscriptionForSend`); мой вклад — reason-коды без PII и запрет возвращать endpoint в новых ответах (новых ответов не добавлял).
8. **NodePort 30080 / `trust proxy`**: корректность IP-ключей лимитеров зависит от сетевой схемы (edge nginx добавляет XFF; при прямом доступе к NodePort возможна подстановка XFF). Инфраструктурная проверка — вне кода; см. аудит task-3.
9. **Admin-UI idempotency**: CORS-заголовок уже разрешён Lead'ом; после рестарта сервера админ-панель сможет отправлять `Idempotency-Key` (ранее preflight блокировал). Проверить в браузере на стенде — задача интеграционного прогона Lead.
10. **Legacy-контроллерные методы** удалены push-auditor'ом; если между деплоями останется старый `pushController` с методами — вреда нет (маршрутов к ним больше не существует).

---

## 7. Итог

- Все 6 согласованных security-фиксов + новый retry-маршрут реализованы; legacy-поверхность push-рассылки удалена.
- API `pushValidation` расширен без поломки существующих вызовов; добавлены unit-тесты.
- Backend test suite: **189/189 pass, 0 fail**; route-probe подтверждает итоговую маршрутизацию и связи с контроллерами task-6.
- Единственные оставшиеся действия: Lead — не откатывать уже применённые правки `index.js` (CORS `Idempotency-Key`, `guest_token` в CSRF-фолбэке) и, при желании, добавить глобальный `/api` limiter; все «прочие» пункты — отдельные зоны (mail, `/health`, логи).
