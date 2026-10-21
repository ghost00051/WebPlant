# Аудит безопасности подсистемы уведомлений «Лейка» / WebPlant

**Задача:** task-3 — «Audit notification security: authz, input validation, abuse»
**Аудитор:** security-auditor (Team)
**Объект:** in-app уведомления (REST), Web Push подписки, настройки уведомлений, админские push- и mail-рассылки, service worker.
**Метод:** статический анализ кода (read-only), трассировка цепочек middleware и запросов к БД. Запущенного сервера/БД нет, поэтому динамическая проверка не выполнялась; всё, что требует рантайма, помечено явно.
**Ограничения:** `npm audit`/сканер зависимостей офлайн не запускался; оценка сетевой доступности NodePort и фактических значений env — вне возможностей аудита.

---

## 1. Резюме и оценка безопасности

### Оценка: **8 / 10**

Подсистема уведомлений — одна из самых аккуратно написанных частей проекта. Авторизация владения реализована последовательно (каждая выборка/мутация уведомлений ограничена `user_id` из сессии), все админские маршруты закрыты `requireAdmin`, SQL-инъекций нет (raw-SQL параметризован, сортировки по whitelist, `sequelize.literal` — константа), XSS через заголовок/текст уведомления не воспроизводится (React рендерит текстовые узлы, `dangerouslySetInnerHTML`/`innerHTML` во фронтенде отсутствуют, вложение admin-mail preview — в sandboxed iframe), SSRF через endpoint push-подписки заблокирован allowlist-ом хостов, секреты VAPID не утекают через API.

Снято не за «дыры», а за **abuse/жизненный цикл**: неаутентифицированная запись фиктивных push-подписок, отсутствие привязки подписки к сессии/устройству (уведомления предыдущего пользователя продолжают приходить на общий браузер после выхода), отсутствие rate-limit на чтение уведомлений и на админские рассылки, «мёртвые» невалидируемые legacy-маршруты push-рассылки, PII/endpoint-утечки в логи и ответы API. Ни Blocker/Critical/High не обнаружено.

### Модель угроз (кратко)

| Актор | Возможности | Цели/активы |
|---|---|---|
| Анонимный пользователь интернета | любые HTTP-запросы к `/api/*`, в т.ч. без аккаунта | запись мусорных данных, ресурсы/стоимость push-инфраструктуры, DoS |
| Аутентифицированный пользователь (USER) | cookie-сессия, свой аккаунт | чтение чужих уведомлений (IDOR), повышение прав, спам от имени системы |
| Владелец скомпрометированной/украденной админ-сессии | `requireAdmin`-доступ | массовый push/email-фишинг, отмена чужих рассылок, эксфильтрация PII |
| Инсайдер-админ | полный админ-доступ | злоупотребление массовыми рассылками (нет аудита/лимитов) |
| Провайдер push / сетевой атакующий | TLS-перехват не проходит; endpoint — capability-URL | SSRF через endpoint, подмена контента |
| Совместно используемое устройство (общий браузер) | доступ к тому же браузерному профилю | уведомления предыдущего пользователя (имена растений, советы) |

Ключевые границы доверия: браузер↔API (cookie `SameSite=None` в проде, CSRF-защита — только origin/fetch-site middleware), API↔БД/Redis, API↔push-сервисы (SSRF), админ-панель (`ADMIN_PANEL_ORIGIN`)↔API.

---

## 2. Таблица находок

