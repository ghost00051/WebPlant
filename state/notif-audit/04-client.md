# 04. Клиентская часть: UX уведомлений, service worker, permission flow

**Аудитор:** client-auditor · **Задача:** task-4 · **Дата:** 2026-10-19
**Область:** браузерный/PWA-слой уведомлений «Лейки»: `Frontend/public/sw.js`, `Frontend/src/utils/pushNotifications.js`, `NotificationPrompt`, `notifications`, `AdminPushPanel`, `home`, `homePage`, `ThemeContext`, `main.jsx`, `App.jsx`, `vite.config.js`, `index.html`, `manifest.json`, а также серверные контракты `/api/push/*`, `/api/notifications/*`, `/api/admin/push/*` и правила деплоя (`Frontend/htaccess`, `Frontend/scripts/prerender.mjs`).

**Методика.** Все перечисленные файлы прочитаны полностью (sw.js и pushNotifications.js — построчно). Контракты сверены с `Backend/routes/*`, `Backend/controllers/pushController.js`, `notificationController.js`, `adminPushController.js`, `services/pushService.js`, `pushBroadcastService.js`, `reminderService.js`, `utils/pushBroadcastValidation.js`. Дополнительно: (а) проверен собранный бандл `Frontend/dist/assets/home-FgGOyPNy.js` — подтверждает дефект затенения `Notification`; (б) прогнан `node Frontend/scripts/verify-routing.mjs /notifications` → `404 (правило 404: адрес не совпал ни с одним маршрутом)`; (в) учтена фактическая топология деплоя: статика/PWA на `checktheplants.ru` (FTP, `deploy.config.json`), API — `server.checktheplants.ru` (`Backend/nginx/conf.d/default.conf`), `/api` на статик-хосте не проксируется (`Frontend/htaccess:98`).
Сеть/браузер не использовались: выводы получены статическим анализом и детерминированными скриптами репозитория.

---

## 1. Резюме и оценка

**Оценка: 5/10.**

Сильные стороны продукта реальные: кастомный pre-prompt (не спамит системным диалогом), корректная обработка «разрешение нельзя запросить дважды», отдельные тексты для iOS/standalone, 7-дневный cooldown, in-app центр уведомлений с optimistic mark-read и серверным `unreadCount`, аккуратная админ-панель с идемпотентностью и защитой от дублей, URL из push проверяется по origin, XSS-стоков нет.

Но в жизненном цикле подписки есть **тихие обрывы**, которые продукт не замечает и не показывает пользователю:

1. `home.jsx:23` импортирует SVG под именем `Notification`, затеняя DOM-глобаль `Notification`; выражения `Notification.permission` (`home.jsx:71,82`) всегда ложны. Ветка восстановления/синхронизации подписки на главной **недостижима**, что подтверждено собранным бандлом (`'data:image/svg+xml,…'.permission === "granted"`). Это единственное место, где приложение восстанавливало потерянную браузерную подписку.
2. `sw.js:148,164` ходит на относительный `/api/push/...`, тогда как приложение в проде ходит на `https://server.checktheplants.ru/api` (`api.js:1-7`; dev-прокси есть только в `vite.config.js:40-65`). На статик-хосте `checktheplants.ru` файла/прокси `/api` нет (`Frontend/htaccess:85-98` → 404). То есть `pushsubscriptionchange` — штатный механизм восстановления истёкшей подписки — в продакшене **не работает вообще** (в dev работает, поэтому баг не виден).
3. Ключ VAPID при подписке не сверяется: `subscribeToPush` (`pushNotifications.js:70-87`) доверяет любой существующей подписке. Ротация VAPID-ключей (а она прямо рекомендована в `Release-Verification-Report.md` из-за утечки секретов) молча убивает push у всех, без пути восстановления.
4. `POST /api/push/subscribe` возвращает `409` при подписке, привязанной к другому аккаунту (`pushController.js:28-30`); клиент превращает это в общий текст и **глотает** (`pushNotifications.js:96-98`, `home.jsx:74-76`, `registration.jsx:118-120`). При смене аккаунта на общем устройстве: старый пользователь продолжает получать push (logout не отписывает — `userController.js:357-370`), новый — не получает ничего и не знает об этом.
5. Центр уведомлений `/notifications` отсутствует в правилах деплоя (`Frontend/htaccess:85`, `prerender.mjs:17-46`): перезагрузка страницы центра или прямой переход в него отдаёт 404, хотя маршрут в SPA есть (`App.jsx:81-88`).

Плюс заметный пласт Medium-проблем: badge не обновляется по push, оффлайн-режим установленного PWA фактически сломан, ошибки подписки почти везде только `console.warn`, a11y модалки-промпта, таймзонная ошибка группировки «Сегодня/Вчера», отсутствие таймаутов у push-запросов и т.п. Блокеров (полный отказ сервиса, уязвимость с эксплуатацией) не найдено; ближайшие к блокеру — пп. 1–3 (тихая деградация доставки) и п. 4 (приватность на общем устройстве).

---

## 2. Таблица находок

