# Аудит подсистемы push-доставки, подписок и админ-рассылок

**Задача:** task-2 «Audit push delivery pipeline, subscriptions, broadcasts»
**Аудитор:** push-auditor
**Объект:** WebPlant / «Лейка», Backend (Node.js 24, Express 5, Sequelize/PostgreSQL, Redis, node-cron, web-push/VAPID)
**Режим:** read-only статический анализ кода + исполняемые probe-скрипты в `state/notif-audit/scratch/` (без БД, Redis и сети)
**Дата:** 2026-10-19

---

## 1. Краткое резюме и оценка

**Оценка: 4 / 10.**

Плюсы подсистемы существенны: входящие push-подписки валидируются по allowlist push-провайдеров и формату ключей, админ-рассылка проходит `requireAdmin`, создание рассылки идёт в транзакции, захват рассылки планировщиком сделан атомарным CAS-переходом `pending → sending` под распределённым Redis-локом с продлением, а in-app уведомление создаётся **до** отправки push и поэтому не теряется при ошибке push. 410/404 действительно удаляют мёртвую подписку (подтверждено probe-тестом).

Однако доставка push и админ-рассылки в текущем виде **не являются production-grade**:

* у рассылки нет ни по-получательского статуса, ни чекпоинтов, ни resume: падение/рестарт/деплой в середине отправки навсегда оставляет рассылку в `sending` с частичной доставкой и нулевыми счётчиками, при этом API/UI не дают её ни перезапустить, ни отменить (Critical);
* идемпотентность рассылки неатомарна (GET → INSERT → SET без `NX` и без уникального индекса в БД) — узкая, но реальная гонка даёт дублирующую массовую отправку (High);
* Idempotency-Key на клиенте детерминирован от текста и живёт 24 часа: осознанно повторная и, что важнее, **повторная после сбоя** одинакового текста молча не отправляется, а запланированная повторная отправка возвращает 200 и UI пишет «запланирована» (High);
* политика ошибок доставки: обрабатываются только 404/410, для 429/5xx/timeout нет ни одного retry, а 400/401/403/413 остаются в БД навсегда и долбятся при каждой следующей отправке; после ротации/смены VAPID-ключей вся база подписок превращается в вечный источник ошибок без алерта (High);
* отправка последовательная, `findAll()` без лимита и без чанков: `N × 10 с` таймаута, риск OOM при лимите контейнера 512 Mi, многочасовые задачи, голодание остальных рассылок и reminder-тика (High);
* наблюдаемость: по-получательского статуса нет вообще, ошибки пишутся в лог без endpoint и statusCode, массив `errors` (max 20) нигде не сохраняется и не логируется, алертов/метрик нет, статус `sent` показывается даже при `failed_count > 0` (High).

Дополнительно: 7 Medium-находок (жизненный цикл подписок и shared-device, отсутствие VAPID-конфига, отсутствие лимитов на админ-рассылку, размер payload > 4 КБ, деградация при недоступном Redis, частичный сбой → `failed` → дубли при повторе и др.) и 6 Low/Nit. Ни один из дефектов не приводит к потере in-app уведомления — этот инвариант соблюдён, но push-канал и админ-рассылки требуют переработки перед тем, как считать их надёжными.

**Что проверено:** сквозные цепочки `routes → middleware → controllers → services → models → jobs`, `web-push` 3.6.7 (исходники в `Backend/node_modules/web-push/src/`), `redis.js`, `distributedLock.js`, миграции, k8s/compose-ограничения, серверная и клиентская части рассылки. Probe: `state/notif-audit/scratch/pushService.probe.test.mjs` (5 тестов, все проходят), `state/notif-audit/scratch/idempotency-key.probe.mjs`.

**Ограничения аудита:** нет работающих PostgreSQL/Redis и сети, поэтому проверялись только код и смоделированные исходы `web-push`; фактическое состояние индексов в production-БД и реальные коды ответов push-провайдеров не наблюдались. Там, где вывод зависит от состояния БД (уникальные индексы, число подписок), это оговорено явно.

---

## 1.1. Сквозные цепочки вызовов (что именно трассировано)

**Админ-рассылка (основной путь):**

1. `POST /api/admin/push/broadcasts` → `Backend/routes/adminPushRoutes.js:7` (`requireAdmin`) → `adminPushController.createBroadcast` (`Backend/controllers/adminPushController.js:121-194`).
2. Валидация `validateBroadcastInput` (`Backend/utils/pushBroadcastValidation.js:142-184`), проверка `isPushConfigured` только для немедленной отправки (`adminPushController.js:129-131`), Idempotency-Key (`:134-150`), content-dedupe за 10 минут (`:152-169`).
3. `pushBroadcastService.createBroadcast(..., { deferDelivery: true })` (`Backend/services/pushBroadcastService.js:37-94`): в транзакции `COUNT` подписок и `INSERT` рассылки (+`PushBroadcastRecipient` для режима `users`); статус `pending` (`:48`).
4. `pushBroadcastJob` (cron `* * * * *`, `Backend/jobs/pushBroadcastJob.js:76`) под `withDistributedLock('job:push-broadcast', ttl 2 мин)` (`:78-82`): `logStaleSending` (`:11-31`) → `listPendingDue` (`pushBroadcastService.js:180-192`) → CAS `pending→sending` (`pushBroadcastJob.js:43-48`).
5. `pushBroadcastService.sendBroadcast` (`:122-170`): повторное чтение, `PushSubscription.findAll` всего набора (`:142`), `pushService.sendToSubscriptions` (`:144-150`), один финальный `UPDATE` счётчиков и статуса (`:152-161`).
6. `pushService.sendToSubscriptions` (`Backend/services/pushService.js:78-138`): последовательный `for…of`, `webpush.sendNotification` c `timeout: 10_000` (`:92-109`), удаление только при 410/404 (`:120-124`), финальный агрегат (`:128-137`).
7. Модели: `PushBroadcast` (`Backend/models/PushBroadcast.js`), `PushBroadcastRecipient` (`Backend/models/PushBroadcastRecipient.js`), `PushSubscription` (`Backend/models/PushSubscription.js`).

**Напоминания о поливе (push-часть, для ответа на вопрос «теряется ли in-app»):**

`reminderService.tick()` (`Backend/jobs/reminderService.js:256-273`) → `sendDayBefore` (`:388-431`)/`sendOnDay` (`:433-472`)/`sendMorningSummary` (`:275-348`)/`notifyAutoSkip` (`:228-254`) → `storeNotification` (`Backend/services/notificationService.js:21-39`, `findOrCreate` по уникальному `(user_id, dedupe_key)`) → **затем** `pushService.sendToUser` (`reminderService.js:497-522`). `markNotified`/`last_morning_summary_date` обновляются только при `result.sent > 0` (`:339-341`, `:421-423`, `:462-464`).
Care advice: `careAdviceService.sendDailyAdvicesForUser` (`Backend/services/careAdviceService.js:32-234`) → `storeNotification` (`:170-187`) → `if (!created) continue` (`:201`) → push (`:203-221`) → `last_care_advice_date` всегда (`:226`).

**Подписки:**

`POST /api/push/subscribe` (`Backend/routes/pushRoutes.js:20`: rate-limit 20/15 мин + `optionalAuth`) → `pushController.subscribe` (`Backend/controllers/pushController.js:15-55`); `POST /api/push/unsubscribe` (`pushRoutes.js:21`, `requireAuth`) → `pushController.unsubscribe` (`:57-74`); ключ: `GET /api/push/vapid-public-key` (`:6-13`). Клиент: `Frontend/src/utils/pushNotifications.js`, SW `Frontend/public/sw.js:143-178`, повторная привязка после логина `Frontend/src/component/registration/registration.jsx:110-121,193`.

---

## 2. Таблица находок