| ID | Severity | Файл:строки | Суть | Сценарий эксплуатации (кратко) |
|---|---|---|---|---|
| **NS-01** | **Medium** | `Backend/routes/pushRoutes.js:20`, `Backend/controllers/pushController.js:15-55`, `Backend/utils/pushValidation.js:21-44`, `Backend/services/pushService.js:50-61,92-141`, `Backend/jobs/cleanExpiredTokens.js:114-116` | `POST /api/push/subscribe` доступен без аутентификации (`optionalAuth`) и принимает любые endpoint-ы, лишь бы хост входил в allowlist push-провайдеров; подтверждения владения устройством нет. Гостевые подписки живут 180 дней, глобального/на-устройство лимита нет; рассылка делает `findAll()` всех подписок и шлёт их последовательно с таймаутом 10 с. | Скрипт с N IP создаёт по 20 подписок/15 мин на IP (`https://fcm.googleapis.com/fake/<rand>` + случайные p256dh/auth корректной длины). Через 180 дней в таблице сотни тысяч строк; админская рассылка «всем» (с `includeGuests`) или legacy `/api/push/send-all` часами висит в последовательной отправке, шлёт запросы в Google/Apple/Mozilla по фиктивным путям и завышает/ломает метрики. |
| **NS-03** | **Medium** | `Backend/controllers/userController.js:357-367`, `Backend/controllers/pushController.js:15-55`, `Frontend/src/component/profile/profile.jsx:369-387`, `Frontend/src/utils/pushNotifications.js:56-101`, `Frontend/public/sw.js:77-115` | Push-подписка не привязана к сессии/устройству и **не удаляется при logout**: серверная сессия отзывается, а строка `push_subscriptions` остаётся привязанной к прежнему `user_id`. Новый пользователь того же браузера не может перепривязать endpoint (получает 409). | Общий/семейный/публичный компьютер: A входит, включает push, выходит. B садится за этот браузер — сервер продолжает слать push для A, ОС показывает B заголовки/тексты уведомлений A (имена растений, советы по уходу, «полив пропущен»); клик открывает `/home` уже под B. То же после продажи/передачи устройства. Отдельно: B не получает собственных push — subscribe отвечает 409 (`pushController.js:28-30`). |
| NS-02 | Low | `Backend/controllers/pushController.js:27-36` | Логика привязки подписки: проверка «endpoint принадлежит другому аккаунту» выполняется только при `existing.user_id && userId && ...`. Если вызывать subscribe **без сессии** (`userId = null`), существующая чужая подписка молча перезаписывается (`user_id: null`, новые `p256dh/auth`). | Злоумышленник с доступом к консоли браузера на общем устройстве получает endpoint через `pushManager.getSubscription()`, отправляет POST `/api/push/subscribe` без cookie → подписка жертвы «отвязывается» и/или перешифровывается под чужие ключи → push-уведомления жертвы перестают доставляться (тихое подавление). Требует знания capability-endpoint; без него неэксплуатируемо. |
| NS-04 | Low | `Backend/routes/pushRoutes.js:23-25`, `Backend/controllers/pushController.js:76-104`, `Backend/services/pushService.js:50-61` | Legacy-маршруты `POST /api/push/send`, `POST /api/push/send-all`, `GET /api/push/stats` живы и смонтированы, но не используются фронтендом. Они обходят новую валидацию (`title/body` не ограничены по длине/типу), очередь, дедупликацию и лимитеры; `send-all` синхронно шлёт по всем подпискам в HTTP-запросе. | Ошибочный/повторный вызов (двойной клик из скрипта, curl, скомпрометированный админ) → дубль push всем пользователям, запрос висит (nginx `proxy_read_timeout 60s`), процесс занят последовательной отправкой; нет `Idempotency-Key`/dedupe. |
| NS-05 | Low | `Backend/routes/adminPushRoutes.js:7-12`, `Backend/controllers/adminPushController.js:196-222`, `Backend/services/pushBroadcastService.js:96-120` | Нет rate-limit на `POST /api/admin/push/broadcasts` (в отличие от mail-рассылок: `adminMailRoutes.js:19-27`). Дедуп — только идентичный текст за 10 мин и только тем же админом. Любой ADMIN может отменить чужую `pending`-рассылку; нет аудита «кто отменил/кто отправил» (только `created_by`). | Украденная админ-сессия → массовые push-сообщения всем пользователям с любым текстом (внутренний URL обязателен, но текст — любой, это социальная инженерия), серия уникальных по тексту рассылок не ограничена; отмена чужой запланированной рассылки не оставляет следов. |
| NS-06 | Low | `Backend/routes/notificationRoutes.js:9-12`, `Backend/index.js:176`, `Backend/controllers/notificationController.js:25-42,56-60,80-91` | На `/api/notifications*`, `PATCH /api/users/me/notification-preferences`, `POST /api/push/unsubscribe` нет rate-limit; глобального limiter-а на `/api` нет (`index.js` — ни одного `app.use(rateLimit)`). `list` делает `findAndCountAll` + второй `count` за запрос, `offset` до 1 000 000; каждый запрос ещё и `auth_sessions`-SELECT в `refreshRememberedSession`. | Один аутентифицированный аккаунт (регистрация ограничена 5/ч/IP) генерирует десятки тысяч RPS на `/api/notifications/unread-count` → каждые 2-3 SELECT-а в PostgreSQL, деградация БД; `offset=1000000` заставляет СУБД сканировать индекс. |
| NS-07 | Low | `Backend/routes/pushRoutes.js:21`, `Backend/controllers/pushController.js:57-74`, `Frontend/src/utils/pushNotifications.js:103-125` | `POST /api/push/unsubscribe` требует `requireAuth` → **гостевая** подписка (`user_id = null`) не может быть удалена через API. Клиентский `unsubscribeFromPush()` при 401 бросает исключение **до** `subscription.unsubscribe()`, поэтому гость не может отключить push и в браузере; строка живёт до 180-дневной очистки. | Гость включил push (endpoint позволяет), решил отключить → UI/API отвечают 401/ошибкой, локальная отписка не выполняется; согласие на уведомления фактически не отзывается. Также после истечения сессии у залогиненного пользователя локальная отписка не срабатывает. |
| NS-08 | Low | `Backend/services/pushService.js:112,116-118`, `Backend/jobs/reminderService.js:209-213,228-232,343-346`, `Backend/controllers/notificationController.js:106,116,152,173`, `Backend/controllers/adminManageController.js:107-110` | Утечки PII/capability в логи и ответы API: push endpoint печатается в логи (первые 50 символов) и **целиком** попадает в массив `errors`, который возвращается админскому API `/api/push/send*`; в консоль логируются имена растений и `user_id`; ошибки Sequelize могут содержать SQL с параметрами. | Endpoint — capability-URL (знание = возможность отвязать/перешифровать подписку, см. NS-02). Утечка через логи/ответы/бэкапы расширяет поверхность NS-02/NS-03; имена растений и id — персональные данные в логах без ротации/редакции. |
| NS-09 | Nit | `Backend/index.js:148-155` (CORS `allowedHeaders`), `Frontend/src/component/adminPush/AdminPushPanel.jsx:287-290`, `Frontend/src/component/adminMail/AdminMailPanel.jsx:418` | **По коду:** админ-UI отправляет заголовок `Idempotency-Key`, но CORS `allowedHeaders: ['Content-Type','Authorization','Cookie']` его не разрешает. Админ-панель/фронтенд (`https://checktheplants.ru`, `ADMIN_PANEL_ORIGIN`) и API (`https://server.checktheplants.ru`) — разные origin → preflight с `Access-Control-Request-Headers: content-type,idempotency-key` должен быть отклонён браузером, т.е. защита от дублей из UI недоступна (или кнопка «Отправить» вовсе не работает). Требует подтверждения в браузере/стенде. | Не эксплуатируется злоумышленником (наоборот — ломает anti-duplicate), но повышает риск повторных массовых рассылок: админ уходит в curl/скрипт, где серверный dedupe уже работает, либо жмёт повторно. |
| NS-10 | Nit (теоретическая) | `Backend/index.js:163-175`, `Backend/utils/authTokens.js:21-22`, `Backend/middleware/guestToken.js:9-15` | CSRF-фолбэк `hasAuthCookie` проверяет только `token`/`refresh_token`. Гостевые маршруты (`/api/chat`, `/api/cookie-consents`) аутентифицируются cookie `guest_token` с `SameSite=None` в проде, но она не считается «auth cookie». Защита держится на `Origin`/`Sec-Fetch-Site`. | В браузере, который не присылает ни `Origin`, ни `Sec-Fetch-Site` для cross-site form POST (устаревшие/экзотические клиенты), возможен CSRF на гостевые state-changing POST-ы (трата AI-бюджета гостя, изменение согласий). В современных браузерах закрыто; помечено как теоретическое. |
| NS-11 | Nit | `Backend/index.js:201-217` | `/health` без аутентификации отдаёт `deployTarget`, состояние Redis/SMTP, `backgroundJobs`, статистику AI-кэша. | Разведка перед атакой: наличие SMTP (фишинг от имени домена), топология (`kubernetes`/`compose`), состояние фоновых задач. |
| NS-12 | Nit (mail, смежная зона) | `Backend/services/mailBroadcastService.js:83-88,472-479`, `Backend/services/mailService.js:491-509` | Mail-рассылка уходит **всем** пользователям с email (`targetMode:'all'` → `where: {}`), без проверки согласия, без opt-out и без заголовка `List-Unsubscribe`. | Массовая маркетинговая рассылка без отписки — риск 152-ФЗ/антиспам-претензий и репутационный; возможно, зона аудитора mail-подсистемы. |

---

## 3. Детальный разбор

### NS-01. Medium. Неаутентифицированная инъекция фиктивных push-подписок (abuse/DoS)