| ID | Severity | Файл:строки | Суть | Сценарий (что видит пользователь) |
|----|----------|-------------|------|-----------------------------------|
| C-01 | **High** | `Frontend/public/sw.js:148-169`; `Frontend/src/utils/api.js:1-7`; `Frontend/.env.development:1-5` | `pushsubscriptionchange` ходит на относительный `/api/push/*` (origin статики), а весь остальной клиент — на `API_URL` = `https://server.checktheplants.ru/api`. На `checktheplants.ru` нет маршрута `/api` (`Frontend/htaccess:98`). В dev Vite-прокси маскирует баг. | Браузер инвалидирует/обновляет подписку → SW получает 404 от статик-хоста → `console.error`, подписка не пересоздана и не сохранена → push на устройство прекращаются навсегда, никакого UI-сигнала. |
| C-02 | **High** | `Frontend/src/component/home/home.jsx:23,71-80,82-85` (доказательство: `Frontend/dist/assets/home-FgGOyPNy.js`) | SVG-иконка импортирована как `Notification` и затеняет DOM-глобал. `Notification.permission` — свойство строки-URL, всегда `undefined`; обе ветки permission («granted»/«denied») мертвы. | Если браузерная подписка потеряна (сброс push-сервиса, частичная очистка данных, ошибка resubscribe), главная не вызывает `restorePushSubscription`/`syncPushSubscription`. Профиль тоже не создаёт подписку заново (только пере-постит существующую, `profile.jsx:196-225`). Push тихо перестают приходить, пока пользователь вручную не перещёлкнет тумблер. |
| C-03 | **High** | `Frontend/src/utils/pushNotifications.js:68-87`; `Backend/services/pushService.js:10-22,94` | При наличии подписки клиент не проверяет `subscription.options.applicationServerKey` и не сверяет его с текущим `vapid-public-key`. После ротации ключей сервер получает 403 `VapidPkHashMismatch`, а не 410, поэтому строки в БД не удаляются. | Админ ротирует VAPID-ключи (рекомендовано из-за утечки) → у всех пользователей push перестают доставляться; клиент считает подписку валидной, `pushsubscriptionchange` не срабатывает (ключ сменил сервер, не браузер) → восстановления нет. |
| C-04 | **High** | `Frontend/htaccess:85-98`; `Frontend/scripts/prerender.mjs:17-46,428-436`; `Frontend/src/App.jsx:81-88` | Маршрут `/notifications` не добавлен ни в rewrite-список `.htaccess`, ни в `privateRoutes` пререндера; фолбэк — `RewriteRule ^ - [R=404,L]`. Проверено `verify-routing.mjs /notifications → 404`. | Пользователь открывает центр уведомлений по ссылке, обновляет страницу (F5), получает push с URL `/notifications` из рассылки или открывает закладку — вместо центра видит «Такой страницы нет». Кнопка «назад» возвращает на главную, а сам центр по прямой ссылке недоступен. |
| C-05 | **High** | `Frontend/src/component/profile/profile.jsx:369-387`; `Backend/controllers/userController.js:357-370`; `Backend/controllers/pushController.js:28-30,57-74`; `Frontend/src/utils/pushNotifications.js:89-98`; `Frontend/src/component/registration/registration.jsx:110-121,157,193,210` | Logout не отписывает endpoint, а `subscribe` для того же endpoint под другим аккаунтом отдаёт 409; клиент показывает общий текст только в промпте/профиле, в `reattachPush`/`restore`/`sync` ошибка глушится. `unsubscribe` требует авторизации и удаляет строку только по `user_id`. | Общее устройство/семья: пользователь A вышел, вошёл B. Браузер A→B: старый браузерный endpoint остаётся привязанным к A, поэтому A продолжает получать персональные напоминания о своих растениях на устройстве B (утечка), а B не получает ничего (409 → warn). |
| C-06 | **Medium** | `Frontend/public/sw.js:117-141`; `Frontend/src/component/notifications/notifications.jsx:328-359`; `Backend/jobs/reminderService.js:510-521` | По клику на push SW только навигирует (игнорирует `data.notificationId`, `event.action`); соответствие push↔in-app запись не отмечается прочитанным; вместо SPA-перехода — полная перезагрузка через `client.navigate`. | Пользователь нажимает «Полить»-уведомление → открывается `/home` с полной перезагрузкой; в центре уведомлений запись остаётся непрочитанной, badge продолжает расти. Клик по push не считается прочтением. |
| C-07 | **Medium** | `Frontend/src/component/homePage/homePage.jsx:139-158,250-293,659-669` | Unread badge обновляется только на mount / visibility / focus / online; push при открытой вкладке не обновляет счётчик (нет `postMessage` из SW, нет polling); «Повторить» после ошибки зовёт только `loadHomeData`, badge не перезапрашивает; 401 на `/notifications/unread-count` глушится. | Пользователь сидит на главной, приходит push — badge не меняется. Сеть моргнула — badge исчезает/застревает и «Повторить» его не восстанавливает. Просроченная сессия: badge просто пропадает без редиректа на логин. |
| C-08 | **Medium** | `Frontend/src/utils/pushNotifications.js:68,73,89,104,111`; `Frontend/src/component/registration/registration.jsx:157,193,210` | У push-запросов и у `navigator.serviceWorker.ready` нет таймаута (в проекте есть `fetchWithTimeout`, `utils/fetchWithTimeout.js:1-43`, но здесь не используется). `reattachPush` ожидается **до** `navigate('/home')`. | Зависшая сеть/SW: кнопка «Включить» навсегда показывает «Подключение…», тумблер в профиле — «не сохраняется», вход/регистрация «залипает» на кнопке без перехода (push-привязка ждёт сеть бесконечно). |
| C-09 | **Medium** | `Frontend/src/utils/pushNotifications.js:237-266`; `Frontend/src/component/home/home.jsx:74-76`; `Frontend/src/component/profile/profile.jsx:209-215,258-263` | Ошибки `restore`/`sync`/`subscribe` в фоновых путях только `console.warn`/`console.error`; нет состояния «подписка есть в браузере, но не сохранена на сервере». | Сервер вернул 429/500/409 — пользователь уверен, что уведомления включены (тумблер ON / «Напомним, когда пора полить»), но push не приходят. Узнать и исправить нечем, кроме повторного клика в профиле. |
| C-10 | **Medium** | `Frontend/public/sw.js:4-10,57-73`; `Frontend/public/manifest.json:7` | Precache содержит `/`, `/plants`, `/care`, `/404.html`, но не `start_url` `/home`; hashed JS/CSS не кешируются вообще. Оффлайн-навигация на любой некэшированный маршрут отдаёт закешированный `404.html`. | Установленное PWA запускается оффлайн по `/home` → получает страницу «Такой страницы нет». Даже закешированный `/` не рендерится: его `/assets/*.js|css` не в кеше и получают пустой 504. |
| C-11 | **Medium** | `Frontend/src/component/notifications/notifications.jsx:192-232,207-213`; `Frontend/src/component/profile/profile.jsx:497-525`; `Frontend/src/component/NotificationPrompt/NotificationPrompt.jsx:28-31` | Состояние «denied» — текст-тупик: «разрешите в настройках браузера» без инструкции/ссылки; тумблер в профиле выглядит активным, но `requestPermission()` при denied всегда мгновенно возвращает `denied`, т.е. клик гарантированно неуспешен. | Пользователь когда-то нажал «Блокировать» → в приложении видит либо warning без шагов, либо «не получилось», и не понимает, что нужно снять блокировку в настройках сайта (Chrome: замок → Уведомления; iOS: Настройки → Уведомления → Лейка). |
| C-12 | **Medium** | `Frontend/src/component/NotificationPrompt/NotificationPrompt.jsx:61-118`; `Frontend/src/component/NotificationPrompt/NotificationPrompt.css:1-11` | Кастомный промпт — `div`-оверлей без `role="dialog"`, `aria-modal`, `aria-labelledby`, без фокуса/трапа/Escape, фон не скрыт от скринридера; ошибка (`:96`) без `role="alert"`; кнопки не получают стартовый фокус. | Клавиатурный/скринридер-пользователь: фокус остаётся на странице под оверлеем; Tab уходит в контент позади; сообщение об ошибке не озвучивается; Escape не закрывает. |
| C-13 | **Medium** | `Frontend/src/component/notifications/notifications.jsx:100-117,244,265`; `Frontend/src/utils/date.js:37-60,86-88` | `toDate()` для строки с ISO-временем берёт **календарную дату UTC** (`ISO_DATE_PATTERN` до часового пояса), а не локальную. `created_at` приходит как `...Z`. | Уведомление, пришедшее в 00:30–02:59 МСК, попадает в группу «Ранее» и подписано «Вчера, 00:30» вместо «Сегодня, 00:30»; ночные уведомления визуально «стареют» на день. |
| C-14 | **Medium** | `Frontend/src/component/profile/profile.jsx:193-225`; `Backend/routes/pushRoutes.js:10-20`; `Backend/controllers/pushController.js:23-45` | Каждый маунт профиля при уже выданном разрешении делает `subscribeToPush()` → `POST /push/subscribe` (findOne+create/update без транзакции). Нет single-flight на уровне клиента; лимит 20 запросов/15 мин. | Частые заходы в профиль/несколько вкладок → 429 «Слишком много попыток…», либо гонка двух create на уникальном endpoint → 500; пользователь видит «Не удалось проверить push-подписку» при формально рабочей подписке. |
| C-15 | **Medium** | `Frontend/src/component/notifications/notifications.jsx:133-138,361-382,418-441` | После успешного включения нет подтверждения: `pushNotice` переключается на «Установите приложение» (или исчезает) — выглядит как «ничего не произошло». При ошибке `subscribeToPush` кнопка «Разрешить уведомления» исчезает (`permission` уже granted), повтор возможен только перезагрузкой. Состояние `permission` не обновляется при возврате из настроек браузера. | Пользователь включил уведомления и не уверен, что включилось; при серверной ошибке в момент включения остаётся текст ошибки без кнопки «Повторить» — только F5. |
| C-16 | **Low** | `Frontend/src/component/NotificationPrompt/NotificationPrompt.jsx:47-50`; `Frontend/src/utils/pushNotifications.js:170-185` | Любая ошибка `subscribeToPush` (сеть/429/500) помечается как `'declined'`; если пользователь после ошибки закроет промпт, 7-дневный cooldown не даст предложить снова. `PUSH_PROMPT_SHOWN_KEY` пишется и в момент показа, поэтому «показан, но не увиден» тоже тратит cooldown. | Временный сбой сервера в момент подписки → пользователь откладывает → неделя без напоминаний и без повторного предложения. |
| C-17 | **Low** | `Frontend/src/component/notifications/notifications.jsx:361-382`; `Frontend/src/utils/pushNotifications.js:187-197,237-266`; `Frontend/src/component/profile/profile.jsx:193-225,255-257` | Флаг `push_device_opt_out` ставится до сетевого `unsubscribe` (при ошибке остаётся `true`, а тумблер — ON); при включении из страницы уведомлений флаг не сбрасывается; `loadPushState` флаг не учитывает. | Состояния «выключено в браузере / выключено локально / включено на сервере» расходятся; после сбоя отписки авто-восстановление подписки на этом устройстве заблокировано флагом, хотя UI показывает «включено». |
| C-18 | **Low** | `Frontend/src/component/notifications/notifications.jsx:119-121` | `readableUrl()` пропускает `'//evil.example'` (начинается с `/`), т.е. протокол-относительный URL. Бэкенд такие URL не генерирует (напоминания всегда `/home`), но клиентская защита неполная. | При появлении любого серверного/будущего источника `item.url` клик может уйти на чужой origin (сейчас сдерживается только тем, что URL формирует сервер). |
| C-19 | **Low** | `Frontend/public/sw.js:84,105-112,117-141` | Мелочи SW: `badge` — цветная 192×192 иконка вместо монохромной 72×72 (Android обрезает/портит); `event.action` не обрабатывается (одно действие — терпимо); нет `notificationclose`; `client.url.startsWith(origin)` — строковая проверка вместо `new URL().origin`; при падении `client.navigate` нет фолбэка на `openWindow`. | Косметика уведомлений на Android; при ошибке навигации клик по push ничего не открывает; аналитики закрытий нет. |
| C-20 | **Low** | `Frontend/src/component/adminPush/AdminPushPanel.jsx:267-280`; `Backend/utils/broadcastIdempotency.js:4`; `Backend/utils/pushBroadcastValidation.js:124-140` | Idempotency-Key считается из title/body/url/target/ids, но **без** `scheduledFor` и без `adminId`; TTL ключа 24 ч. | Админ планирует одну и ту же рассылку на разные даты (или два админа отправляют одинаковый текст) — второй запрос в течение суток возвращает `deduplicated: true`, рассылка не создаётся. |
| C-21 | **Low** | `Frontend/src/component/adminPush/AdminPushPanel.jsx:608-619,668-675,8-9,154-165,304-307` | Валидация URL/даты только серверная (ошибка 400 показывается после отправки); список получателей ограничен 50 без пагинации («Выбрать всех найденных» = первые 50); 409 «дубль» рисуется как красная ошибка, хотя это защита; при ошибке `overview` кнопка отправки навсегда disabled (нет retry обзора). | Админ не может выбрать пользователя №51; не понимает, что рассылка защищена от дубля; после сбоя загрузки статистики не может отправить вообще ничего. |
| C-22 | **Low** | `Frontend/src/context/ThemeContext.jsx:51-81,92-108` | `notification-preferences` (тема) запрашивается на **каждую** смену `location.pathname` в приватных разделах — лишняя нагрузка и гонка с PATCH в профиле; `401` в `setThemePreference` трактуется как успех (`return true`). | Тема «сохраняется» при истёкшей сессии (на самом деле нет), после перезагрузки откатывается; лишние GET на каждый переход между /home, /notifications, /my-plants. |
| C-23 | **Low** | `Frontend/public/sw.js:80-82,109,143-178`; `Frontend/htaccess:28-30` | `push` без payload показывает title «CheckThePlants» (англ. бренд), `requireInteraction:false` для напоминаний; `vibrate` на iOS игнорируется; `sw.js` отдаётся с `Cache-Control: immutable, max-age=1y`, т.е. обновления SW могут применяться с задержкой (Chrome капирует 24 ч). | Malformed push → англоязычное уведомление; исправления клиентских багов push доезжают до части пользователей с суточной задержкой. |
| C-24 | **Nit** | `Frontend/src/component/home/home.jsx:172,213`; `Frontend/src/component/notifications/notifications.jsx:263-272` | `NotificationPrompt` принимает неиспользуемый `userId`; заголовок «Ранее» при возрасте ≤7 дней сопровождается meta «На этой неделе» (два разных смысла в одном блоке); нет `navigator.setAppBadge` для установленного PWA. | Мёртвый проп; косметика группировки; на иконке приложения нет числового badge (iOS/Android PWA), хотя счётчик есть внутри. |