| ID | Severity | Файл:строки | Суть | Сценарий отказа |
|---|---|---|---|---|
| P-01 | **Critical** | `Backend/services/pushBroadcastService.js:122-170`; `Backend/jobs/pushBroadcastJob.js:11-31,33-73`; `Backend/models/PushBroadcastRecipient.js:1-45`; `Backend/index.js:313-337` | Нет по-получательских записей/чекпоинтов/resume: отправка — один неделимый проход в памяти + один финальный `UPDATE`; статус `sending` после падения не восстанавливается (stale только логируется), отменить/перезапустить нельзя | Деплой/крэш/`docker restart` в середине рассылки на 20k подписок: часть получила push, часть нет, в БД `sending`, `sent_count=0`, каждый тик в лог «зависла — пропускаем», восстановления нет; через 3 дня админ видит «Отправляется» навсегда |
| P-02 | **High** | `Backend/controllers/adminPushController.js:134-150,171-179`; `Backend/utils/broadcastIdempotency.js:18-61`; миграция `Backend/migrations/20261010_create_push_broadcasts.sql:3-37` | Идемпотентность неатомарна: `GET` → `INSERT` (транзакция) → `SET` без `NX`; уникального индекса по ключу/контенту в БД нет; результат `rememberIdempotentBroadcast` игнорируется | Двойной клик/две вкладки/два админа/клиентский retry после сетевого таймаута: оба запроса проходят `findIdempotentBroadcast` и `findRecentDuplicate`, создаются две `pending`-рассылки → cron отправляет обе → каждый подписчик получает дубль |
| P-03 | **High** | `Frontend/src/component/adminPush/AdminPushPanel.jsx:267-280,309-316`; `Backend/utils/broadcastIdempotency.js:4`; `Backend/controllers/adminPushController.js:136-149,181-186` | Idempotency-Key выводится только из текста/URL/режима получателей (без `scheduledFor`, без админа, без nonce) и живёт 24 ч; повторная осознанная или повторная после сбоя отправка того же текста молча не создаётся; ответ «deduplicated, queued:true» UI трактует как «запланирована» | Пуш-провайдер час лежал, рассылка «Сервис недоступен сегодня» ушла в `failed`; админ жмёт «повторить» — сервер отвечает 200 deduplicated, ничего не отправляется, статус остаётся `failed`; или админ планирует тот же текст на завтра — UI пишет «запланирована», а рассылки не существует |
| P-04 | **High** | `Backend/services/pushService.js:92-137` (особенно `:113-126`) | Политика ошибок: удаляются только 410/404; 400/401/403/413 остаются в БД навсегда и повторяются при каждой отправке; для 429/5xx/timeout нет ни retry, ни backoff; нет per-endpoint состояния/карантина | FCM отдаёт 500/429 на один тик — push одноразового уведомления (care advice, auto-skip) потерян навсегда; после смены VAPID-ключей все подписки отдают 401, но не удаляются: каждая следующая рассылка — N неудачных запросов, статус `failed`, причина не видна |
| P-05 | **High** | `Backend/services/pushService.js:7,50-61,78-138`; `Backend/services/pushBroadcastService.js:142,144-150`; `Backend/k8s/40-backend.yaml:108-112` | Отправка строго последовательная (`for…of`, до 10 с на подписку), весь набор грузится `findAll()` в память, нет чанков/лимита конкурентности/бюджета времени; лимит памяти pod 512 Mi | 100k подписок: только `endpoint`-данные десятки-сотни МБ + объекты Sequelize → OOM-kill; при медленных ответах — часы работы, следующие запланированные рассылки стоят в очереди, reminder-тик блокируется/голодает |
| P-06 | **High** | `Backend/services/pushService.js:113-118,128-137`; `Backend/services/pushBroadcastService.js:152-159`; `Backend/jobs/pushBroadcastJob.js:84-92`; `Backend/controllers/adminPushController.js:21-32`; `Frontend/src/component/adminPush/AdminPushPanel.jsx:694-698` | Нет сохранённого per-recipient статуса доставки; ошибки логируются без endpoint/statusCode, массив `errors` (≤20) не персистится и не логируется; нет метрик/алертов; админ видит только агрегаты последних 5 рассылок | Ночная запланированная рассылка «упала» целиком: в логах 500 строк «❌ Ошибка push: …» без endpoint, в UI «Не доставлена» без причины, никто не уведомлён; при `sent_count=800, failed_count=200` UI пишет «Отправлена», пострадавших не найти |
| P-07 | **Medium** | `Backend/services/pushService.js:120-125`; `Backend/jobs/pushBroadcastJob.js:57-69`; `Backend/services/pushBroadcastService.js:152-161` | Ошибка БД при удалении мёртвой подписки (внутри `catch`) или при финальном `UPDATE` после частичной отправки: исключение обрывает батч, счётчики не сохраняются; job помечает `failed` → возможен повтор с дублями уже доставленным | Во время рассылки БД на 2 с недоступна: на 410-подписке `sub.destroy()` бросает, остальные подписки не обработаны, `sendBroadcast` бросает, job ставит `failed`, `sent_count=0`. После восстановления БД админ повторяет — часть пользователей получает второе push |
| P-08 | **Medium** | `Backend/services/pushService.js:10-22,36-48,140-144`; `Backend/services/pushBroadcastService.js:144`; `Backend/controllers/adminPushController.js:129-131`; `Backend/index.js:104-107,201-217` | Поведение без VAPID несогласовано: reminder-пути бросают `ensureConfigured()`; broadcast-путь идёт в `sendToSubscriptions` **без** проверки → N запросов без `Authorization`, все 401/403, подписки остаются; запланировать рассылку без VAPID можно (503 только для немедленной); невалидные VAPID-ключи кидают исключение при импорте и роняют весь backend; `/health` про push не говорит | В staging отсутствует `VAPID_PRIVATE_KEY`: напоминания не отправляются, в лог по ошибке на каждое уведомление, флаги «уведомлён» не ставятся; запланированная админ-рассылка «выполняется» и падает всеми 401; при опечатке в ключе production не стартует вообще (сообщение из web-push, без указания, что дело в VAPID) |
| P-09 | **Medium** | `Backend/controllers/pushController.js:21-45,57-74`; `Backend/controllers/userController.js:357-370`; `Frontend/src/component/registration/registration.jsx:110-121`; `Backend/jobs/cleanExpiredTokens.js:114-116`; `Backend/routes/pushRoutes.js:20-21` | Жизненный цикл подписок: logout не отзывает/не отвязывает подписку; на общем устройстве вход другим аккаунтом получает 409 (`existing.user_id && userId && !==`) и клиент молча проглатывает ошибку; гость может «отвязать» подписку пользователя (`update { user_id: null }`); гость не может отписаться (нужен `requireAuth`); гостевая чистка идёт по `created_at` и удаляет активные подписки старше 180 дней | Общий компьютер: A выходит, B входит — push B не работает (409, только `console.warn`), а A продолжает получать свои напоминания на устройство, которым не пользуется; гостевая подписка, которой пользуются год, удаляется ночью по возрасту, хотя `updated_at` свежий |
| P-10 | **Medium** | `Backend/jobs/reminderService.js:331-341,414-423,455-464`; `Backend/services/careAdviceService.js:169-187,201-226` | Успех push управляет бухгалтерией: `markNotified`/`last_morning_summary_date` только при `sent>0` → у пользователя без push/с ошибкой флаги не ставятся и тик повторяет работу; в care advice наоборот: `if (!created) continue` → если push не удался после создания строки, повтор push невозможен вообще (`last_care_advice_date` ставится всегда) | Пользователь с 10 растениями и без push-подписки: `sendDayBefore` (окно 09–21) каждые 10 минут 12 часов делает `findOrCreate` + `findAll`, пишет «Нет подписок» и не помечает «уведомлён» (72 итерации/растение); пользователю с упавшим FCM care-совет приходит в in-app, но push не будет никогда |
| P-11 | **Medium** | `Backend/routes/adminPushRoutes.js:7-12`; `Backend/routes/pushRoutes.js:10-25`; `Backend/controllers/pushController.js:76-104` | На создание админ-рассылки нет rate-limit/квоты/дедупликации по админу; живы legacy-эндпоинты `/api/push/send` и `/api/push/send-all` (admin-only), которые синхронно рассылают без аудита, idempotency, сохранения счётчиков и валидации длины `title/body/data`; `send-all` грузит все подписки в HTTP-обработчике | Скомпрометированный/неаккуратный админ или скрипт создаёт 200 разных рассылок за минуту: они сериализуются в один cron-проход и часами шлют push; `/send-all` с телом 100 КБ: запрос висит N×10 с, потом 504 у админа, а рассылка без аудита уже частично ушла; повтор даёт дубли |
| P-12 | **Medium** | `Backend/utils/pushBroadcastValidation.js:1-7`; `Backend/services/pushService.js:79-85`; `Backend/controllers/pushController.js:76-104` | Не валидируется суммарный размер payload против лимита Web Push 4096 байт (шифрование добавляет ~86+ байт): title 120 + body 1000 символов (кириллица = 2 байта) + url/icon до 2048 символов в сумме легко дают > 4 КБ; legacy-эндпоинты вообще без лимитов | Админ отправляет текст на 1000 символов кириллицей и длинную ссылку: **все** push отклоняются провайдером с 413, рассылка `failed`, подписки не удаляются; ошибка выглядит как «Ошибка push: Received unexpected response code», причина неочевидна |
| P-13 | **Medium** | `Backend/utils/broadcastIdempotency.js:21-23,42-43,56-59`; `Backend/controllers/adminPushController.js:178`; `Backend/services/pushBroadcastService.js:117`; `Backend/utils/distributedLock.js:59-61,76-82`; `Backend/redis.js:122-157` | При недоступном Redis идемпотентность молча отключается (fail-open), остаётся только content-dedupe 10 мин, причём с фильтром `created_by`; результат сохранения ключа игнорируется; локи деградируют в «выполнять всем» | Redis в breaker-паузе 30 с: два разных админа отправляют одинаковый текст → `created_by` разный, dedupe не срабатывает, дубли; клиентский retry после таймаута в этом окне дублирует; при нескольких репликах без Redis job/reminder запускаются на всех (для рассылки спасает CAS, для reminder push — нет) |
| P-14 | **Low** | `Backend/jobs/pushBroadcastJob.js:7,11-31`; `Backend/models/PushBroadcast.js:84-99` | Детектор «зависших» рассылок: критерий `status='sending' AND created_at < now-10min`, хотя `created_at` — время создания, а не старта отправки; у модели нет `updated_at`/`started_at`; обнаружение только пишет warn («пропускаем») и не переводит в `failed`, не шлёт алерт | Запланированная на завтра рассылка создана сегодня: в момент длинной отправки (или зависания) её `created_at` уже старше 10 минут → каждую минуту ложное «зависла»; для действительно зависшей — бесконечный лог-спам и никакого восстановления |
| P-15 | **Low** | `Backend/services/pushBroadcastService.js:108-119`; `Backend/controllers/adminPushController.js:152-169` | Content-dedupe не учитывает набор получателей (только `target_mode`/`include_guests`) и `icon`: одинаковый текст двум разным группам пользователей в течение 10 минут блокируется 409; кросс-админский дубль ловится только idempotency-ключом (которого может не быть) | Админ A отправил «Отключение воды» всем; админ B через 5 минут хочет то же самое только трём пользователям — 409 «измените текст», хотя пересечения получателей нет |
| P-16 | **Low** | `Backend/controllers/pushController.js:15-55,57-74`; `Backend/models/PushSubscription.js:19-23,41-44` | Гонка `findOne → create` для нового endpoint: два параллельных subscribe дают unique violation и 500; `unsubscribe` удаляет только `endpoint AND user_id = req.user.id`, поэтому отсоединённые (`user_id=null`) строки не удаляются, а клиент считает, что отписался; на обновление существующей подписки возвращается 201 | Два таба/SW `pushsubscriptionchange` одновременно регистрируют новую подписку: один получает 500, клиент показывает ошибку; после отвязки подписки (гость) пользователь «отписывается», но сервер продолжает слать push на этот endpoint до 410 |
| P-17 | **Low** | Push-подписки пользователей никогда не чистятся проактивно: только 410/404 при фактической отправке или удаление аккаунта (`Backend/services/pushService.js:120-124`; `Backend/jobs/cleanExpiredTokens.js:114-116` — только гости по возрасту). У пользователя без растений/уведомлений мёртвые строки живут вечно | Долгоживущая БД: десятки тысяч мёртвых endpoint'ов (переустановки браузера), каждая рассылка тратит на них сетевые вызовы/таймауты; квоты push-провайдера расходуются впустую |
| P-18 | **Nit** | `Backend/services/pushBroadcastService.js:48,88-93`; `Backend/controllers/adminPushController.js:174`; `Backend/services/pushService.js:103-108`; `Backend/services/pushBroadcastService.js:157` | Мёртвый/латентный код и неточности: синхронная ветка `createBroadcast` (`deferDelivery:false`) недостижима из контроллера, но при использовании заблокирует HTTP на всю рассылку; `sendToFiltered` не используется; кастомный `Content-Type` в `sendToSubscriptions` молча перезаписывается web-push на `application/octet-stream`; `sent_at` ставится и для `failed`, и равен времени начала тика, а не фактической отправки | Будущий вызов `createBroadcast` без `deferDelivery` повесит запрос админа на N×10 с; при разборе инцидента `sent_at` у `failed`-рассылки вводит в заблуждение |
| P-19 | **Nit** | `Backend/controllers/adminPushController.js:34-40`; `Backend/services/pushService.js:140-144`; `Backend/index.js:201-217` | Конфиг VAPID проверяется в трёх местах по-разному (`process.env` в контроллерах, снимок `vapidConfigured` при импорте, presence-only в `validateProductionConfig`); `/health` и метрики не показывают состояние push; `getVapidPublicKey` не кэширует, но это мелочь | После «тихой» смены env в контейнере без рестарта поведение контроллера и сервиса расходится; ops не может из `/health` понять, что push выключен |