**Доказательство.**
- `Backend/routes/pushRoutes.js:20` — `router.post('/subscribe', subscriptionLimiter, optionalAuth, pushController.subscribe)`; `optionalAuth` (`Backend/middleware/auth.js:130-132`) допускает запрос без cookie, тогда `userId = null` (`pushController.js:21`).
- Валидация (`Backend/utils/pushValidation.js:21-44`) проверяет только: `https:`, порт 443, отсутствие `user/password`, непустой path, host из allowlist (`fcm.googleapis.com`, `web.push.apple.com`, `push.services.mozilla.com`, `notify.windows.com` и их поддомены) и длины ключей (`p256dh` 65 байт, `auth` 16 байт). **Ничто не подтверждает, что endpoint реально выдан push-сервисом и принадлежит этому устройству** — путь может быть произвольным (`https://fcm.googleapis.com/fake/<random>` проходит).
- Строка создаётся: `pushController.js:38-44`; уникальность только по `endpoint` (`Backend/models/PushSubscription.js:19-23,41-44`). Гостевые строки (`user_id IS NULL`) удаляются лишь через 180 дней (`Backend/jobs/cleanExpiredTokens.js:15,114-116`), при этом очистка запускается раз в сутки и только если `BACKGROUND_JOBS_ENABLED` (`index.js:297-306`).
- Отправка: `pushService.sendToAll()` делает `PushSubscription.findAll()` без лимита (`Backend/services/pushService.js:52`), затем `sendToSubscriptions` — **последовательный** цикл `for … await webpush.sendNotification(...)` с таймаутом 10 000 мс на подписку (`pushService.js:78-141`, таймаут `SEND_TIMEOUT_MS` на строке 7). Legacy `/api/push/send-all` (`pushController.js:90-104`) вызывает именно этот путь.
- Лимитер `20 / 15 min` по IP (`pushRoutes.js:10-17`) — единственное ограничение; при `Redis` недоступном используется MemoryStore процесса (`utils/rateLimitStore.js:4-16`) и `passOnStoreError: true` (fail-open при ошибках store).

**Сценарий эксплуатации (анонимный, подтверждён кодом).**
1. Атакующий отправляет 20 JSON-POST-ов на `/api/push/subscribe` с уникальными endpoint-ами `https://fcm.googleapis.com/fake/<uuid>` и случайными ключами корректной длины (base64url 65/16 байт). Каждый проходит `isValidPushSubscription`; запросы дешёвые, ответ 201.
2. Через ботнет/прокси-пул накапливаются сотни тысяч строк за 180 дней (сотни тысяч — при 100 IP), без аккаунта, без подтверждения e-mail.
3. При следующей админской рассылке «всем» с `includeGuests: true` (`pushBroadcastService.js:31-34,137-150`) или через legacy `/api/push/send-all` сервер делает `findAll()` всех подписок и последовательно шлёт запросы в Google/Apple/Mozilla по фиктивным путям. Время отправки ≈ N × (TLS+HTTP+очередь), до 10 с на «зависшую» подписку; job-лок живёт 2 мин с продлением (`jobs/pushBroadcastJob.js:78-82`, `utils/distributedLock.js:34-53`), это не спасает от многолетней по времени рассылки.
4. Итог: задержка/частичный провал реальных уведомлений, исходящий флуд на push-провайдеров (репутация IP/аккаунта), искажение метрик (`total_subscriptions`, `sent_count`/`failed_count`), рост БД и бэкапов.

**Почему Medium, а не High.** Нет компрометации данных, нет обхода авторизации; масштаб ограничен лимитером на IP и тем, что ущерб проявляется при рассылке всех/гостей. При отсутствии Redis-лимитера (in-memory на нескольких репликах/fail-open) масштабируется лучше.

**Исправление.**
- Валидировать endpoint не только на подписке, но и **на отправке** (defense-in-depth): `isValidPushSubscription` в `sendToSubscriptions`/`sendBroadcast`; строки, не прошедшие проверку, удалять.
- Ввести глобальный/на-IP суточный колпак на количество создаваемых подписок и предельный размер таблицы; для гостя — отдельный, более строгий колпак. Идеально: подтверждение владения (отправка одноразового кода push-ом и подтверждение) либо запрет guest-subscribe (только для аутентифицированных, а гостю — только in-app).
- Сократить TTL гостевых подписок (например, 30 дней) и чистить их при отсутствии рассылок.
- Отправку сделать батчами с ограничением конкурентности и общим дедлайном на рассылку (Promise pool), а не последовательным `for`; ограничить число получателей рассылки за раз.
- Лимитер должен быть fail-closed при недоступности Redis, либо иметь детерминированный fallback (не `passOnStoreError`).

---

### NS-03. Medium. Push-подписка переживает logout и не привязана к устройству/сессии (утечка уведомлений на общем устройстве)

**Доказательство.**
- Logout отзывает токены и чистит cookies (`Backend/controllers/userController.js:357-367`), но **не трогает** `push_subscriptions`; фронтенд logout (`Frontend/src/component/profile/profile.jsx:369-387`) просто вызывает API и делает `navigate('/login')` — отписки нет.
- Подписка привязана только к `user_id` (`Backend/models/PushSubscription.js:10-18`), признака сессии/устройства нет; напоминания шлются на все подписки пользователя (`pushService.sendToUser` → `findAll({where:{user_id}})`), содержимое — имена растений, локации, советы (`Backend/jobs/reminderService.js:228-254,497-522`, `Backend/services/careAdviceService.js:169-215`).
- Service worker показывает push без проверки активного аккаунта (`Frontend/public/sw.js:77-115`) — это корректно для push-протокола, но и означает, что получатель — устройство, а не сессия.
- Кнопка «Отключить» в профиле (`profile.jsx:255-257` → `pushNotifications.js:103-125`) работает только при активной сессии; для повторной привязки к другому аккаунту `POST /subscribe` вернёт **409** из-за `existing.user_id !== userId` (`pushController.js:28-30`), т.е. новый пользователь не сможет «перехватить» устройство штатно.

**Сценарий эксплуатации.** Семейный/рабочий/библиотечный компьютер или устройство, переданное другому человеку:
1. A входит в аккаунт, включает push (разрешение + подписка с `user_id = A`).
2. A выходит (или просто закрывает сайт) — сессия отозвана, подписка осталась.
3. B пользуется тем же браузером (свой аккаунт или вообще без входа). Сервер продолжает слать push для A: на экране блокировки/в центре уведомлений ОС B видит «Завтра полить „Фикус“ (кухня)», «Совет по уходу…», «Совет: опрыскайте…». Клик открывает `/home` (уже под B) — контент уведомления уже раскрыт.
4. B пытается включить свои уведомления — 409, подписка A не перепривязывается; B остаётся без push, A — с утечкой.