Итого: **0 Blocker, 0 Critical, 5 High (C-01…C-05), 10 Medium (C-06…C-15), 8 Low (C-16…C-23), 1 Nit (C-24)**.

---

## 3. Детальный разбор

### 3.1. Service worker и push-обработка

**C-01 (High). Recovery-эндпоинты в SW идут не на тот origin.**
`sw.js:148-150` и `sw.js:164-169` делают `fetch('/api/push/vapid-public-key')` и `fetch('/api/push/subscribe')` — это относительные URL, т.е. origin **статики** PWA (`https://checktheplants.ru`). При этом весь остальной клиент использует `API_URL` из `api.js:1-7`, который в production равен `https://server.checktheplants.ru/api`; dev-прокси `/api` объявлен только в `vite.config.js:40-65` и действует лишь при `vite dev`. По топологии деплоя `Frontend/htaccess` (FTP-статика) маршрута `/api` нет, а последнее правило — `RewriteRule ^ - [R=404,L]` (`htaccess:98`); API-nginx обслуживает только `server.checktheplants.ru` (`Backend/nginx/conf.d/default.conf:15-75`, там же `location / { return 404; }`). Поэтому в проде `res.ok === false`, срабатывает ветка `throw … HTTP 404`, ошибка уходит в `console.error` (`sw.js:174-176`) и **подписка не пересоздаётся**. В dev всё работает — классическая причина, почему дефект не поймали тестами.