**Итого:** 1 Critical, 5 High, 7 Medium, 4 Low, 2 Nit (19 находок, часть Low/Nit — гигиена).

---

## 3. Детальный разбор

### P-01 (Critical). Рассылка не переживает прерывание: частичная отправка, вечный `sending`, нет resume/cancel

**Доказательства.**

* `sendBroadcast` читает рассылку и требует `status === 'sending'` (`pushBroadcastService.js:123-126`), затем **всё** множество подписок `PushSubscription.findAll({ where })` (`:142`), отправляет их одним вызовом (`:144-150`) и только после завершения делает **один** `UPDATE` (`:152-161`). Никакого промежуточного учёта нет.
* Единственная защита — CAS-захват `pending → sending` в job (`pushBroadcastJob.js:43-48`) и финальный `UPDATE`; если процесс умер между ними, строка навсегда остаётся `sending`.
* `logStaleSending` (`pushBroadcastJob.js:11-31`) находит такие строки по `status='sending' AND created_at < now-10min` и только пишет `console.warn("… зависла … пропускаем")` (`:22-27`); никакого перевода в `failed`, сброса в `pending`, алерта или админ-эндпоинта нет. `listPendingDue` выбирает только `pending` (`pushBroadcastService.js:180-192`), поэтому зависшая рассылка никогда не будет подхвачена.
* У `PushBroadcastRecipient` нет колонок статуса/попыток/ошибки/`sent_at` — только `id`, `broadcast_id`, `user_id`, `created_at` (`Backend/models/PushBroadcastRecipient.js:10-32`); для `target_mode='all'` эти строки вообще не создаются (`pushBroadcastService.js:77-85`). Значит, нет даже списка, кому уже отправили.
* У `PushBroadcast` отключён `updated_at` (`Backend/models/PushBroadcast.js:88`), нет `started_at`/`last_attempt_at` — по БД нельзя понять, идёт отправка или процесс умер.
* Завершение процесса: `shutdown` в `index.js:313-337` закрывает HTTP-сервер и делает `process.exit(0)` (`:332`), фоновые cron-задачи не останавливаются и не дожидаются; `forceExit` — 20 с (`:319-322`). В k8s `terminationGracePeriodSeconds: 30` (`Backend/k8s/40-backend.yaml:58`), rolling update с `maxSurge: 1` (`:48-49`) на время деплоя поднимает второй pod и убивает старый; в compose `restart: always` и нет `stop_grace_period` (default 10 с) (`Backend/docker-compose.yml:106-113`).
* Контраст с почтовой подсистемой, где проблема решена: `MailBroadcastRecipient` имеет `status/attempts/error/sent_at` (`Backend/models/MailBroadcastRecipient.js:30-54`), `sendBroadcast` идёт батчами, обновляя каждую строку (`Backend/services/mailBroadcastService.js:242-302`), job подхватывает незавершённые `sending` (`Backend/jobs/mailBroadcastJob.js:17-33`), а `failStaleSending` переводит реально зависшие в `failed` (`mailBroadcastService.js:408-436`). У push этого нет.

**Сценарий отказа.** Админ запускает рассылку на 20 000 подписок. Отправка последовательная, в среднем 150–300 мс на подписку → 50–100 минут (при 10-секундных таймаутах — до нескольких суток). На 40-й минуте deploy/restart. Через 10–30 с процесс убит. Отправлено ~8 000 push, но `push_broadcasts.status='sending'`, `sent_count=0`, `sent_at=NULL`. Cron каждую минуту пишет «рассылка #N зависла — пропускаем». Админ в UI видит «Отправляется», отменить нельзя (кнопка только для `pending`, `AdminPushPanel.jsx:700-710`, сервер `adminPushController.js:208-215`), перезапустить нельзя, узнать, кому доставлено, невозможно. 12 000 пользователей не получили уведомление, и никто об этом не знает.

**Уточнение по §4 (in-app):** здесь речь только о push; in-app при рассылке не создаётся вообще (см. «дополнительные наблюдения»).

**Рекомендация.** Сделать рассылку возобновляемой, по образцу mail-подсистемы:

1. Материализовать получателей **всегда**, а не только для `target_mode='users'`: либо по строке на подписку (`broadcast_id, subscription_id, status, attempts, error, sent_at, id` с уникальным `(broadcast_id, subscription_id)`), либо хотя бы чекпоинт `last_subscription_id` + счётчики.
2. Отправлять чанками (например, 100–500), после каждого чанка фиксировать статусы/счётчики. При падении job при старте/по тику подхватывает `status='sending'` с оставшимися `pending` (как `listUnfinishedSending`, `mailBroadcastService.js:400-406`) и продолжает с того же места.
3. Ввести `started_at`/`last_attempt_at`; stale-детект по ним, а не по `created_at`, с переводом в `failed` + причина + алерт.
4. Graceful shutdown: останавливать cron, дожидаться/прерывать текущий чанк с сохранением чекпоинта; в k8s — `preStop`/увеличенный grace, в compose — `stop_grace_period`.
5. Отмена `sending` через флаг `cancel_requested`, проверяемый между чанками.
6. API ручного retry для `failed`/`sending`: продолжение только по `pending`-получателям (не повторная отправка всем).

**Критерии приёмки:** `kill -9` в середине рассылки → рестарт → рассылка продолжается, итоговые `sent_count + failed_count == total`, повторной доставки уже отправленным нет; деплой в середине рассылки не оставляет вечный `sending`; в админке видны прогресс и причина остановки.

---

### P-02 (High). Гонка идемпотентности: дублирующая массовая отправка

**Доказательства.**