**Почему Medium.** Утечка персональных данных (список растений, расписание, советы ИИ) третьему лицу без каких-либо привилегий; сценарий массовый (семейные устройства) и не требует атакующего ПО. Не Critical, т.к. нет удалённой эксплуатации и нет доступа к аккаунту.

**Исправление.**
- При logout удалять/обнулять подписку для endpoint-а текущего браузера: клиент перед logout вызывает `POST /api/push/unsubscribe` (endpoint есть в `pushManager.getSubscription()`), сервер — удаляет строку по `endpoint` даже без активной сессии (см. NS-07), либо дизассоциирует `user_id`.
- Хранить в подписке `session_id`/`device_id` (случайный UUID в localStorage) и привязывать доставку к «активной» сессии; при входе другого пользователя на том же устройстве перепривязывать подписку (после подтверждения) или удалять старую.
- В SW при показе push добавлять общую метку приложения и не раскрывать приватный текст на экране блокировки (в `showNotification` можно оставлять нейтральный body, а приватный — только внутри приложения). Как минимум — задокументировать поведение и предложить «отключать push при выходе» по умолчанию на чужих устройствах.
- Добавить тест: после logout `GET /api/admin/push/overview`/БД не содержит активной привязки endpoint к вышедшему пользователю.

---

### NS-02. Low. Обход проверки владения при привязке подписки (`userId = null`)

**Доказательство.** `Backend/controllers/pushController.js:27-36`:

```js
if (existing) {
    if (existing.user_id && userId && existing.user_id !== userId) {   // 28
        return res.status(409).json({ message: 'Подписка уже привязана…' })
    }
    await existing.update({ user_id: userId, p256dh: ..., auth: ..., user_agent: ... }) // 31-36
}
```

Условие требует **одновременно** `existing.user_id` и `userId`. Запрос без сессии (`optionalAuth`, `userId = null`) проходит мимо проверки и перезаписывает чужую подписку: `user_id → null`, ключи → присланные. Дополнительно: гостевая подписка (`user_id = null`) может быть «присвоена» любым, кто знает endpoint (`pushController.js:31-36`).

**Сценарий эксплуатации (capability-limited).** Злоумышленник на общем устройстве открывает devtools на origin приложения, получает `endpoint` через `navigator.serviceWorker.ready.then(r => r.pushManager.getSubscription())`, отправляет POST `/api/push/subscribe` **без cookie** (или с истёкшей сессией) с этим endpoint и своими `p256dh/auth`: подписка жертвы отвязывается/перешифровывается — push-уведомления жертвы тихо перестают доставляться (подавление), при последующем входе жертвы ключи останутся чужими до переподписки. Без знания endpoint (128-битный capability) атака невозможна; XSS, который мог бы утечь endpoint, в аудите не найден, поэтому Low.

**Исправление.**
- Разрешать `update` только если `existing.user_id === null || existing.user_id === req.user.id`; иначе 409 (независимо от наличия сессии).
- Для гостевых endpoint-ов не позволять менять ключи анонимно; привязку гостевой подписки к аккаунту делать только в рамках аутентифицированного запроса с совпадающим `user_agent`/сессией либо через явный confirmation.
- Не возвращать в ответе `user_id` и не различать сообщениями 409/201 статус привязки (анти-энумерация capability).

---

### NS-04. Low. Legacy-маршруты `POST /api/push/send`, `/send-all` живы и обходят новые контроли

**Доказательство.** `Backend/routes/pushRoutes.js:23-25`; реализация `Backend/controllers/pushController.js:76-104`. В `sendToUser/sendToAll` валидация — только `if (!userId || !title || !body)` / `if (!title || !body)`: нет проверки типов, длин (модель/новая валидация допускают 120/1000, здесь — до 100 КБ JSON), нет `Idempotency-Key`, нет очереди, нет дедупликации, нет лимитера. `sendToAll` синхронно вызывает `pushService.sendToAll` (`pushService.js:50-61`: `findAll()` всех подписок + последовательная отправка). Фронтенд эти маршруты не использует (grep по `Frontend/` — только `/subscribe`, `/vapid-public-key`, `/unsubscribe`), т.е. это мёртвый код, оставшийся в поверхности атаки.

**Сценарий.** Двойной вызов из скрипта/curl (или повтор после таймаута nginx: `Backend/nginx/conf.d/default.conf:47-49` `proxy_read_timeout 60s`, отправка легко дольше) → дубль уведомления всем подписчикам; огромный `title/body/data` → push-провайдеры отклоняют пачку, но запрос всё равно выполняется по всем подпискам; компрометация админ-сессии даёт более простой путь массовой рассылки в обход аудита/дедупликации нового API.

**Исправление.** Удалить `/api/push/send`, `/api/push/send-all`, `/api/push/stats` (заменены на `/api/admin/push/*` + очередь) либо закрыть их `NODE_ENV !== 'production'`; при необходимости оставить — прогнать через `validateBroadcastInput`, лимитер, очередь и dedupe.

---

### NS-05. Low. Админские push-рассылки: нет rate-limit и аудита, отмена чужой рассылки

**Доказательство.** `Backend/routes/adminPushRoutes.js:7-12` — `requireAdmin` на весь роутер, но ни одного лимитера (для сравнения mail: `adminMailRoutes.js:19-27` — 30/10 мин). `adminPushController.createBroadcast` (`:121-194`) полагается на дедуп только идентичного текста за `PUSH_BROADCAST_DEDUPE_WINDOW_MS` (10 мин) и `created_by` (`pushBroadcastService.js:96-120`). `cancelBroadcast` (`adminPushController.js:196-222`) не проверяет `created_by` и не пишет аудит — любой ADMIN отменяет любую `pending`-рассылку. Роль одна (`ADMIN`), иерархии/2FA нет (`middleware/admin.js:3-10`, `models/userModels.js:36-44`; `privilege_level` существует, но в авторизации нигде не используется — проверено grep-ом).

**Сценарий.** Украденная/перехваченная админ-сессия (cookie `SameSite=None`, домен `.checktheplants.ru`, `authTokens.js:16-25`) → серия push-сообщений всем пользователям (текст произвольный, только URL ограничен внутренним путём) — социальная инженерия/паника; изменение текста на 1 символ обходит дедуп. Отмена чужой запланированной рассылки не оставляет следа, кто это сделал.

**Исправление.** Rate-limit на создание (например, 10/10 мин на админа, как mail), аудит-лог действий (`created_by`, `canceled_by`, `sent_at`, IP/UA), подтверждение отправки на всех (ввод числа получателей / второй админ), отдельный уровень `SUPERADMIN` для массовых рассылок, 2FA для админ-аккаунтов. Отмену разрешить только автору или супер-админу.