Последствие: штатный сценарий «браузер обновил/инвалидировал подписку» (в т.ч. Chrome refresh после простоя, смена FCM-токена) не восстанавливается: старый endpoint мёртв, новый не создан/не сохранён, push прекращаются навсегда без какого-либо UI-сигнала.

Как чинить (минимум):

```js
// sw.js: базовый URL API должен быть известен SW явно, а не выводиться из origin статики
const API_BASE = new URL('/api', 'https://server.checktheplants.ru').href // либо сгенерировать при сборке/передать в postMessage
// …
const res = await fetch(`${API_BASE}/push/vapid-public-key`, { credentials: 'include' })
```

Лучше: инлайн-подстановка `VITE_API_URL` в `sw.js` при сборке (Vite не транспилирует `public/`, поэтому нужен либо генератор/плагин, либо статическая константа + проверка) и явная проверка `event.oldSubscription`/`event.newSubscription`. Дополнительно: в SW нужен фолбэк «не смогли — покажем локальное уведомление с просьбой включить уведомления заново».

**C-03 (High). Нет проверки VAPID-ключа и ротации.**
`pushNotifications.js:68-87`: если `getSubscription()` вернул объект, клиент сразу шлёт его на сервер, не сверяя `subscription.options.applicationServerKey` с `/push/vapid-public-key`. При серверной ротации ключей (`web-push` → `403 VapidPkHashMismatch`) строки в БД не удаляются (удаление только на 410/404, `pushService.js:120-124`), поэтому «мёртвая» подписка вечна, а браузер `pushsubscriptionchange` не получит. Рекомендация:

```js
const key = await fetchVapidKey()
const current = await registration.pushManager.getSubscription()
const keyMatches = current && sameBytes(current.options.applicationServerKey, urlBase64ToUint8Array(key))
if (!keyMatches) {
  if (current) await current.unsubscribe().catch(() => {})
  subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes })
}
```

**C-06 (Medium). Клик по push не связывает OS-уведомление с in-app записью.**
Сервер кладёт в payload `data.notificationId` (`reminderService.js:249,336,519`; `careAdviceService.js:213`), но `notificationclick` (`sw.js:117-141`) его игнорирует: закрывает уведомление, валидирует URL по origin (это сделано корректно) и либо `client.navigate(urlToOpen)` (полная перезагрузка SPA, потеря состояния), либо `openWindow`. Отметки прочтения нет, маршрута к конкретному растению нет (в напоминаниях сервер всегда кладёт `url:'/home'`; произвольный URL бывает только у админ-рассылок). В результате действие пользователя (нажал на напоминание) не уменьшает unread и не закрывает сообщение в центре.

Рекомендация: (1) при `data.notificationId` отправить `PATCH /api/notifications/:id/read` (нужен абсолютный `API_BASE` в SW); (2) при наличии окна — `client.postMessage({type:'push-click', url, notificationId})`, а SPA-роутер делает `navigate()` без перезагрузки и обновляет badge; (3) сохранять `client.url` и фокусировать уже нужный таб, не навигируя его повторно.

**C-19 (Low). Мелкие дефекты SW.**
`badge: '/icons/icon-192.png'` (`sw.js:84,104`) — файл существует, 404 нет, но для Android badge обязан быть монохромным 72×72; цветная иконка отображается как «пятно». `tag` (`sw.js:96-98`) для напоминаний получается `plant-<id>-<tag>`, для рассылок — `plant-<Date.now()>`: коллизий на практике нет, `renotify:true` работает; но `Date.now()`-тег означает, что каждая рассылка — отдельное уведомление (в т.ч. повторная отправка того же текста). `client.url.startsWith(origin)` (`sw.js:132`) — строковая проверка (для `clients.matchAll` безопасно, но лучше `new URL(client.url).origin === self.location.origin`). `client.navigate()` без `catch` (`sw.js:133`): при ошибке навигации `waitUntil` падает и `openWindow` не вызывается.

### 3.2. Подписка и разрешения