* Контроллер: `findIdempotentBroadcast('push', key)` (`adminPushController.js:137`), затем `createBroadcast` (`:171-175`), затем `rememberIdempotentBroadcast` (`:178`). Между проверкой и вставкой нет ни транзакции, ни блокировки.
* `findIdempotentBroadcast` — обычный `GET` (`broadcastIdempotency.js:25-28`); `rememberIdempotentBroadcast` — обычный `SET` без `NX` (`:46-53`), то есть «последний записавший выигрывает», и параллельный запрос может перезаписать ключ другим id.
* Возврат `rememberIdempotentBroadcast` не проверяется (`adminPushController.js:178`), хотя функция может вернуть `false` (`broadcastIdempotency.js:43,56-59`).
* В БД нет ни колонки/таблицы идемпотентных ключей, ни уникального индекса по контенту: миграция создаёт только `push_broadcasts` и `push_broadcast_recipients` (`migrations/20261010_create_push_broadcasts.sql:1-39`). Content-dedupe (`findRecentDuplicate`) — тоже `SELECT` до `INSERT` (`pushBroadcastService.js:96-120`), а не ограничение БД; при этом оно фильтрует по `created_by` (`:117`), т.е. не спасает от двух разных админов.
* `createBroadcast` создаёт рассылку со статусом `pending` в собственной транзакции (`pushBroadcastService.js:48,58-86`), после чего job отправит **обе** созданные строки.

**Сценарий отказа.** Админ дважды быстро нажимает «Отправить» (React-состояние `sending` выставляется асинхронно, кнопка не мгновенно `disabled`) или открыты две вкладки админки, или сетевой слой повторил POST. Оба запроса проходят проверки (в БД ещё нет ни ключа, ни строки), обе транзакции создают `pending`-рассылки. Cron в течение минуты захватывает и отправляет обе → каждый подписчик получает одинаковое push дважды. В почтовой подсистеме та же схема (`adminMailController.js:256-298`) — то есть дефект общий, но у push дубль заметнее (push нельзя «прочитать один раз»).

**Оговорка честности:** окно узкое (миллисекунды-десятки миллисекунд между `GET` и коммитом), а не-параллельные повторы обычно ловятся content-dedupe (10 мин) или ключом (24 ч при живом Redis). Но при `Redis` недоступном (P-13) и параллельных запросах защита не работает вовсе; для «всех пользователей» цена ошибки максимальна.

**Рекомендация.**

1. Критическую секцию идемпотентности делать атомарной: `SET key value NX PX ttl` **до** создания; если `NX` не прошёл — вернуть существующую рассылку. Ещё надёжнее — хранить ключ в БД: колонка `idempotency_key` + `UNIQUE(idempotency_key)` (или отдельная таблица `broadcast_idempotency(channel, key, payload_hash, broadcast_id)`), записываемая в той же транзакции, что и рассылка.
2. Проверять `payload_hash`: тот же ключ с другим payload — `409/422`, а не тихий возврат чужой рассылки.
3. Content-dedupe «за 10 минут» защитить на уровне БД: `pg_advisory_xact_lock(hashtext(title||body||…))` в начале транзакции либо уникальный частичный индекс по нормализованному хэшу с окном (например, `dedupe_bucket = floor(epoch/600)`).
4. Не игнорировать `false` от `rememberIdempotentBroadcast`: при неудаче — лог/алерт и, при критичности, откат/пометка.

**Критерии приёмки:** 50 параллельных одинаковых POST с одним Idempotency-Key → ровно одна рассылка, остальные — идемпотентный ответ с тем же id; после рестарта посреди создания — при повторе дубля нет.

---

### P-03 (High). Детерминированный Idempotency-Key + TTL 24 ч: «повтор после сбоя» и «запланировать то же» молча не работают

**Доказательства.**

* Клиент формирует ключ из `JSON.stringify({title, body, url, targetMode, selectedIds, includeGuests})` и FNV-1a хэша (`Frontend/src/component/adminPush/AdminPushPanel.jsx:267-280`). В ключ **не входят** `scheduledFor`, администратор и случайный nonce; ключ одинаков для всех одинаковых текстов.
* Сервер хранит ключ 24 часа (`broadcastIdempotency.js:4`) и на попадание возвращает `200 { broadcast: existing, recipientsCount, sentResult: null, queued: true, deduplicated: true }` (`adminPushController.js:136-149`) **независимо от статуса** существующей рассылки (может быть `sent`, `failed`, `canceled`, `sending`).
* UI: при `scheduledIso` сообщение «Рассылка запланирована на …» выводится **раньше** проверки `data.deduplicated` (`AdminPushPanel.jsx:309-316`), т.е. на дедуплицированный ответ клиент пишет «запланирована», хотя никакой новой рассылки нет.
* Probe `state/notif-audit/scratch/idempotency-key.probe.mjs` подтверждает: ключ для «немедленно» и «завтра» равен (`push-57fe434d-158`), у двух админов равен; отличается только при другом наборе получателей.

**Сценарий отказа.** (а) Пуш-провайдер/сеть лежали, рассылка «Сервис будет недоступен с 22:00» получила статус `failed`, `sent_count=0`. Админ исправляет инфраструктуру и повторяет тот же текст: сервер в течение суток отвечает 200 `deduplicated`, отправки **не происходит**, статус остаётся `failed`. UI при этом пишет «Такая рассылка уже была создана ранее — повторно уведомления не отправляются» — оператор может решить, что это ожидаемо. (б) Админ отправляет текст сейчас, затем планирует тот же текст на завтра (например, напоминание об отключении воды) — ключ тот же (scheduledFor не входит), сервер возвращает вчерашнюю/сегодняшнюю рассылку, UI рапортует «запланирована». Ничего не запланировано. (в) Сотрудник хочет осознанно повторить анонс через сутки — придётся менять текст.

**Рекомендация.**

1. Клиент должен генерировать **случайный** ключ на каждое намерение отправки (`crypto.randomUUID()` в момент submit) и переиспользовать его только для автоматических retry того же запроса; хранить в состоянии формы.
2. Сервер должен различать «retry того же запроса» и «новая отправка»: добавить `payload_hash`/`created_at` в проверку, вернуть `200` с фактическим статусом существующей рассылки и явным `existingStatus`, а для `failed/canceled` — не притворяться успехом (например, `409` с кодом `BROADCAST_FAILED` и предложением retry на новых получателях).
3. UI: показывать для `deduplicated` реальный статус и время существующей рассылки; для `scheduledFor` не писать «запланирована», если `deduplicated`.
4. Для осознанного повтора — отдельное действие «Отправить ещё раз» (новый ключ + явное подтверждение), с предупреждением о дублях для уже доставленных.

**Критерии приёмки:** сетевой retry того же submit не создаёт дубль; осознанная повторная отправка того же текста через 11 минут/сутки создаёт новую рассылку; повторная после `failed` отправляется; запланированная копия текста реально планируется.

---

### P-04 (High). Политика ошибок доставки: нет retry для временных сбоев и вечное хранение большинства «мёртвых» подписок

**Доказательства (`Backend/services/pushService.js:92-126`).**

* Отправка в `try/catch` на каждую подписку: любая ошибка инкрементит `failed`, пишет `console.error(error.message)`, добавляет в `errors` (до 20) — и всё (`:113-118`).
* Удаление подписки — **только** `statusCode === 410 || statusCode === 404` (`:120-124`). 400 (некорректные ключи/endpoint), 401/403 (несовпадение VAPID, отозванный ключ), 413 (payload слишком большой), 429 (rate limit), 500/502/503/504 и socket timeout **не удаляются и не помечаются**.
* Нет ни одного retry/backoff: ни для 429 (где провайдер отдаёт `Retry-After`), ни для 5xx, ни для timeout. Для одноразовых уведомлений (care advice, auto-skip, day-before/on-day после первого успеха, morning summary вне окна) это означает безвозвратную потерю конкретного push.
* Probe `state/notif-audit/scratch/pushService.probe.test.mjs` (тест 1-2) эмпирически подтверждает: из 8 подписок с кодами 410/400/401/403/413/429/500/ok удаляется ровно одна (410), остальные 6 «мёртвых» остаются и повторяются при каждом следующем вызове; один и тот же 400-endpoint вызывается снова при каждом `sendToSubscriptions`.
* `SEND_TIMEOUT_MS = 10_000` (`:7`) передан в web-push (`:104`); по истечении web-push уничтожает сокет с `Error('Socket timeout')` без `statusCode` (см. `Backend/node_modules/web-push/src/web-push-lib.js:395-399`) — такие подписки тоже навсегда остаются в БД.

**Сценарии отказа.**

* FCM отдал 500/503 на тик напоминаний — push потерян, повтора нет (для day-before/on-day частично спасает повторный тик, но у care advice ретрая нет вообще — P-10).
* Сменили/перепутали VAPID-ключи: все отправки получают 401/403, ни одна подписка не удаляется. Каждая рассылка — N неудачных TLS-запросов, статус `failed`, причина в логах в виде «Received unexpected response code» без кода и endpoint (P-06). Мёртвое состояние не лечится само.
* Один endpoint завис (сеть до провайдера) — каждое уведомление пользователю тратит 10 секунд (P-05).

**Рекомендация.**