---

### NS-06. Low. Отсутствие rate-limit на чтении уведомлений и глобального лимитера API

**Доказательство.** В `Backend/routes/notificationRoutes.js:9-12` лимитеров нет; в `Backend/index.js` нет ни одного `app.use(rateLimit(...))` — только точечные в `userRoutes/plantRoutes/chatRoutes/uploadRoutes/pushRoutes/adminMailRoutes`. Уведомления: `list` = `findAndCountAll` + `count` (`notificationController.js:80-91`), плюс `countUnread` в ответе (`markRead`/`markAllRead`); `MAX_OFFSET = 1_000_000` (`notificationController.js:15-17`). `refreshRememberedSession` (`index.js:176`) на каждый запрос с cookie делает JWT-verify + SELECT в `auth_sessions` (`utils/authTokens.js:53-81`).

**Сценарий.** Аккаунт (регистрация 5/ч/IP — не бесплатно, но и не барьер) шлёт конкурентный поток `GET /api/notifications/unread-count` → 2 SELECT-а на запрос (сессия + count), `GET /api/notifications?offset=999999` — ещё и index-scan; без лимита на IP/аккаунт это дешёвый способ вывести PostgreSQL/Node из строя или разогреть расходы. Реальный масштаб зависит от edge-лимитов вне репозитория (в `Backend/nginx/conf.d/default.conf` и `Backend/k8s/nginx/*.conf` `limit_req/limit_conn` отсутствуют — проверено).

**Исправление.** Глобальный limiter на `/api` (например, 300/мин/IP) + отдельный per-user на чтение уведомлений (60/мин); кэш `unreadCount` в Redis на 10-30 с; уменьшить `MAX_OFFSET` (5000) и/или перейти на cursor-пагинацию; не делать `count` на каждый list (кэш/`unreadCount` отдельно). Добавить `limit_req` на edge.

---

### NS-07. Low. Гостевые push-подписки не отзываются (согласие не отзывается)

**Доказательство.** `Backend/routes/pushRoutes.js:21` — `unsubscribe` под `requireAuth`; реализация (`pushController.js:57-74`) удаляет по `{endpoint, user_id: req.user.id}` — гостевой запрос получает 401. Клиент (`Frontend/src/utils/pushNotifications.js:103-125`): при `!response.ok` бросается исключение (строка 118-120) **до** `await subscription.unsubscribe()` (строка 122), поэтому и локальная отписка не выполняется; `handlePushToggle` в профиле (`profile.jsx:255-257`) только ловит ошибку. Гостевые строки удаляются лишь через 180 дней (`cleanExpiredTokens.js:114-116`).

**Сценарий.** Гость включил уведомления, затем передумал (или у залогиненного истекла сессия) — отписка невозможна ни на сервере (401), ни в браузере (исключение до `unsubscribe`); сервер продолжает считать устройство подписанным. Нарушение принципа отзыва согласия на обработку (для гостевых broadcast-ов с `includeGuests`) и лишние строки.

**Исправление.**
- Разрешить `POST /api/push/unsubscribe` без авторизации **только** для удаления строки с `user_id IS NULL` по точному `endpoint` (это capability, знание endpoint достаточно для отписки; удалять чужую привязанную подписку по-прежнему нельзя).
- В клиенте вызывать `subscription.unsubscribe()` в `finally`, независимо от ответа сервера.
- Добавить тест: гость → subscribe → unsubscribe → 200, строка удалена.

---

### NS-08. Low. PII и capability-endpoint в логах/ответах API

**Доказательство.**
- `Backend/services/pushService.js:112` — `console.log(... sub.endpoint.slice(0, 50) ...)` (частичный endpoint в каждом успешном send, т.е. в объёме).
- `pushService.js:116-118` — `errors.push({ endpoint: sub.endpoint, error: error.message })`; массив `errors` возвращается в HTTP-ответе legacy `/api/push/send`/`send-all` (`pushController.js:82,98`) — полный endpoint уходит в браузер/логи прокси.
- `Backend/jobs/reminderService.js:209-213,228-232,252,343-346` — имена растений/локации и `user_id` в консольных логах; `console.error(... error)` в контроллерах уведомлений (`notificationController.js:106,116,152,173`) — объект ошибки Sequelize может содержать SQL и параметры (имена растений).
- `adminManageController.js:107-110` — `console.error` с объектом ошибки (SQL/параметры) для админских выборок, включая PII (email/phone).

**Сценарий.** Доступ к логам (Loki/файлы/бэкапы/SIEM) или к ответу legacy-API даёт capability-endpoint-ы → усиливает NS-02/NS-03 (тихое подавление чужих уведомлений); имена растений и советы — персональные данные в логах без маскирования/ротации.

**Исправление.** Не логировать endpoint (или хэш `sha256(endpoint)` + префикс); не возвращать `errors[].endpoint` клиенту (только `{count, sampleError}`); структурированное логирование с redaction (plant.name, user_id → хэш/ид); `sequelize`-ошибки логировать как `error.name + error.parent?.code`, без `sql/parameters`.

---

### NS-09. Nit. CORS `allowedHeaders` не содержит `Idempotency-Key`, который шлёт админ-UI

**Доказательство.** `Backend/index.js:148-155` — `allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']`; `Frontend/src/component/adminPush/AdminPushPanel.jsx:287-290` и `Frontend/src/component/adminMail/AdminMailPanel.jsx:418` отправляют `'Idempotency-Key': ...` в cross-origin запросе (frontend `https://checktheplants.ru`/`ADMIN_PANEL_ORIGIN` ↔ API `https://server.checktheplants.ru`, `Frontend/src/utils/api.js:1-7`), т.е. браузер сделает preflight, а пакет `cors` при явном `allowedHeaders` возвращает статический список и **не** отражает запрошенные заголовки → preflight будет отклонён.

**Сценарий.** Не атака; ломается anti-duplicate UI (см. NS-04/NS-05): админ либо получает ошибку и уходит в curl/скрипт (где серверный dedupe работает, но UI-идемпотентность недоступна), либо жмёт повторно. **Требует подтверждения в браузере** — в репозитории могут быть внешние edge-настройки.

**Исправление.** Добавить `'Idempotency-Key'` в `allowedHeaders` (или использовать `allowedHeaders` без списка / `exposedHeaders`), плюс тест preflight-а в CI (`OPTIONS /api/admin/push/broadcasts` с `Access-Control-Request-Headers`).

---

### NS-10. Nit (теоретическая). CSRF-фолбэк не покрывает `guest_token`