**C-02 (High). Затенение `Notification` в `home.jsx` — ключевой дефект клиентской логики.**
`home.jsx:23` `import Notification from '../../assets/NotifBtn.svg'`; иконка используется в JSX (`:150,188`). Но в том же модуле `Notification.permission` (`:71,82`) теперь резолвится в строку-URL SVG: `'…svg'.permission === undefined`. Оба `if` всегда ложны, поэтому исполнение уходит в `shouldOfferPushPrompt()` и дальше `setLoading(false)`. Мёртвыми оказываются `getActivePushSubscription()`, `syncPushSubscription()` и, главное, `restorePushSubscription()` (`:71-80`) — единственное место, где приложение пересоздаёт потерянную браузерную подписку без действий пользователя.
Доказательство из `dist` (собранный код, не только исходник): в `Frontend/dist/assets/home-FgGOyPNy.js` видно `'data:image/svg+xml,%3csvg…%3e`.permission===`granted`` — т.е. в бандле свойство читается у строки.
Фикс: переименовать импорт (`import notificationIcon from …`) и обращаться к `window.Notification.permission` (или `navigator.permissions.query({name:'notifications'})`). Заодно стоит убрать `userId`-проп.

**C-05 (High). Logout/смена аккаунта и 409.**
`profile.jsx:369-387` выполняет только `POST /users/logout`; серверный `logout` (`userController.js:357-370`) чистит auth-куки и не трогает `push_subscriptions`. Клиентская отписка есть только в тумблере профиля (`profile.jsx:255-257`). `POST /push/subscribe` для endpoint, привязанного к другому `user_id`, отвечает `409` (`pushController.js:28-30`), а `subscribeToPush` (`pushNotifications.js:96-98`) заменяет серверный `message` на «Ошибка сохранения подписки на сервере», после чего:
- `registration.jsx:118-120` (`reattachPush`) — `console.warn`, логин продолжается;
- `home.jsx:74-76` — `void` без обработки;
- `profile.jsx:209-215` — только если вызов шёл из профиля.
Итог: на общем устройстве бывший пользователь продолжает получать push, новый — нет, и ни один экран об этом не сообщает. Минимум: отписываться/перепривязывать endpoint при logout и логине, а 409 показывать с понятным действием («Отвязать подписку от прошлого аккаунта?»), по аналогии с серверным текстом.

**C-08 (Medium). Таймауты.**
`pushNotifications.js:68` (`navigator.serviceWorker.ready`), `:73` (GET ключа), `:89` (POST subscribe), `:104,:111` (unsubscribe) — без таймаутов и без `AbortController`. В проекте уже есть `fetchWithTimeout` (`utils/fetchWithTimeout.js:1-43`) с сообщением «Превышено время ожидания…», но в push-модуле он не применяется. Из-за `await reattachPush()` до `navigate('/home')` (`registration.jsx:157,193,210`) зависший запрос подвешивает вход. Для `serviceWorker.ready` нужен `Promise.race` с таймаутом (аналогичный `waitForRegistration` уже есть в `pushNotifications.js:205-223`, но `subscribeToPush`/`unsubscribeFromPush` его не используют).

**C-09 (Medium). Тихие ошибки восстановления/синхронизации.**
`restorePushSubscription`/`syncPushSubscription` (`pushNotifications.js:237-266`) возвращают `null` и пишут `console.warn`. Ни в `home.jsx`, ни в `PwaInstallHint`, ни в notifications нет состояния «подписка не синхронизирована». Для продукта нужно отдельное состояние: «Уведомления включены, но не удалось связать с сервером — повторить» (и оно должно переживать ошибку 429/500/409). Сейчас пользователь видит «Напомним, когда пора полить» (`profile.jsx:505-512`) даже когда на сервере ноль подписок.

**C-14 (Medium). Повторный POST из профиля и гонки.**
`profile.jsx:196-225`: `if (subscription) await subscribeToPush()` на каждом маунте. Это идемпотентно по смыслу, но: (1) пишет в БД на каждый заход; (2) при >20 заходах/15 мин срабатывает `subscriptionLimiter` (`pushRoutes.js:10-17`) → 429 → пользователь видит ошибку; (3) два параллельных запроса на новый endpoint (две вкладки) проходят `findOne` до `create` (`pushController.js:23-45`) → один падает на unique-индексе (`PushSubscription.js` uniq по endpoint) → 500. Нужны клиентский single-flight (`Map<endpoint, Promise>`) и debounce/кэш «синхронизировано недавно» (частично уже есть `PUSH_SYNC_INTERVAL_MS` в `pushNotifications.js:130-133`, но профиль его не использует).

**C-11 (Medium). Тупик при «denied».**
`notifications.jsx:207-213` и `profile.jsx:503-512` сообщают о блокировке без пошаговой инструкции; в профиле тумблер не `disabled` (`profile.jsx:515-525`), т.е. выглядит как рабочая кнопка, но `requestPermission()` при `denied` возвращает `'denied'` без диалога (`pushNotifications.js:48-53`), и клик всегда даёт ошибку «Разрешение на уведомления не получено». Нужны: инструкция под браузер/платформу (Chrome: иконка замка → «Уведомления» → «Разрешить»; iOS: Настройки → «Лейка» → Уведомления) и `disabled`+пояснение на тумблере.

**C-16 (Low). Cooldown расходуется на неудачных/незамеченных показах.**
`NotificationPrompt.jsx:47-50` в `catch` ставит `markPushPromptAnswered('declined')` — при временном сбое сервера пользователь получает 7-дневный cooldown после закрытия промпта. `home.jsx:92-95` вызывает `markPushPromptShown()` в `setTimeout` без очистки при unmount: быстрый уход со страницы «сжигает» показ, не показав его. Фикс: различать `'failed'` (не cooldown, только backoff) и `'declined'`; хранить таймер в `useEffect` cleanup.

**C-17 (Low). Дрейф флага устройства.**
`profile.jsx:255-257` ставит `setPushDisabledOnThisDevice(true)` **до** `unsubscribeFromPush()`; при ошибке флаг остаётся, а UI — ON. `notifications.jsx:361-382` при включении флаг не снимает (в отличие от `NotificationPrompt.jsx:42` и `profile.jsx:250`). `loadPushState` флаг не читает (`profile.jsx:193-225`). Итог — три источника истины расходятся; надо: ставить флаг только после успешной отписки, всегда синхронизировать при включении, учитывать флаг в UI (или убрать его и опираться на `getSubscription()`).

### 3.3. Центр уведомлений, badge, счётчик

**C-04 (High). `/notifications` не задеплоен как маршрут.**
SPA-маршрут есть (`App.jsx:81-88`), но `.htaccess` перенаправляет только `login|register|home|add-plant|edit-profile|my-plants|reset-password` + `plants/care` (`Frontend/htaccess:85-90`), а всё остальное → 404 (`:98`). `prerender.mjs` тоже не содержит `notifications` в `privateRoutes` (`:17-46`) — файла `notifications.html` не будет. Прогнанный `verify-routing.mjs` подтверждает `404`. В SPA-переходе из главной всё работает, поэтому дефект не виден при обычном сценарии, но виден при F5, закладке, ссылке из push-рассылки и возврате извне. Фикс: добавить `/notifications` в rewrite-правило и в `privateRoutes` (+ тест-кейс в `verify-routing.mjs`).

**C-07 (Medium). Badge не синхронизируется по push и хрупок к ошибкам.**
`homePage.jsx:139-158` (`getNotifications`) вызывается на mount (`:250-254`) и из `refresh` (`:261-293`) только при visibility/focus/online или смене дня; `dayTimer` (`:285`) вызывает `refresh()` без `force`, а внутри `if (!dayChanged && !force) return` (`:267`) — значит 60-секундный таймер **не опрашивает** count. Push, пришедший при открытой вкладке, не порождает ни `postMessage` из SW, ни polling → badge остаётся старым. При ошибке `getNotifications` (`:155-157`) только `console.warn`, а кнопка «Повторить» в `dataError` (`:662-667`) зовёт лишь `loadHomeData` — badge не перезапрашивается. При 401 на `unread-count` нет редиректа на `/login` (в отличие от `notifications.jsx:145-148`).
Фикс: SW после `showNotification` и в `notificationclick` делает `clients.matchAll` + `postMessage({type:'notifications-changed'})`; `homePage` слушает `navigator.serviceWorker.message` и перезапрашивает count (плюс лёгкий polling раз в 60-120 с при visible); обработка 401 → `/login`; «Повторить» → `Promise.all([loadHomeData(), getNotifications()])`.

**C-13 (Medium). Таймзонная ошибка группировки.**
`created_at` — ISO-строка с `Z` (`notificationController.js:93`). `notifications.jsx:244` считает `diffInDays(item.created_at, new Date())`, `:258` — «N новых», `:265` — возраст; `formatCardTime` (`:100-117`) — «Вчера/Сегодня/день недели». `date.js:47-51` для строки, матчащей `^\d{4}-\d{2}-\d{2}`, берёт **дату как локальную**, отбрасывая время и зону; `diffInDays` (`:86-88`) сравнивает уже эти «локальные» даты. Для МСК (UTC+3) уведомления 00:00–02:59 попадают «во вчера». Фикс: для timestamp-строк использовать `new Date(value)` с преобразованием в локальную дату (`getFullYear/getMonth/getDate`), а усечение по календарной дате оставить только для date-only строк (`^\d{4}-\d{2}-\d{2}$`).

**C-15 (Medium). Переходные состояния включения на странице уведомлений.**
`enablePush` (`notifications.jsx:361-382`) после успеха не показывает success-состояние; `pushNotice` (memo по `permission`, `:192-232`) в лучшем случае меняется на «Установите приложение». Если `subscribeToPush` упал, `pushError` показан (`:428`), но `pushNotice.action` больше не рендерится (permission уже `granted`), т.е. кнопки «Повторить» нет — только перезагрузка. `permission` инициализируется один раз (`:133-136`) и не обновляется при возврате из настроек браузера.

**C-24 (Nit).** `NotificationPrompt` получает `userId` (`home.jsx:172,213`), но компонент его не использует (`NotificationPrompt.jsx:17`). Группа «Ранее» получает meta «На этой неделе» (заголовок и подпись противоречат друг другу). Для установленного PWA нет `navigator.setAppBadge/clearAppBadge` — счётчик не виден на иконке приложения.

### 3.4. Оффлайн / PWA

**C-10 (Medium). Precache не покрывает ни start_url, ни ассеты.**
`sw.js:4-10` кеширует `/`, `/plants`, `/care`, `/manifest.json`, `/404.html`. `manifest.json:7` `start_url: "/home"` — `/home` в кеше нет; навигация оффлайн уходит в fallback `caches.match('/404.html')` (`sw.js:62-66`) → пользователь видит «Такой страницы нет» при запуске установленного приложения без сети. Для `/` закеширован только HTML (`index.html`), а `/assets/*.js|css` не кешируются никогда (runtime-кеша нет), поэтому оффлайн-страница всё равно остаётся пустой (запросы ассетов получают `new Response('', {status:504})`, `sw.js:72`).
Фикс: precache `['/', '/home', '/404.html']` + app-shell (manifest + хешированные assets, список генерировать на этапе сборки), navigation fallback — всегда `/` (а не `/404.html`), отдельный оффлайн-экран. Как минимум — не отдавать 404-страницу вместо приложения.

### 3.5. Доступность и UX-тексты

**C-12 (Medium). Модалка-промпт без диалоговой семантики.**
`NotificationPrompt.jsx:61-63` — `<div className='notification-prompt-overlay'><div className='notification-prompt'>`; нет `role="dialog"`, `aria-modal="true"`, `aria-labelledby`/`aria-describedby`; при открытии фокус не переводится на кнопку; Tab уходит в контент под оверлеем; Escape не обрабатывается; фон не `aria-hidden`/`inert`. Ошибка (`:96`) — `<p className='notification-prompt-error'>` без `role="alert"`/`aria-live`, скринридер её не озвучит. В CSS оверлея (`NotificationPrompt.css:1-11`) нет ничего, что компенсировало бы это.
Рекомендация: `role="dialog" aria-modal="true" aria-labelledby="notif-prompt-title"`, `useEffect` с фокусом на primary-кнопку, обработчик Escape → `onClose`, `aria-live="assertive"` для ошибки, `inert`/`aria-hidden` на `#root` на время показа. (На странице `/notifications` a11y сделан заметно лучше: focus-visible для всех кнопок — `notifications.css:84-93`, `role="alert"` у ошибок — `notifications.jsx:428,459`.)

**C-11 (Medium), C-23 (Low), C-24 (Nit).** См. таблицу: тексты про «настройки браузера» без инструкций; непереведённый дефолт «CheckThePlants»; «Ранее / На этой неделе»; отсутствие PWA-badge.

### 3.6. Админ-панель (AdminPushPanel)

**C-20 (Low). Idempotency-Key без `scheduledFor`/`adminId`.**
`AdminPushPanel.jsx:267-280` формирует источник ключа из `title/body/url/targetMode/selectedIds/includeGuests`; `scheduledFor` не входит. Сервер помнит ключ 24 ч (`broadcastIdempotency.js:4`) и при совпадении отдаёт `200 {deduplicated:true}` без создания (`adminPushController.js:134-150`). Сценарий: два одинаковых текста на разные даты/время (или два админа) — вторая рассылка молча не создаётся, UI пишет «Такая рассылка уже была создана ранее». Плюс ключ считается 32-битным FNV (`:275-280`) — теоретические коллизии разных текстов приведут к ложному dedupe. Фикс: включить `scheduledFor` и `adminId` в источник; ключ генерировать в момент сабмита (UUID) и переиспользовать только при retry того же submit; TTL согласовать с UX.

**C-21 (Low). Валидация/лимиты/состояния.**
- URL (`:608-619`) проверяется только сервером (`pushBroadcastValidation.js:43-61`), ошибка 400 приходит после отправки — лучше клиентская проверка `startsWith('/') && !startsWith('//')`, как в бэкенде.
- `datetime-local` (`:621-641`) позволяет прошлое; сервер отклонит (`pushBroadcastValidation.js:124-140`, минимум +30 с) — показать min на клиенте.
- `SEARCH_LIMIT = 50` (`:8-9`) и нет пагинации: получатель №51+ недостижим, а кнопка называется «Выбрать всех найденных» (`:485-492`) — честнее «Выбрать всех в списке».
- 409-дубль (`adminPushController.js:160-169`) показывается как `formError` (красная ошибка, `AdminPushPanel.jsx:304-307`), хотя это штатная защита — лучше информационный тон.
- При ошибке `overview` (`:83-103`) `pushConfigured` остаётся `false` (`:367`), кнопка отправки навсегда `disabled` (`:671`), retry для overview нет — админ не может отправить ничего.
- 503 «push не настроен» для scheduled-рассылки не нужен (сервер разрешает планирование без VAPID, `adminPushController.js:129-131`), а клиент запрещает.

**Что в админке сделано хорошо:** защита от двойного сабмита (`sending` guard `:232-234` + `Idempotency-Key` + серверный dedupe + 409 при недавнем дубле), `maxLength` 120/1000 совпадает с сервером (`:584,597` vs `pushBroadcastValidation.js:2-3`), отмена pending-рассылки (`:208-230`), debounce поиска с защитой от гонок (`isMounted`, `:140-182`), корректный контракт `/admin/push/overview|recipients|broadcasts|cancel`, `fieldset/legend`, `aria-pressed`, `role="status"/"alert"`.

### 3.7. Контракты клиент↔бэкенд (сводка)

| Клиент | Сервер | Вердикт |
|---|---|---|
| `GET ${API_URL}/push/vapid-public-key` → `{publicKey}` (`pushNotifications.js:73-80`) | `GET /api/push/vapid-public-key` → `{publicKey}` или 503 (`pushRoutes.js:19`, `pushController.js:6-13`) | **Совпадает** |
| `POST /push/subscribe {subscription}` + `credentials:'include'`, проверка `response.ok` (`:89-98`) | `POST /api/push/subscribe` (`optionalAuth`), ответ **201** `{message,user_id}`, 400/409/429 (`pushRoutes.js:20`, `pushController.js:15-55`) | Path/method/body совпадают; **201 обрабатывается корректно**; **409 не различается** и глушится (C-05) |
| `POST /push/unsubscribe {endpoint}` (`:111-120`) | `POST /api/push/unsubscribe` (`requireAuth`), 200; при guest-строке удалит 0 строк | Path/body совпадают; **401 при истёкшей сессии** → `subscription.unsubscribe()` не вызывается (см. C-05/C-08) |
| `GET /notifications?limit=20&offset&status=all` (`notifications.jsx:141-144`) | `GET /api/notifications` → `{items,total,unreadCount,status,limit,offset,nextOffset}` (`notificationController.js:63-109`) | **Совпадает**, включая `nextOffset` и 401 |
| `PATCH /notifications/read-all` (`:303-306`) | `PATCH /api/notifications/read-all` → `{updatedCount,unreadCount}` (`notificationController.js:157-176`) | **Совпадает** |
| `PATCH /notifications/:id/read` (`:333-336`) | `PATCH /api/notifications/:id/read` → `{item,changed,unreadCount}` (`notificationController.js:121-155`) | **Совпадает** |
| `GET /notifications/unread-count` → `data.unreadCount` (`homePage.jsx:141-154`) | `GET /api/notifications/unread-count` → `{unreadCount}` (`notificationController.js:111-119`) | **Совпадает** |
| `GET /admin/push/overview` (`AdminPushPanel.jsx:87-96`) | `{pushConfigured,subscriptions:{total,users,guests},users:{total},recent[]}` (`adminPushController.js:64-89`) | **Совпадает** |
| `POST /admin/push/broadcasts` + `Idempotency-Key` (`:283-303`) | 201/200-dedup/409/400/503 (`adminPushController.js:121-194`) | **Совпадает**; UX 409/503 см. C-21 |
| `POST /admin/push/broadcasts/:id/cancel` (`:214-218`) | 200/404/409 (`adminPushController.js:196-222`) | **Совпадает** |
| SW: `fetch('/api/push/...')` (`sw.js:148,164`) | API живёт на `server.checktheplants.ru`; на статик-хосте `/api` → 404 (`htaccess:98`) | **Несовпадение origin — C-01** |
| Push payload `{title,body,icon,badge,data:{plantId,url,tag,notificationId}}` (`pushService.js:79-85`; `reminderService.js:510-521`) | SW читает `data.tag`, `data.plantId`, `data.url` (`sw.js:96-98,121-127`) | **Совпадает**; `notificationId` сервером отправляется, клиентом игнорируется (C-06) |
| `POST /users/logout` (`profile.jsx:372-378`) | auth-куки чистятся, push-подписки — нет (`userController.js:357-370`) | **Несовпадение ответственности** — C-05 |
| URL в уведомлении (`notifications.jsx:119-121`) | сервер хранит `url='/home'` (`notificationService.js:9`), рассылки URL валидирует (`pushBroadcastValidation.js:43-61`) | В целом совпадает; см. C-18 |

### 3.8. Гонки и повторные вызовы (отдельно, потому что спрашивали)

- Двойной клик «Включить» защищён во всех трёх местах: `loading` в `NotificationPrompt.jsx:25,102,111`; `pushBusy` в `notifications.jsx:362,434`; `pushChanging` в `profile.jsx:229,519`. Это **корректно**.
- Параллельный `subscribeToPush` из разных вкладок/экранов не сериализован (C-14); `POST /push/subscribe` не транзакционен, unique-индекс по endpoint превращает гонку в 500; клиент это глушит.
- `PwaInstallHint` и промпт уведомлений могут появиться почти одновременно (баннер + модалка), z-index модалки 9999 — перекрытия логики нет, но визуально шумно (Nit).
- `checkAuth` в `home.jsx:40-105` не имеет `AbortController`/`isMounted`: быстрый уход со страницы оставляет висящие `setState`/`await` (в React 19 безвредно, но `setTimeout` из `:92` живёт после unmount — C-16).
- `loadInitial`/`loadMore`/`markAllRead` в `notifications.jsx` имеют флаги `isLoadingMore`/`isMarkingAll` — повторный клик защищён; `openNotification` может быть вызван дважды по одному элементу до ответа `PATCH` (двойной mark-read безопасен идемпотентно, но лишний запрос) — Nit.

### 3.9. Безопасность клиента

- **XSS:** `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`document.write` в `Frontend/src` не найдены; `title/body` уведомлений рендерятся React-текстом (`notifications.jsx:499-504`), админ-превью тоже (`AdminPushPanel.jsx:650-654`). Серверные сообщения ошибок выводятся как текст. **Корректно.**
- **URL из push:** `sw.js:121-127` строит `new URL(data.url, origin)` и открывает только при точном совпадении origin; `javascript:`/`https://evil` отбрасываются в `/home`. **Корректно** (в отличие от клиентского `readableUrl`, C-18).
- **postMessage:** ни SW→клиент, ни клиент→SW сообщений нет вовсе — это одновременно причина C-06/C-07 и отсутствие attack-surface. При добавлении `postMessage` обязательно проверять `event.origin`.
- **Секреты:** `VAPID_PUBLIC_KEY` на клиент не попадает (берётся с сервера в рантайме) — корректно; приватный ключ клиенту недоступен.
- **Хранение:** `localStorage` используется только для prompt-метаданных/флагов, без PII — корректно.

---

## 4. Корректные места (что не надо «чинить»)

1. **Permission нельзя запросить дважды** — `requestPermission()` (`pushNotifications.js:40-54`) возвращает `true/false` при уже известном статусе и вызывает `Notification.requestPermission()` только при `default`; все вызовы идут из пользовательского жеста (`NotificationPrompt.jsx:34`, `notifications.jsx:366`, `profile.jsx:244`), что важно для iOS. Хорошо.
2. **iOS/standalone-ветки** — `isIOS()` (`pushNotifications.js:276-282`, включая iPadOS `MacIntel + maxTouchPoints`), `isStandalone()` (`:10-14`), сообщение «Push доступны начиная с iOS/iPadOS 16.4» (`NotificationPrompt.jsx:68-76`), запрет подписки вне standalone (`:61-63`), инструкция «Поделиться → На экран Домой» (`PwaInstallHint.jsx:114-119`). Реализовано.
3. **7-дневный cooldown и «ответ был дан»** — `PUSH_PROMPT_COOLDOWN_MS`, `getPushPromptAnswer`, `shouldOfferPushPrompt` (`pushNotifications.js:127-185,268-274`); повторный показ не превращается в спам.
4. **Безопасное чтение localStorage** — все обращения обёрнуты в try/catch (`pushNotifications.js:136-159,163-180`), при недоступности деградирует к «показать промпт», не падает.
5. **Валидация URL в notificationclick** — точное сравнение origin (`sw.js:121-127`); **конвертация VAPID base64url** в SW и в приложении корректная (`sw.js:180-185`, `pushNotifications.js:29-38`).
6. **`userVisibleOnly: true` и `applicationServerKey`** при подписке (`pushNotifications.js:82-85`, `sw.js:159-162`).
7. **`tag` + `renotify`**: тег детерминирован для напоминаний (`plant-<id>-<tag>`), поэтому повторное напоминание заменяет предыдущее, а разные типы (on_day/day_before) не схлопываются; `renotify:true` осмыслен. Коллизий в текущих данных (теги сервера: `on_day`, `day_before`, `auto_skip`, `morning-summary`, `care_*`) нет.
8. **Контракты in-app уведомлений** — list/mark-read/mark-all/unread-count полностью совпадают с сервером (см. §3.7), включая `nextOffset`, 401→`/login` в списке (`notifications.jsx:145-148,307-310,337-340`), optimistic обновление и фолбэк-декремент (`:343-351`), защиту от повторной догрузки (`:286`) и фолбэк `unreadCount` при отсутствии поля (`:319`).
9. **Иконки/бейджи не 404:** `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png` существуют (`Frontend/public/icons/`), манифест ссылается на них (`manifest.json:14-33`), SW-дефолт и серверный дефолт совпадают (`pushService.js:36,50`; `sw.js:83-84`).
10. **Manifest/PWA-метаданные:** `start_url:/home`, `scope:/`, `display:standalone`, `maskable`-иконка, `apple-mobile-web-app-capable`, `theme-color` light/dark, `lang=ru` (`manifest.json:1-33`, `index.html:41-48`) — корректно.
11. **Админ-панель: защита от дублей и ошибок** — `sending` guard + `Idempotency-Key` + серверный dedupe/409 + понятный текст про «связь прервалась, не отправляйте повторно» (`AdminPushPanel.jsx:232-234,267-280,345-357`); отмена pending; `maxLength` совпадает с сервером; `aria-pressed/role=status/alert`.
12. **Страница уведомлений:** focus-visible для всех интерактивных элементов (`notifications.css:84-93`), `role=alert` у ошибок, `role=status` у загрузки, `aria-label` с количеством непрочитанных, `aria-hidden` у декоративной точки, `role=tablist` у фильтров (`notifications.jsx:399-466,484-521`).
13. **Обработка ошибок там, где это важно:** список уведомлений, read-all и включение push показывают ошибки пользователю (`notifications.jsx:172-177,290-295,320-325,376-379`); `getNotifications` не роняет главную (`homePage.jsx:155-157`); `fetchWithTimeout` применён к запросам notifications/home (`fetchWithTimeout.js:1-43`).
14. **Отсутствие XSS-стоков** и корректный рендеринг серверных строк через React (см. §3.9).
15. **Привязка подписки после логина/регистрации** — `reattachPush()` (`registration.jsx:110-121,157,193,210`) вызывается до навигации и связывает существующую браузерную подписку с аккаунтом; ошибка не блокирует вход. Разумный дизайн (не хватает лишь явной обработки 409).

---

## 5. Приоритетный план

### P0 — исправить до признания фичи рабочей (1–2 дня)
1. **C-02:** переименовать SVG-импорт в `home.jsx` и обращаться к `window.Notification.permission`; вернуть рабочий `restorePushSubscription()` на главной. Добавить unit-тест на «permission granted, subscription=null → subscribe вызван».
2. **C-01:** дать SW абсолютный `API_BASE` (сборка/константа), добавить обработку `pushsubscriptionchange` с `event.newSubscription/oldSubscription`, логировать и показывать локальное уведомление при неудаче.
3. **C-04:** добавить `/notifications` в `Frontend/htaccess` (rewrite `$1.html`) и в `prerender.mjs` `privateRoutes`; расширить `verify-routing.mjs` кейсом `/notifications → 200`, а `verify-build.mjs` — проверкой `notifications.html`.
4. **C-05:** отписывать endpoint при logout (или перепривязывать при login), различать 409 и показывать понятное действие; в `subscribeToPush` пробрасывать серверный `message`.
5. **C-03:** сверять `applicationServerKey` существующей подписки с серверным ключом и переподписываться при несовпадении; серверу — удалять/перепривязывать по 403 VapidPkHashMismatch.
6. **C-08/C-09:** обернуть push-запросы и `serviceWorker.ready` в таймауты (переиспользовать `fetchWithTimeout`/`waitForRegistration`), `reattachPush` не блокировать входом (или ограничить 3 с), ошибки `restore/sync` показывать в UI («не удалось связать подписку — повторить»).

### P1 — заметное качество продукта (3–5 дней)
7. **C-06/C-07:** `postMessage` SW→клиент (`notifications-changed`, `push-click`), обновление badge и списка без перезагрузки; `notificationId` → `PATCH /notifications/:id/read` при клике; фокус существующего окна без `navigate`, если URL совпадает.
8. **C-10:** precache `start_url` + ассетов app-shell; navigation fallback на `/`, а не `/404.html`; отдельный оффлайн-экран.
9. **C-11:** инструкции для denied (Chrome/Firefox/Safari/iOS), `disabled`-тумблер с пояснением; проверка `permission` при `visibilitychange`.
10. **C-12:** семантика `role="dialog"`, trap фокуса, Escape, `aria-live` для ошибки, `inert` для фона.
11. **C-13:** корректная локальная дата для timestamp-строк (`date.js`), тесты на 00:30 МСК / UTC.
12. **C-14/C-15/C-16/C-17:** single-flight + кэш синхронизации в профиле, success-состояние и retry на странице уведомлений, разделить `failed`/`declined`, привести флаг opt-out в порядок (или убрать).

### P2 — гигиена и UX-полировка (по мере)
13. **C-18/C-19:** ужесточить `readableUrl` (`/^\/[^/]/`), монохромный badge 72×72, `new URL` для клиентов, `catch` у `navigate`, обработка `event.action`, `notificationclose` (аналитика).
14. **C-20/C-21:** idempotency-ключ с `scheduledFor`+`adminId`; клиентская валидация URL/даты; пагинация получателей; 409 — информационный тон; retry обзора; не блокировать scheduled при `pushConfigured:false`.
15. **C-22:** не запрашивать `notification-preferences` на каждый pathname (один раз на сессию/пользователя или через контекст профиля); `401` в PATCH темы не считать успехом.
16. **C-23/C-24:** русский дефолтный title push, `requireInteraction` для критичных напоминаний, `updateViaCache`/заголовок для `sw.js`, PWA-badge (`setAppBadge`), убрать мёртвый `userId`-проп, поправить «Ранее / На этой неделе».
17. **Продуктовые решения вне клиента:** рассылки не создают in-app записей (`pushBroadcastService.js:144-150`), поэтому сообщение из push нельзя найти в центре уведомлений; `url` напоминаний всегда `/home` — нет deep-link к растению. Обсудить с командой бэкенда.