1. Классифицировать коды:
   * `404/410` → удалять подписку (сейчас корректно) и инкрементить `removed_count`.
   * `400/413` → подписка/пейлоад несовместимы: после подтверждения причины помечать подписку невалидной (карантин) и не пытаться слать; для 413 сначала починить валидацию payload (P-12).
   * `401/403` → не удалять слепо (может быть общая ошибка конфигурации): считать серию, при N подряд — карантин подписки + **алерт** «VAPID/авторизация push массово отклоняется».
   * `429/500/502/503/504/timeout` → retry с экспоненциальным backoff и jitter (уважать `Retry-After`), ограниченное число попыток; для рассылки — отложенная повторная попытка по неотправленным получателям (после P-01).
2. Добавить в `push_subscriptions` поля `last_error_code`, `failed_streak`, `last_failure_at`, `disabled_until` (или отдельную таблицу) и использовать их в `sendToSubscriptions`.
3. Писать в лог структурированно: `broadcastId`, `subscriptionId`, `statusCode`, хэш endpoint.
4. Не прекращать батч из-за ошибки удаления подписки (P-07).

**Критерии приёмки:** смоделированные 500/429 → есть повтор с backoff; 410 → удаление; массовые 401 → алерт в течение минуты; один «плохой» endpoint не влияет на остальных; после смены ключей база не остаётся в вечном `failed` без диагностики.

---

### P-05 (High). Производительность и память: последовательные отправки без чанков/конкурентности и `findAll()` без лимита

**Доказательства.**

* `sendToSubscriptions`: `for (const sub of subscriptions)` с `await` внутри (`pushService.js:92-109`), т.е. строго по одной; таймаут каждой — 10 с (`:7`); никакой конкурентности, батчей, бюджета времени.
* `sendToAll`/`sendToFiltered`/`sendToUser`/`sendBroadcast` грузят все строки одним `findAll()` без `limit`/`offset`/`attributes` (`pushService.js:38-40,52,65-67`; `pushBroadcastService.js:142`). Объекты Sequelize тяжелее строк: при десятках тысяч подписок это заметная память, плюс `endpoint` до 2048 символов (`pushSubscription.js:19-23`, валидация `pushValidation.js:24`).
* Лимит памяти backend-pod — 512 MiB (`Backend/k8s/40-backend.yaml:108-112`), запрос 256 MiB (`:108-109`); OOM-kill всего процесса, а не только рассылки.
* Рассылки в одном cron-проходе обрабатываются последовательно (`pushBroadcastJob.js:41-56`), напоминания — тоже последовательно по растениям/пользователям (`reminderService.js:260-272`); один медленный набор подписок блокирует и рассылки, и reminder-тик (лок продлевается, поэтому второй инстанс не подхватит).

**Оценка порядка величин.** 10 000 подписок при 200 мс на запрос — ~33 минуты; при 5% зависаний по 10 с — +83 минуты. 100 000 подписок — 5,5–11 часов даже без сбоев. Один админ-запрос `/api/push/send-all` (legacy, P-11) делает это синхронно в HTTP-обработчике и гарантированно получит 504 на прокси, продолжив отправку в фоне без аудита.

**Рекомендация.**

1. Пагинация по `id` ключом (`id > lastId ORDER BY id LIMIT batchSize`) и/или чанки 100–500; отправка только нужных колонок через `attributes` + `raw: true`, чтобы не держать Sequelize-инстансы.
2. Ограниченная конкурентность (пул 5–20) с учётом лимитов push-провайдеров; таймаут общий на батч, а не только на подписку.
3. Прогресс/чекпоинты в БД после каждого батча (P-01) и разделение очередей: рассылки и reminder-отправки не должны блокировать друг друга (например, отдельный worker/лок и ограничение времени тика).
4. Конфигурируемые `PUSH_BATCH_SIZE`, `PUSH_CONCURRENCY`, `PUSH_RUN_BUDGET_MS`; метрика RSS/длительности.

**Критерии приёмки:** нагрузочный тест на 100k подписок: RSS процесса < 200 MiB, прогресс каждые N секунд, другие рассылки и reminder-тик не голодают; `/send-all` либо удалён, либо асинхронный.

---

### P-06 (High). Наблюдаемость: нельзя ответить «кто не получил и почему»

**Доказательства.**

* Агрегаты есть: `sent/failed/removed` (`pushService.js:128-137`), они пишутся в `push_broadcasts` (`pushBroadcastService.js:152-161`). Но **кто** получил/не получил — не сохраняется нигде; `PushBroadcastRecipient` статуса не имеет (P-01).
* Лог ошибки — только `error.message` без endpoint, subscriptionId, statusCode (`pushService.js:115`); успех логирует обрезанный endpoint (`:112`), ошибка — нет.
* `errors` (до 20 пар endpoint/error, `:116-118,136`) возвращается из `sendToSubscriptions`; `sendBroadcast` использует результат только для счётчиков (`pushBroadcastService.js:152-159`), массив выбрасывается; job логирует только количество (`pushBroadcastJob.js:87-92`).
* Нет метрик/health/алертов: `/health` возвращает `redis/mail/backgroundJobs/aiCache`, но не push (`index.js:201-217`); нет счётчиков по классам ошибок, нет алерта «рассылка failed» или «failed_count > 0».
* UI показывает только 5 последних рассылок (`adminPushController.js:73-77`, `OVERVIEW_ATTRIBUTES:21-32`) и только `sent_count/failed_count` (`AdminPushPanel.jsx:694-698`); причина и список пострадавших недоступны. При `sent_count=800, failed_count=200` статус = `sent` (`pushBroadcastService.js:158`), метка «Отправлена» — оператор не поймёт, что 200 человек не получили.
* `logStaleSending` сигнализирует о зависших только строкой в логе, раз в минуту, без перевода в `failed`/алерта (`pushBroadcastJob.js:22-27`).

**Сценарий отказа.** Ночная запланированная рассылка «Завтра отключение воды» упала целиком (VAPID/провайдер). Утром: в БД `status=failed` у 6-й с конца рассылки, в UI её не видно, алерта нет, в логах 2000 строк «❌ Ошибка push: Received unexpected response code» без единого endpoint. Ops не может ни диагностировать причину, ни оценить масштаб, ни найти пользователей, которых надо догнать другим каналом.

**Рекомендация.**

1. Per-recipient записи статуса (P-01) — основной источник правды; админ-API: список неудачных получателей, группировка по `statusCode`.
2. Структурированные логи (JSON) с `broadcastId`, `subscriptionId`, `statusCode`, `endpointHash`, `durationMs`; не обрезать ошибки до 20 без сохранения.
3. Метрики/алерты: `push_send_total{status,code}`, длительность батча, `broadcasts_failed_total`, `stale_sending`; алерт при `failed_count > 0`, `status=failed`, зависании > 10 мин.
4. Показывать в `/health` и админке состояние push-конфига/последней ошибки; в списке рассылок — `failed_count/removed_count` и ссылку на детали; статус «Отправлена частично» вместо `sent` при `failed_count>0` (или `partial`).
5. Ротация/ограничение лога: одна строка на ошибку с endpoint-хэшем, не только `message`.

**Критерии приёмки:** по любой рассылке за 5 минут можно получить список неудачных подписок и распределение кодов; алерт срабатывает при полном провале запланированной рассылки; ops видит зависшие рассылки без чтения логов.

---

### P-07 (Medium). Частичный сбой превращается в `failed`/`sending` и открывает путь к дублям

**Доказательства.**

* Если после частичной отправки `sendToSubscriptions` бросает исключение, `sendBroadcast` не доходит до `PushBroadcast.update` (`pushBroadcastService.js:144-161`), а job в `catch` ставит `status='failed'` (`pushBroadcastJob.js:57-69`).
* Исключение может возникнуть не только при тотальном сбое БД: `sub.destroy()` внутри `catch` не обёрнут в свой `try` (`pushService.js:120-125`). Probe-тест 3 подтверждает: ошибка удаления одной мёртвой подписки обрывает весь батч — следующие подписки не обрабатываются, результат не возвращается.
* `status='failed'` при этом означает «ничего не доставлено» для content-dedupe (он исключает `failed`, `pushBroadcastService.js:15`), поэтому повторная отправка разрешена; но фактически часть push уже доставлена (счётчики не сохранены) → повтор даёт дубли.
* Если падает только финальный `UPDATE` (БД коротко недоступна после успешной отправки), job тоже ставит `failed`, а если и это не удалось — остаётся `sending` (P-01).

**Рекомендация.** Обернуть удаление подписки в отдельный `try/catch` (ошибку БД логировать, продолжать батч); сохранять счётчики инкрементально (P-01) и в `finally`; никогда не писать `failed`, если `sent > 0` (ввести `partial` или оставлять `sent` с `failed_count`); не разрешать автоматический/полуручной повтор по `failed`, пока нет данных о доставленных получателях.

---

### P-08 (Medium). VAPID: несогласованное поведение, 401-шторм и падение всего backend при невалидном ключе

**Доказательства.**