**Доказательство.** `Backend/index.js:163-175`: `const hasAuthCookie = Boolean(req.cookies?.token || req.cookies?.refresh_token)`; cookie гостя (`guest_token`, `httpOnly`, `secure`, `sameSite: 'none'` в проде — `utils/authTokens.js:21`, `middleware/guestToken.js:9-15`) не учитывается. Гостевые маршруты — `POST /api/chat/chat` (`chatRoutes.js:92`) и `POST /api/cookie-consents*` (`userCookieConsentRoutes.js:11-12`, монтируется с `getGuestToken`, `index.js:186,195`) — меняют состояние и аутентифицируются этой cookie.

**Сценарий (теоретический).** Если клиент не присылает `Origin` для cross-site form POST и не присылает `Sec-Fetch-Site` (устаревшие браузеры/прокси/встроенные webview), запрос без auth-cookie проходит CSRF-middleware; `guest_token` (SameSite=None) при этом отправляется, и можно отправить сообщение в гостевой чат/изменить согласия от имени гостя. В актуальных браузерах `Origin`/`Sec-Fetch-Site` для POST присутствуют, поэтому сейчас закрыто; помечено как теоретическое (upstream-контроль проверен — `origins.js:65-94`, `index.js:163-175`).

**Исправление.** Считать `hasAuthCookie` также `guest_token` (или явно требовать `Origin`/`Sec-Fetch-Site` для гостевых POST); `guest_token` привязать к CSRF-токену/двойной cookie, если гостевые операции станут чувствительнее.

---

### NS-11. Nit. Информативность `/health` без аутентификации

`Backend/index.js:201-217`: `deployTarget`, `redis`, `mail`, `backgroundJobs`, `aiCache` — бесплатно для любого. Разведка: наличие SMTP (можно строить фишинг от имени домена), тип развёртывания. **Fix:** оставить только `{status:'ok'}` публично, детали — на `:PORT`/внутренний endpoint или под `requireAdmin`.

### NS-12. Nit (смежная зона mail). Рассылка всем без opt-out и `List-Unsubscribe`

`Backend/services/mailBroadcastService.js:83-88` (`targetMode:'all'` → `where: {}`), `:472-479` (`countAudience` = все пользователи), `mailService.js:491-509` (`sendBroadcastEmail` без unsubscribe-заголовков/ссылки). Отправка идёт тем же `sendMail` через SMTP. Риск: массовые письма без согласия/отписки (152-ФЗ, антиспам, репутация домена). Возможно, входит в задачу аудитора mail-подсистемы; отметка для Lead. **Fix:** сегмент «только с согласием на маркетинг», unsubscribe-токен/ссылка и `List-Unsubscribe`/`List-Unsubscribe-Post`, ограничение частоты на пользователя.

---

## 4. Проверенные и безопасные / закрытые места

Ниже — то, что проверено по коду и признано корректным (чтобы не переделывать и не «находить» повторно).

### 4.1 Авторизация и владение в notification REST
- `Backend/routes/notificationRoutes.js:7` — `router.use(requireAuth)` до всех маршрутов; unauthenticated → 401 (`middleware/auth.js:126-128`).
- `notificationController.list` (`:63-109`) — `where: { user_id: req.user.id, ... }` (строка 79), `unreadCount` тоже по `user_id` (`:56-60,88-90`); в ответе только whitelist-поля `LIST_ATTRIBUTES` (`:4-14`) — без `payload`, `dedupe_key`, чужих данных.
- `markRead` (`:121-155`): `Notification.update({where:{id, user_id: req.user.id, read_at:null}})` + `findOne({where:{id, user_id}})`; чужая запись → 404 без отличия от несуществующей (анти-энумерация). `markAllRead` (`:157-176`) — update строго по `user_id`. ID валидируется `parseNotificationId` (`:44-48`), пагинация/статус — `parsePagination`/`parseStatus` (`:25-54`, whitelist через `Object.hasOwn`).
- Наличие регрессионных проверок IDOR: `Backend/_notif_smoke.mjs:247-263` (user B не видит/не помечает уведомления A; мусорный JWT → 401) — файл-смоук в репозитории (не прод-код).
- `notificationPreferenceController` (`:23-79`) — whitelist полей, булевы проверки, `theme_mode` из enum, всё по `req.user.id`.

### 4.2 Админ-авторизация
- `middleware/admin.js:3-10` — `requireAdmin` = `requireAuth` + `req.user.role !== 'ADMIN'`; `req.user` — строка из БД (`middleware/auth.js:110-120`), а не поле JWT → понижение роли действует немедленно, подделка `role` в JWT не работает.
- Все админ-роутеры закрыты на уровне роутера: `adminPushRoutes.js:7`, `adminMailRoutes.js:29`, `adminRoutes.js:9`; монтирование в `index.js:188-190` — `/api/admin/push` смонтирован **до** `/api/admin`, пересечения нет.
- `adminManageController.updateUser` (`:461-512`): валидация роли/привилегии, запрет менять свою роль, защита «последнего админа»; `deleteUser` (`:514-604`) — запрет удалить себя/последнего админа, каскадное удаление `push_subscriptions`, `notifications`, `notification_preferences` и `push_broadcast_recipients`.
- `GET /api/users` (`userController.js:561-573`) — `attributes:{exclude:['password']}`; хэши паролей не отдаются. `updateProfile` (`:384+`) — whitelist полей, эскалации роли через `/me` нет.
- Админ-панель — на cookie-сессии (`Frontend/admin/js/api.js:24,49`), токенов в localStorage нет; CSP (`Frontend/admin/.htaccess`) `script-src 'self'`, `frame-ancestors 'none'`.

### 4.3 CSRF / origin / CORS
- `index.js:163-175` — origin-проверка применяется ко всем мутирующим методам (`POST/PUT/PATCH/DELETE`); все мутации подсистемы (subscribe/unsubscribe, mark-read, broadcast, preferences) — POST/PATCH. GET-эндпоинты ничего не меняют (проверено по роутерам).
- Заблокированы: чужой `Origin`, `Origin: null` (не проходит `isAllowedOrigin`), отсутствие `Origin` при наличии auth-cookie (строки 168-171). Cookie в проде `SameSite=None` (`authTokens.js:21`), поэтому origin-проверка — основной контроль, и он закрывает CSRF на админ-рассылку (создание broadcast — POST, проверяется).
- `isAllowedOrigin` (`utils/origins.js:65-94`) в проде допускает только `FRONTEND_URL`/`ADMIN_PANEL_ORIGIN`; dev-localhost — только вне production.
- CORS `credentials: true` с allowlist-origin (не `*`), методы ограничены (`index.js:148-155`).

### 4.4 SQL-инъекции
- `Backend/jobs/reminderService.js:304`: `sequelize.literal("(metadata->>'missed_since') IS NOT NULL")` — **константная строка**, интерполяции пользовательских данных нет; тот же приём в `Backend/controllers/plantController.js:1507`. Безопасно.
- `adminManageController` raw-SQL: все значения — bind-параметры (`$1…`), сортировки — из whitelist-словарей (`:37-71,266,666,784,937,1041`), `parseSort/parseOrder` (`utils/adminAnalytics.js:184-193`), `likePattern/escapeLike` экранирует `\ % _` (`:69-71`; `adminManageController.js:99-101`), `activeFilter` — строго `'true'`/`'false'` (`:614-618,640`).
- `pushBroadcastService.listUserSubscriptions`/`mailBroadcastService.listRecipients` — Sequelize `Op.iLike` с экранированным паттерном (`pushBroadcastService.js:22-24,194-247`), SQLi нет.
- `Notification`/`PushBroadcast` — только Sequelize-модели; массовых `sequelize.literal` с пользовательскими данными в подсистеме нет.

### 4.5 XSS / контент уведомлений
- Фронтенд рендерит заголовок/текст как текстовые узлы: `Frontend/src/component/notifications/notifications.jsx:499-504` (`{item.title}`, `{item.body}`); `dangerouslySetInnerHTML`/`innerHTML`/`insertAdjacentHTML`/`document.write` во всём `Frontend/` **не найдены** (grep).
- Переход по уведомлению: `readableUrl` пропускает только пути, начинающиеся с `/` (`notifications.jsx:119-121`), далее `navigate(...)` (строка 358) — server-side URL уведомлений всегда `/home` (`reminderService.js:505,513-518`, `careAdviceService.js:176`), т.е. пользователь не может задать URL уведомления.
- Service worker: `push` показывает `title/body` как plain text (`Frontend/public/sw.js:96-114`); `notificationclick` разрешает URL относительно origin и **проверяет `targetUrl.origin === self.location.origin`**, иначе `/home` (`sw.js:121-127`) — `javascript:`, `data:`, `//evil.com` не проходят; `clients.openWindow/navigate` получают только same-origin (строки 129-140).
- Админская рассылка: URL — только внутренний путь, запрещены `//`, `/\`, пробелы, control-chars (`pushBroadcastValidation.js:43-61`); `icon` — только `/` или `http(s)://` (`:63-77`), сервер иконку не скачивает.
- Mail preview: HTML рендерится в iframe с `sandbox=''` (`Frontend/src/component/adminMail/AdminMailPanel.jsx:810-817`) — скрипты не исполняются, отдельный origin; содержимое письма экранируется (`mailService.js:409-419`, `renderBroadcastEmail` — `escapeHtml` для subject/greeting/body/cta/url).
- Контент советов ИИ перед записью уведомления нормализуется и валидируется: `utils/careKnowledge.js:296,464-546` (`trimText`, лимиты 80/300/200, запрет дозировок/частот/пестицидов), `careAdviceService.js:140-187`; URL не из ИИ. Prompt-injection из имени растения может испортить только текст совета самому пользователю — не XSS/не доступ к чужим данным.

### 4.6 SSRF через push-endpoint
- `utils/pushValidation.js:1-14,21-44`: только `https`, порт 443, без `user:pass`, непустой path, hostname в allowlist (`fcm.googleapis.com`, `web.push.apple.com`, `push.services.mozilla.com`, `notify.windows.com` + поддомены), длины ключей `p256dh`/`auth` проверены. `web-push` шлёт запрос только на сохранённый endpoint; иных путей записи `push_subscriptions` в коде нет (grep `PushSubscription.create` — только `pushController.subscribe`). SSRF к внутренним адресам заблокирован. Остаточный hardening — перепроверять endpoint на отправке (NS-01).
- `mailService` не принимает произвольный URL для серверных запросов; `ctaUrl` — только для письма (ссылка), `icon`/логотип не скачиваются сервером.

### 4.7 Ключи, секреты, конфигурация
- VAPID private key нигде не отдаётся: `GET /api/push/vapid-public-key` возвращает только публичный ключ (`pushController.js:6-13`), private — только env. `validateProductionConfig` требует `VAPID_SUBJECT/PUBLIC/PRIVATE` и `SECRET_KEY ≥ 32 байт` (`index.js:92-114`).
- `Backend/.env` в git не отслеживается (`git ls-files` пусто, `.gitignore:2`); в k8s секреты — `secretRef webplant-secrets`, ConfigMap `10-configmap.yaml` содержит только несекретные значения (`40-backend.yaml:70-76`).
- Redis URL маскируется при логировании (`redis.js:216-221`); SQL-логирование Sequelize выключено (`db.js:12`).
- `broadcastIdempotency.normalizeIdempotencyKey` — charset/length-валидация ключа, инъекция в Redis-ключ исключена (`utils/broadcastIdempotency.js:6-16`).
- JWT access/session/refresh — сроки 15 мин/24 ч/30 дней, отзыв через `auth_sessions` (`authTokens.js:6-10,53-117`); refresh-cookie `httpOnly` и `path:/`, домен `.checktheplants.ru` в проде (осознанно для поддоменов).

### 4.8 Дедупликация/идемпотентность и целостность очереди
- `models/Notification.js:72-86` — уникальный индекс `(user_id, dedupe_key)`; `storeNotification` — `findOrCreate` (`services/notificationService.js:21-37`); `dedupeKey` валидируется 1-255 (`:17-19`).
- Push-рассылки: `Idempotency-Key` → Redis с TTL 24 ч (`broadcastIdempotency.js`), контентный dedupe 10 мин (`pushBroadcastService.js:96-120`), статусы/cas в job-е (`jobs/pushBroadcastJob.js:43-50`), распределённый лок Redis (`distributedLock.js:55-126`).
- Ограничения размеров: JSON 100 КБ (`index.js:161-162`); broadcast title/body/url/icon/users/scheduled — `pushBroadcastValidation.js:1-16,142-184`; mail — `mailBroadcastValidation.js:1-16,147-192`; recipients limit 200 (`adminPushController.js:16-19`), userIds ≤ 1000.

### 4.9 Прочее, проверенное и не являющееся находкой
- `errorHandler` в `index.js:227-242` отдаёт generic-сообщения без stack trace (`middleware/errorHandler.js` не используется — мёртвый файл).
- `GET /api/push/stats` — `requireAdmin` (`pushRoutes.js:25`); гостевые/obщие счётчики только админу.
- Удаление пользователя чистит push/notifications (`adminManageController.js:570-573`) — GDPR-подобная очистка есть.
- Retention уведомлений 180 дней (`cleanExpiredTokens.js:40-42`), гостевых подписок — 180 дней (`:114-116`).
- `trust proxy 1` (`index.js:141`) корректен для схемы edge-nginx (stream gateway на L4, `X-Forwarded-For` добавляется `$proxy_add_x_forwarded_for` — `Backend/nginx/conf.d/default.conf:37-50`): `req.ip` = реальный клиент, спуфинг XFF через edge не проходит (проверено по конфигам). *Остаточное условие:* прямой доступ к NodePort 30080 (`k8s/40-backend.yaml:20-33`) в обход edge позволил бы подставлять XFF (при `trust proxy 1` и отсутствии прокси `req.ip` берётся из XFF) → обход IP-лимитеров; требует проверки сетевой доступности, в статике не подтверждается.