* `vapidConfigured` вычисляется один раз при импорте модуля (`pushService.js:10-14`), там же `webpush.setVapidDetails(...)` (`:16-22`) — **вне** `try`. `web-push` валидирует subject/ключи и бросает исключение (`node_modules/web-push/src/web-push-lib.js:53-67`): при невалидном ключе падает импорт `pushService`, а значит не стартует весь `index.js`; сообщение — из библиотеки, без контекста «VAPID настроен неверно».
* `ensureConfigured()` вызывается только в `sendToUser`/`sendToAll`/`sendToFiltered` (`:37,51,64`), но **не** в `sendToSubscriptions`; `sendBroadcast` вызывает именно `sendToSubscriptions` (`pushBroadcastService.js:144`). Без VAPID `webpush.sendNotification` не падает, а отправляет запрос без `Authorization` (см. ветвление `currentVapidDetails` в `web-push-lib.js:273-298`), провайдер отвечает 401/403 → все подписки учитываются как `failed`, но остаются в БД.
* Контроллер рассылки запрещает создание без VAPID только для немедленной отправки; при `scheduledFor` создание разрешено (`adminPushController.js:129-131`). UI при этом вообще блокирует submit, если `pushConfigured` false (`AdminPushPanel.jsx:399-404,671`), т.е. API и UI противоречат друг другу.
* `validateProductionConfig` требует только **наличие** переменных (`index.js:96-111`), не валидность; `/health` про push не сообщает (`index.js:201-217`).
* Reminder-пути при отсутствии VAPID ловят throw и пишут ошибку (`reminderService.js:251-253,342-347,465-470`), но флаги «уведомлён»/`last_*` не двигаются (P-10) → лишние повторные тики.

**Рекомендация.** Вынести конфигурацию в один модуль с мемоизированной валидацией и понятной ошибкой (`push disabled: VAPID_* missing/invalid`), не бросать на этапе импорта (оборачивать `setVapidDetails` в try, экспортировать `lastConfigError`); `sendBroadcast` должен проверять конфиг и помечать рассылку `failed/skipped` с причиной **без** обхода всех подписок; разрешить/запретить `scheduledFor` без VAPID единообразно; в `/health` отдавать `push: {configured, valid, lastError}`; в production-валидации проверять декодируемость ключей, а не только наличие.

---

### P-09 (Medium). Жизненный цикл подписок: logout, смена аккаунта, гости, retention

**Доказательства.**