---

## 5. Приоритетный план исправлений

### P0 — 1-2 дня (закрыть abuse/утечки приватности)
1. **NS-02:** в `pushController.subscribe` разрешить `update` только при `existing.user_id === null || existing.user_id === req.user?.id`; иначе 409. Тесты: аноним не может отвязать/перешифровать чужой endpoint.
2. **NS-03:** удалять/дизассоциировать подписку при logout и при входе другого пользователя (клиент вызывает `POST /api/push/unsubscribe` перед logout; сервер удаляет по endpoint **без** требования активной сессии для `user_id IS NULL` и по сессии для привязанной). Добавить `device_id`/`session_id` в подписку; в SW не раскрывать приватный текст на lock-screen.
3. **NS-01 (минимум):** валидировать endpoint на отправке, ввести суточный колпак на создание подписок (per-IP и глобальный), сократить TTL гостевых подписок, ограничить `sendToAll` батчем/конкурентностью/дедлайном, сделать rate-limit fail-closed при падении Redis.
4. **NS-07:** разрешить гостевой `unsubscribe` (удаление только `user_id IS NULL` по `endpoint`); в клиенте `subscription.unsubscribe()` в `finally`.

### P1 — неделя (поверхность атаки и лимиты)
5. **NS-04:** удалить legacy `/api/push/send`, `/send-all`, `/stats` (заменены на `/api/admin/push/*`).
6. **NS-05:** rate-limit на `POST /api/admin/push/broadcasts` (и `mail/broadcasts` выровнять), аудит-лог (`created_by/canceled_by/sent_at/ip/ua`), отмена только автором/супер-админом, подтверждение для «всем», 2FA для админов.
7. **NS-06:** глобальный limiter `/api` + per-user limiter на уведомления; кэш `unreadCount`; `maxOffset` ↓; `limit_req` на edge-nginx.
8. **NS-08:** убрать endpoint из логов/ответов, redaction PII, не логировать `sql/parameters` Sequelize.

### P2 — 2-3 недели (гигиена, defense-in-depth)
9. **NS-09:** добавить `Idempotency-Key` в CORS `allowedHeaders`, preflight-тест в CI.
10. **NS-10:** учитывать `guest_token` в CSRF-фолбэке (или требовать `Origin`/`Sec-Fetch-Site` для гостевых POST).
11. **NS-11:** свернуть публичный `/health` до `{status}`.
12. **NS-12:** согласовать с владельцем mail-подсистемы: сегмент по согласию, unsubscribe-токен/ссылка, `List-Unsubscribe`; лимит писем на пользователя.
13. Инфраструктура (вне кода подсистемы, но влияет): проверить, что NodePort 30080 закрыт снаружи; аудит зависимостей `web-push@3.6.7`, `express-rate-limit@8.7.0`, `cors@2.8.6`, `sequelize@6.37.8` (в этой сессии не запускался — нет сети).

---

## Приложение A. Инвентарь маршрутов подсистемы и контроли

| Маршрут | Middleware | Rate limit | Владение/роль | Примечание |
|---|---|---|---|---|
| `GET /api/notifications` | `requireAuth` | нет | `user_id = req.user.id` | `limit/offset/status` валидируются |
| `GET /api/notifications/unread-count` | `requireAuth` | нет | свой | 1 SELECT |
| `PATCH /api/notifications/:id/read` | `requireAuth` | нет | `id + user_id`, 404 на чужой | идемпотентно (`changed`) |
| `PATCH /api/notifications/read-all` | `requireAuth` | нет | `user_id` | — |
| `GET /api/users/me/notification-preferences` | `requireAuth` | нет | свой | whitelist ответа |
| `PATCH /api/users/me/notification-preferences` | `requireAuth` | нет | свой | whitelist полей |
| `GET /api/push/vapid-public-key` | — | нет | публично (by design) | только public key |
| `POST /api/push/subscribe` | `optionalAuth` | 20/15мин/IP | привязка к `user_id` при наличии сессии; **проверка владения неполная (NS-02)** | endpoint allowlist (NS-01) |
| `POST /api/push/unsubscribe` | `requireAuth` | нет | `endpoint + user_id` | **гость не может (NS-07)** |
| `POST /api/push/send` | `requireAdmin` | нет | admin | legacy, без валидации (NS-04) |
| `POST /api/push/send-all` | `requireAdmin` | нет | admin | legacy, синхронно все подписки (NS-04) |
| `GET /api/push/stats` | `requireAdmin` | нет | admin | legacy |
| `GET /api/admin/push/overview` | `requireAdmin` | нет | admin | — |
| `GET /api/admin/push/recipients` | `requireAdmin` | нет | admin | email/name/role (PII, ожидаемо) |
| `POST /api/admin/push/broadcasts` | `requireAdmin` | нет (NS-05) | admin; dedupe+idempotency | валидация title/body/url/ids |
| `POST /api/admin/push/broadcasts/:id/cancel` | `requireAdmin` | нет | любой admin (NS-05) | только `pending` |
| `GET /api/admin/mail/overview|recipients` | `requireAdmin` | нет | admin | — |
| `POST /api/admin/mail/preview` | `requireAdmin` | нет | admin | HTML → sandboxed iframe |
| `POST /api/admin/mail/test` | `requireAdmin` | 5/10мин | admin | только на свой email |
| `POST /api/admin/mail/broadcasts` | `requireAdmin` | 30/10мин | admin | dedupe+idempotency |
| `POST /api/admin/mail/broadcasts/:id/cancel` | `requireAdmin` | нет | любой admin | — |
| `/api/admin/users|plants|waterings|photos|chat` | `requireAdmin` (роутер) | нет | admin | Параметризованный raw SQL, whitelist сортировок |

## Приложение B. Сводка по severity

- **Blocker:** 0
- **Critical:** 0
- **High:** 0
- **Medium:** 2 (NS-01 abuse/DoS; NS-03 приватность на общем устройстве)
- **Low:** 6 (NS-02, NS-04, NS-05, NS-06, NS-07, NS-08)
- **Nit:** 4 (NS-09, NS-10, NS-11, NS-12)