* `logout` (`Backend/controllers/userController.js:357-370`) отзывает auth-токены и чистит cookie, но не трогает `push_subscriptions`; фронтенд на выходе тоже не вызывает unsubscribe (`Frontend/src/component/profile/profile.jsx:369-387`). Подписка остаётся привязанной к пользователю: после выхода устройство продолжает получать его напоминания/советы (и админ-рассылки).
* На общем устройстве при входе другого аккаунта `subscribe` возвращает 409, если endpoint уже привязан к другому `user_id` (`pushController.js:28-30`); `reattachPush` после логина ловит ошибку и только пишет `console.warn` (`registration.jsx:110-121`), пользователь ничего не узнаёт и push не получает.
* Если запрос `subscribe` приходит без авторизации, а endpoint принадлежит пользователю, выполняется `existing.update({ user_id: null })` (`pushController.js:31-36`) — подписка пользователя молча отвязывается (доступность endpoint'а = знание capability-URL, но, например, SW/гостевой сценарий это делает без злого умысла).
* `unsubscribe` требует `requireAuth` (`pushRoutes.js:21`) и удаляет только `endpoint AND user_id = req.user.id` (`pushController.js:63-68`): гость не может удалить свою серверную подписку; после отвязки строка `user_id=null` не удаляется, и сервер продолжает слать на неё гостевые/админские push до 410.
* Гостевая чистка: `PushSubscription.destroy({ where: { user_id: null, created_at < guestDataCutoff } })` (`cleanExpiredTokens.js:114-116`) — по `created_at`, а не по активности/`updated_at`; подписка, созданная 181 день назад, удаляется даже если ею пользуются ежедневно.

**Рекомендация.** На logout вызывать отвязку/удаление текущей подписки (клиент: `unsubscribeFromPush()` перед `/users/logout`, либо серверный endpoint по `endpoint`); для смены аккаунта — явный сценарий «переназначить подписку» (например, 409 с кодом и кнопкой, сервер разрешает переназначение после подтверждения), не оставлять `console.warn`; гостевое отписывание — по endpoint без auth, но с rate-limit (или с guest-token); retention гостевых подписок — по `updated_at`/последней активности, а не по `created_at`.

---

### P-10 (Medium). Связка «успех push ↔ бухгалтерия уведомлений»: лишние повторы и потерянные push

**Доказательства.**

* `sendDayBefore`: `if (result.sent > 0) await this.markNotified(...)` (`reminderService.js:421-423`); `sendOnDay` — аналогично (`:462-464`); `sendMorningSummaryTo` — `last_morning_summary_date` только при `sent>0` (`:339-341`). У пользователя без push-подписок `sendToUser` возвращает `success:false, sent:0` (`pushService.js:42-45`), поэтому «уведомлён» не ставится: `sendDayBefore` (окно 09:00–21:00, `:29-30,410`) повторяет работу каждые 10 минут — до 72 итераций на растение в день (findOrCreate по dedupe-ключу + find всех подписок + `console.log "Нет подписок"`). Дубликата in-app не будет (уникальный `(user_id, dedupe_key)`, `notificationService.js:21-39`), но это лишняя нагрузка/лог-шум.
* `sendOnDay` окно уже (20 мин), поэтому там повторность ограничена, но флаг «уведомлён» опять зависит от push.
* Care advice: `if (!created) continue` (`careAdviceService.js:201`) стоит **до** push (`:203-221`) — если push не удался после создания строки уведомления (транзиентный сбой, VAPID), при следующем запуске push не будет предпринят вообще; `last_care_advice_date` ставится в конце всегда (`:226`), т.е. в тот же день повтора не будет.
* Ошибка `plant.update`/`preference.update` после успешной отправки приведёт к повторному push на следующем тике (дубль, для SW mitigated тегом/renotify).

**Важно:** in-app уведомление **не теряется** — `storeNotification` вызывается до push (`reminderService.js:499-510`; `careAdviceService.js:170-215`), а ошибка push перехватывается снаружи. Этот инвариант соблюдён (см. §4).

**Рекомендация.** Разделить учёт: «уведомление создано/показано в in-app» фиксировать сразу по `created=true` (независимо от push), а результат push хранить отдельно (таблица попыток/outbox) и ретраить по политике P-04; для care advice не гейтить push на `created` (или добавить `push_sent`-поле/попытки); для morning summary/day-before ввести отдельный флаг «in-app доставлено» + ограничение повторов (attempts/cooldown), чтобы не крутить findAll каждые 10 минут.

*(Пересекается с задачей task-1 — там это отдельно в контексте планировщика; здесь фиксируется push-сторона.)*

---

### P-11 (Medium). Нет ограничений на админ-рассылку; legacy /send и /send-all живы и обходят аудит

**Доказательства.**

* `adminPushRoutes.js:7-12`: только `requireAdmin`, ни rate-limit, ни квоты на создание рассылки; `express-rate-limit` навешен только на `/api/push/subscribe` (`pushRoutes.js:10-17`).
* `pushRoutes.js:23-25`: `POST /api/push/send` и `/send-all` доступны админу и вызывают `pushService.sendToUser/sendToAll` напрямую (`pushController.js:76-104`). Это синхронная отправка: HTTP-запрос ждёт всю рассылку (N×до 10 с), нет записи в `push_broadcasts`, нет idempotency/dedupe, нет сохранения счётчиков, нет ограничений на `title/body/icon/data` (только truthy-проверки) — тело до 100 КБ (`index.js:161`).
* Фронтенд эти эндпоинты не использует (`AdminPushPanel.jsx` ходит только в `/admin/push`), но API жив.

**Рекомендация.** Навесить отдельный строгий rate-limit на создание рассылок (например, 10/мин на админа + глобальный), опционально — подтверждение для `targetMode='all'`; legacy `/send`/`/send-all` либо удалить, либо переписать на `pushBroadcastService.createBroadcast` (аудит, идемпотентность, счётчики, валидация), либо хотя бы добавить лимиты и запись результата; для `/send-all` — обязательный async-режим.

---

### P-12 (Medium). Суммарный размер payload не валидируется против лимита Web Push 4096 байт

**Доказательства.**

* Валидация ограничивает поля по отдельности: title ≤ 120 **символов**, body ≤ 1000 **символов**, url/icon ≤ 2048 символов (`pushBroadcastValidation.js:1-7,29-77`). Payload собирается как JSON (`pushService.js:79-85`) и шифруется web-push; лимит полезной нагрузки Web Push — 4096 байт на шифротекст (включая overhead шифрования ~86+ байт; для FCM/Apple/Mozilla одинаково).
* 1000 символов кириллицы = ~2000 байт, 120 кириллических = ~240 байт; плюс url до 2048 ASCII и icon — итог легко > 4096. Legacy-эндпоинты (`pushController.js:76-104`) не ограничивают вообще ничего.
* Ошибка проявится как `statusCode=413` на каждой подписке, `failed_count = N`, `status='failed'` (`pushService.js:113-126`; `pushBroadcastService.js:152-159`), подписки не удаляются, причина в логе без кода (P-06).

**Рекомендация.** В `validateBroadcastInput` после сборки объекта считать `Buffer.byteLength(JSON.stringify(payload), 'utf8')` (с учётом `icon`, `badge`, `data`) и отклонять > ~3500 байт (запас на шифрование/JSON-ключи) с понятным сообщением; либо обрезать body по байтам; в UI показывать счётчик в байтах. Для legacy-эндпоинтов — те же лимиты. Обновить тексты ошибок: 413 = «слишком длинное уведомление», а не «ошибка push».

---

### P-13 (Medium). Недоступный Redis: идемпотентность молча выключается, локи деградируют

**Доказательства.**

* `findIdempotentBroadcast` при `getRedisClient() === null` возвращает `null` (`broadcastIdempotency.js:21-23`); `rememberIdempotentBroadcast` — `false` (`:42-43`). `getRedisClient` возвращает `null`, если Redis не сконфигурирован, открыт breaker или соединение не поднялось (`redis.js:122-157`, breaker `:77-95`). Контроллер это не различает и не сообщает клиенту (`adminPushController.js:137-150,178`).
* Fallback — content-dedupe (`pushBroadcastService.js:96-120`), но он ограничен 10 минутами (`:14-20`) и фильтром `created_by` (`:117`); два разных админа с одинаковым текстом пройдут. Параллельные запросы не ловятся вовсе (P-02).
* `acquireLock` при отсутствии Redis возвращает `{ acquired: true, degraded: true }` (`distributedLock.js:59-61`), при ошибке — тоже `acquired:true` с warn (`:76-82`), т.е. каждый инстанс выполняет job. Для рассылки спасает CAS `pending→sending`; для reminder-цикла — нет (дубли push возможны при нескольких репликах; in-app защищён unique-индексом).
* В логах старта есть только общая строка «Redis не задан — … отключены» (`redis.js:216-221`), в `/health` — `redis: disabled/unavailable` (`index.js:208`), но про идемпотентность/локи явного сигнала нет.

**Рекомендация.** Для критичных операций (создание рассылки) не полагаться только на Redis: ключ идемпотентности в БД с уникальным индексом (P-02) как источник истины; при недоступности Redis — логировать `warn` с указанием, что защита от дублей ослаблена, и/или возвращать клиенту заголовок/флаг; метрика `idempotency_store_unavailable`; для reminder-путей — учитывать `lock.degraded` и не выполнять push-рассылку, если несколько реплик (например, `SELECT pg_try_advisory_lock` как второй слой).

---

### P-14 (Low). Stale-детектор рассылок: неправильная метрика, log-only, без восстановления

**Доказательства.** `logStaleSending` использует `created_at` (`pushBroadcastJob.js:14-20`), а не время старта отправки; у `PushBroadcast` нет `updated_at`/`started_at` (`PushBroadcast.js:84-99`). Для запланированной рассылки, созданной заранее, `created_at` заведомо старше 10 минут, поэтому при длинной отправке (P-05) она тут же попадает в «зависла» и логируется **каждую минуту** (`pushBroadcastJob.js:22-27,36`), пока идёт отправка. Реально зависшая рассылка не переводится в `failed`, не эскалируется и не восстанавливается.

**Рекомендация.** Добавить `started_at`/`last_attempt_at`; stale-порог считать от них; при превышении — `failed` с причиной + алерт (или автоматический resume по P-01); логировать переход один раз (rate-limit/дедупликация лога).

---

### P-15 (Low). Content-dedupe не учитывает получателей и иконку

**Доказательства.** `findRecentDuplicate` сравнивает `title, body, url, target_mode, include_guests` и (если есть) `created_by` (`pushBroadcastService.js:108-118`); `userIds` для `target_mode='users'` и `icon` не входят в условие. Итог: одинаковый текст двум **разным** наборам пользователей в пределах 10 минут блокируется 409 «измените текст» (`adminPushController.js:152-169`), хотя пересечения нет; а одинаковый текст от разных админов в пределах 10 минут **не** блокируется, если отсутствует ключ идемпотентности (Redis недоступен, P-13).

**Рекомендация.** Включить в dedupe отпечаток набора получателей (`userIds` после сортировки или хэш) и `icon`; для кросс-админской защиты — глобальный content-dedupe без `created_by` внутри окна (или только алерт), плюс атомарность (P-02).

---

### P-16 (Low). Гонка subscribe и неполная отписка

**Доказательства.** `findOne` → `create` без обработки unique violation (`pushController.js:23-45`; уникальный индекс `PushSubscription.js:22-23,41-44`): параллельные запросы на один новый endpoint дают 500 «Ошибка сервера». `unsubscribe` фильтрует по `user_id = req.user.id` (`pushController.js:63-68`), поэтому строки с `user_id=null` (гостевые/отвязанные) не удаляются, клиент считает отписку успешной и делает `subscription.unsubscribe()` (`Frontend/src/utils/pushNotifications.js:103-125`) — сервер продолжает слать на «мёртвый» endpoint до 410. Обновление существующей подписки отвечает 201 (`pushController.js:47-50`) — семантически `200` было бы точнее.

**Рекомендация.** `PushSubscription.upsert`/обработка `UniqueConstraintError` с повторным `findOne`; отписка по `endpoint` (с проверкой владения для авторизованных, для гостевых — по endpoint/guest-token); вернуть 200 для update; при 409 на subscribe — отдавать понятный код/сообщение клиенту.

---

### P-17 (Low). Нет проактивной чистки мёртвых подписок пользователей

**Доказательства.** Удаление только при получении 404/410 в момент реальной отправки (`pushService.js:120-124`) или CASCADE при удалении пользователя (`PushSubscription.js:10-18`); cleanExpiredTokens чистит только гостевые по возрасту (`cleanExpiredTokens.js:114-116`). У пользователя без растений и без админ-рассылок мёртвые строки не удаляются никогда.

**Рекомендация.** Периодическая чистка по `last_error_code`/`last_failure_at` (P-04) и/или опрос push-провайдеров невозможен; ограничиться карантином и удалением после N дней в карантине; метрика количества «здоровых/карантинных» подписок.

---

### P-18 (Nit). Мёртвый/латентный код и неточности

* `createBroadcast` с `deferDelivery: false` для немедленной рассылки вызывает `sendBroadcast` прямо в HTTP-запросе (`pushBroadcastService.js:48,88-93`); контроллер всегда передаёт `deferDelivery: true` (`adminPushController.js:171-175`), т.е. ветка недостижима, но при будущем использовании заблокирует запрос на всю рассылку и не даст сохранить счётчики при обрыве.
* `sendToFiltered` (`pushService.js:63-76`) не используется нигде.
* `headers: { 'Content-Type': 'application/json; charset=utf-8' }` в `sendToSubscriptions` (`pushService.js:103-108`) бесполезен: web-push после применения extra-headers принудительно ставит `Content-Type: application/octet-stream` (`node_modules/web-push/src/web-push-lib.js:231-247`).
* `sent_at` пишется и при `status='failed'`, и берётся из `now`, зафиксированного в начале тика (`pushBroadcastService.js:157`; `pushBroadcastJob.js:50`), а не из фактического времени завершения; поле по смыслу «время попытки», а не отправки.
* `validateBroadcastInput` вызывается дважды с разными `now` (контроллер `:124`, сервис `:38`) — для `scheduledFor` у нижней границы (30 с) возможен редкий 400 на втором проходе; лучше валидировать один раз и передавать уже нормализованное значение.

---

## 3.1. Дополнительные наблюдения (не включены в рейтинг)

* **У админ-рассылок нет in-app канала и учёта прочтения.** `push_broadcast*` пишет только push; `Notification`-строки не создаются (в `pushBroadcastService.js` нет обращений к `Notification`). Пользователи с выключенным push (а также все, у кого push не поддерживается — например, iOS без установленного PWA) не увидят рассылку нигде, и посчитать реальный охват нельзя. Если рассылка задумана как «уведомление», для `target_mode='users'/'all'` без гостей имеет смысл дублировать её в in-app (с отдельным dedupe-ключом), а для гостевых подписок оставить только push.
* **`total_subscriptions` фиксируется при создании**, а фактический набор перечитывается в момент отправки (`pushBroadcastService.js:59-62` против `:142`): новые подписки получат рассылку, отписавшиеся — нет; итоговые счётчики после отправки корректнее исходных, но в UI до отправки может показываться устаревшее число.
* **API админки не отдаёт детали рассылки** (только overview: 5 последних и агрегаты, `adminPushController.js:64-89`): после того как рассылка уехала из top-5, её судьба недоступна.
* **`getVapidPublicKey` не кэшируется** и каждый вызов читает env — мелочь, но лишний источник расхождения с `vapidConfigured` (P-19).

---

## 4. Что корректно / сделано хорошо

Ниже — проверенные инварианты, которые **не** являются находками:

1. **In-app уведомление не теряется при ошибке push.** Во всех reminder-путях `storeNotification` выполняется до `pushService.sendToUser`, ошибки push перехватываются выше (`reminderService.js:497-522`; `careAdviceService.js:170-221`). Более того, in-app строка защищена уникальным индексом `(user_id, dedupe_key)` (`Backend/models/Notification.js:81-85`; `Backend/migrations/20261006_create_notifications.sql:18-19`; `notificationService.js:21-39`), поэтому повторные тики не плодят дубликаты in-app.
2. **Атомарный захват рассылки.** Переход `pending → sending` выполнен условным `UPDATE ... WHERE id=? AND status='pending'`, и job проверяет, что обновлена ровно одна строка (`pushBroadcastJob.js:43-48`). Это защищает от двойной отправки при конкурентных воркерах/инстансах — при условии, что рассылка не застряла в `sending` (P-01).
3. **Распределённый лок реализован аккуратно.** `SET NX PX` с токеном, release через Lua-сравнение токена, продление TTL, пока задача выполняется (`Backend/utils/distributedLock.js:4-16,34-53,55-83`); TTL рассылки 2 мин с продлением каждые 40 с (`pushBroadcastJob.js:9,76-82`). При недоступном Redis деградация явно логируется (но см. P-13).
4. **410/404 корректно удаляют мёртвую подписку** (`pushService.js:120-124`), подтверждено probe-тестом: `removed=1` для 410, `destroy()` не вызывается для 400/401/403/413/429/500.
5. **Валидация подписки.** Endpoint проверяется по `https`, порту 443, отсутствию credentials, allowlist push-провайдеров (`fcm.googleapis.com`, `web.push.apple.com`, `push.services.mozilla.com/org`, `notify.windows.com`), а `p256dh`/`auth` — по декодированной длине 65/16 байт (`Backend/utils/pushValidation.js:1-44`). Это резко снижает SSRF/abuse-поверхность.
6. **Валидация админ-рассылки** продумана: длины title/body/url/icon, запрет внешних/`//`/control-char URL, `targetMode`/`includeGuests`/`userIds` с дедупликацией и лимитом 1000, окно планирования 30 с … 365 дней (`Backend/utils/pushBroadcastValidation.js:1-200`); `isValidBroadcastId` защищает `:id` (`:197-200`); `escapeLikePattern` — поиск получателей (`pushBroadcastService.js:22-24`).
7. **Планирование переживает рестарт.** Запланированная рассылка хранится как `pending` с `scheduled_for` и подхватывается после перезапуска (`pushBroadcastService.js:180-192`), отмена возможна только для `pending` с проверкой статуса и на сервере, и в UI (`pushBroadcastService.js:172-178`; `adminPushController.js:196-222`; `AdminPushPanel.jsx:700-710`).
8. **Создание рассылки в транзакции** (рассылка + получатели для `users`) с подсчётом подписок (`pushBroadcastService.js:58-86`) — нет рассылки без получателей при успехе транзакции; `PushBroadcastRecipient` защищён уникальным `(broadcast_id, user_id)` (`migrations/20261010:36-37`).
9. **Rate-limit подписок** 20/15 мин и fail-open Redis-store (`passOnStoreError: true`), `trust proxy` настроен (`pushRoutes.js:10-17`; `utils/rateLimitStore.js:13-16`; `index.js:141`) — ошибка Redis не делает subscribe недоступным.
10. **CSRF/origin-защита** распространяется на POST `/api/push/*` и `/api/admin/push/*` (`index.js:163-175`), `requireAdmin` на всех админ-маршрутах (`adminPushRoutes.js:7`), гостевая подписка возможна только через `optionalAuth` (`pushRoutes.js:20`).
11. **10-секундный таймаут на одну отправку** не даёт зависнуть навсегда на одном endpoint (хотя умножается на N — P-05).
12. **Дубли защищены на нескольких уровнях в штатном последовательном сценарии:** content-dedupe 10 мин, Idempotency-Key 24 ч (при живом Redis), unique dedupe in-app, атомарный CAS; фронтенд блокирует кнопку на время запроса (`AdminPushPanel.jsx:671`) и обрабатывает сетевую ошибку предупреждением «не отправляйте повторно» (`:345-357`). Проблемы — в гонках, сбоях и семантике 24-часового ключа (P-02, P-03).
13. **`webpushError.statusCode`/`endpoint` доступны** — инфраструктура для правильной классификации ошибок есть, её нужно только использовать (P-04/P-06).

---

## 5. Тестовые пробелы и приоритетный план

### 5.1. Что покрыто тестами сейчас

В `Backend` 13 тестовых файлов (`redis.test.js`, `middleware/auth.test.js`, `middleware/guestToken.test.js`, `services/aiService.test.js`, `utils/*.test.js`), **ни одного** для push-подсистемы: нет тестов `pushService`, `pushBroadcastService`, `pushBroadcastJob`, `broadcastIdempotency`, `pushBroadcastValidation`. `_notif_smoke.mjs` проверяет только in-app API и не касается push. Итог: критические состояния (`sending`, частичная отправка, гонка идемпотентности) не проверяются вообще.

### 5.2. Добавленные в рамках аудита probe (можно запускать без БД/сети)

* `state/notif-audit/scratch/pushService.probe.test.mjs` — 5 тестов, все проходят. Запуск: `cd Backend && node --test ../state/notif-audit/scratch/pushService.probe.test.mjs`. Проверяет: удаление только по 410; отсутствие backoff/карантина для 400; обрыв батча при ошибке БД в `destroy()`; строгую последовательность/таймаут; форму payload (`icon`, `badge`, `data`, `timeout=10s`). Файл подменяет метод синглтона `web-push` и использует фейковые подписки — БД, Redis и сеть не нужны.
* `state/notif-audit/scratch/idempotency-key.probe.mjs` — воспроизводит клиентский FNV-ключ и показывает, что `scheduledFor`/админ не влияют на ключ (одинаковый ключ у «немедленно» и «завтра»).

### 5.3. Пробелы, которые нужно закрыть тестами

| Область | Что тестировать | Тип |
|---|---|---|
| `pushService.sendToSubscriptions` | 410/404 → destroy; 400/401/403/413/429/500 → политика; ошибка `destroy()` не рвёт батч; таймаут | unit с фейковым `web-push` (как probe) |
| `pushBroadcastService` state machine | `pending→sending→sent/failed`; частичный сбой; `total_subscriptions`/`sent_count`/`failed_count`; отмена | unit с фейковым репозиторием или temp-PG |
| Resume/checkpoint | kill процесса в середине → продолжение без дублей | integration (temp БД + фейковый web-push) |
| Идемпотентность/дедуп | 50 параллельных POST с одним ключом → 1 рассылка; один ключ + разный payload → 409; content-dedupe с разными получателями | integration с реальными PG+Redis (по образцу `_notif_smoke.mjs`) |
| Redis down | идемпотентность/локи/rate-limit не ломают создание; нет дублей при деградации | integration (Redis off) |
| VAPID | отсутствует/невалидный: старт, `/health`, 503 на создание, broadcast не шлёт N запросов | unit + smoke |
| Payload size | кириллица + длинный URL → 400 валидации; 413 не воспроизводится | unit |
| Подписки | race subscribe; logout/смена аккаунта; гостевая отписка; retention по активности | integration |
| Планировщик | stale-детект по started_at; двойной запуск при нескольких инстансах; shutdown mid-send | integration |
| Клиент | 409 при смене аккаунта; dedup/scheduled сообщения; `pushsubscriptionchange` 403/origin | component/SW тесты (зона task-4) |

### 5.4. Приоритетный план

**P0 — до ближайшего релиза (безопасность данных/доставки):**

1. **P-01:** ввести per-recipient чекпоинты и resume (можно упрощённо: `last_subscription_id` + досылка), stale → `failed` + алерт, graceful shutdown; не терять прогресс при деплое.
2. **P-04:** классификация ошибок и bounded retry/backoff для 429/5xx/timeout, карантин для 401/403/400, не удалять всё подряд; логировать `statusCode`.
3. **P-08:** не бросать импорт при невалидном VAPID; `sendBroadcast` проверяет конфиг и не устраивает 401-шторм; `/health` показывает состояние.
4. **P-12:** валидация байтового размера payload.
5. **P-06 (минимум):** алерт на `status=failed`/`failed_count>0` и на зависшие рассылки.

**P1 — в течение 2 недель:**

6. **P-02:** атомарная идемпотентность (БД unique + `SET NX`), payload hash.
7. **P-03:** случайный nonce-ключ на клиенте, корректные сообщения/статусы, отдельный «resend».
8. **P-05:** чанки/пагинация/конкурентность/бюджет времени, `raw`-выборка.
9. **P-06 (полностью):** per-recipient статусы, structured logs, метрики, детали рассылки в админ-API.
10. **P-07:** не рвать батч из-за `destroy()`; не помечать `failed` при `sent>0`.

**P2 — плановое улучшение:**

11. **P-09:** logout/смена аккаунта/гостевая отписка/retention по активности.
12. **P-10:** разделить учёт in-app и push, ретраи care advice, убрать циклические повторы без push.
13. **P-11:** rate-limit админ-рассылок, удалить/переписать legacy `/send`/`/send-all`.
14. **P-13:** fail-closed/наблюдаемая деградация идемпотентности; **P-14:** stale по `started_at`; **P-15…P-19:** гигиена.

**Метрики успеха после P0–P1:** доля успешных push ≥ 99% (по провайдеру), 0 рассылок в `sending` старше 15 минут без алерта, 0 дублей при 50-параллельном retry, 100% рассылок с возможностью получить список недоставленных, время деплоя не влияет на доставку (resume не более 1 минуты), RSS < 200 MiB на 100k подписок.

---

*Файл подготовлен в рамках task-2. Product-код не изменялся. Все утверждения основаны на прочитанном коде; ссылки на строки актуальны на момент аудита. Скрипты-доказательства — в `state/notif-audit/scratch/`.*
