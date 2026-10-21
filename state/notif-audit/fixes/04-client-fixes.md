# 04-client-fixes. Реализация клиентских/SW/UX/routing-фиксов по аудиту task-4

**Задача:** task-8 · **Владелец:** client-auditor · **Дата:** 2026-10-19
**Источник:** `state/notif-audit/04-client.md` (аудит task-4), договорённости Team Lead и backend-агентов.
**Границы:** изменялись только файлы из write-scopes task-8. `Backend/`, `Frontend/package.json`, `api.js`, `App.jsx` не трогал; сборка (`npm run build`) не запускалась.

---

## 1. Что сделано (по пунктам аудита)

| Аудит | Статус | Изменения |
|---|---|---|
| **C-01** SW API base | ✅ | `pushNotifications.js`: `buildServiceWorkerUrl()` → регистрация `navigator.serviceWorker.register('/sw.js?api=' + encodeURIComponent(API_URL), { scope:'/' })`. `sw.js`: `resolveApiBase()` читает `?api` из `self.location.search`, валидирует протокол (http/https), фолбэк — same-origin `/api`. `API_BASE` используется в `pushsubscriptionchange` (GET vapid-key, POST subscribe/unsubscribe) и в `notificationclick` → `PATCH ${API_BASE}/notifications/{id}/read` (credentials include, best-effort). |
| **C-02** SVG `Notification` затенял DOM-глобал | ✅ | `home.jsx`: импорт переименован в `NotificationIcon` (2 использования в JSX обновлены), проверки — `window.Notification.permission`. Ветки `getActivePushSubscription` → `syncPushSubscription` / `restorePushSubscription` снова достижимы. Добавлены `cancelled`-флаги и очистка `promptTimer`. |
| **C-03** VAPID-ключ и 409 | ✅ | `subscribeToPush`: всегда получает/кэширует `vapid-public-key`, сравнивает `subscription.options.applicationServerKey` побайтно; при несовпадении — unsubscribe + subscribe с актуальным ключом. При POST 409 — отписывает старую браузерную подписку, пересоздаёт (новый endpoint) и повторяет POST один раз; серверное `message` пробрасывается в UI. Ошибки чтения `message` больше не теряются. |
| **C-04** logout/отписка | ✅ | `profile.jsx`: `exitOfProduct` перед `POST /users/logout` вызывает `unsubscribeFromPush()` с ограничением 3 с (`Promise.race`), ошибки игнорируются. `unsubscribeFromPush`: `serviceWorker.ready` с таймаутом, всегда делает локальный `subscription.unsubscribe()`, 401 больше не блокирует локальную отписку (сервер теперь optionalAuth). Флаг `push_device_opt_out` ставится только после локальной отписки и снимается при включении (профиль/страница уведомлений/prompt). |
| **C-05** notificationclick | ✅ | `sw.js`: при `data.notificationId` — mark-read через API_BASE; поиск клиента через `new URL(client.url).origin`, без `startsWith`; навигация только если URL отличается; `catch` с фолбэком на `openWindow`. |
| **C-06** badge sync по push | ✅ | `sw.js` после `showNotification` → `clients.matchAll` + `postMessage({type:'push-received', notificationId})`. `homePage.jsx` слушает `navigator.serviceWorker 'message'` и перезапрашивает `unread-count`; кнопка «Повторить» теперь обновляет и данные, и badge; 401 → `/login`; некорректный ответ не затирает текущий badge. |
| **C-07** таймауты/зависания | ✅ | `pushNotifications.js`: все push-fetch через `fetchWithTimeout` (10 с), `serviceWorker.ready` через `waitForRegistration(8 с)`; при отсутствии SW — понятная ошибка. `registration.jsx`: `reattachPush` не блокирует переход дольше 3 с (`waitAtMost`), добавлен guard `isPushDisabledOnThisDevice()`. Профиль больше не делает POST на каждом монтировании (используется `syncPushSubscription` с 24-часовым интервалом и флагом opt-out), ошибки sync выводятся в `pushError`. |
| **C-08** поверхность ошибок | ✅ | `readServerMessage()` — серверные тексты (400/409/429/503) доходят до UI; профиль показывает ошибку синхронизации подписки; страница уведомлений — success/error состояния и кнопка «Повторить подписку». |
| **C-09** offline PWA | ✅ | `sw.js`: `CACHE_NAME` → `ctp-v5`; precache `['/', '/home', '/plants', '/care', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/404.html']`; runtime cache: stale-while-revalidate для `/assets/*` и script/style/font/image, кэширование успешных навигаций; offline-fallback навигации: точный кеш → cached `/home` → cached `/` → `/404.html` (а не 404-страница вместо приложения). |
| **C-10** denied/a11y | ✅ | `NotificationPrompt.jsx`: `role="dialog"`, `aria-modal`, `aria-labelledby/aria-describedby`, автофокус, focus trap (Tab/Shift+Tab), Escape = явный отказ, `role="alert"` у ошибки, `aria-busy`; транзиентная ошибка подписки больше не помечается `declined` (cooldown только при явном «Не сейчас»/Escape). `notifications.jsx`: при `denied` — пошаговая инструкция (iOS: Настройки → Уведомления → Лейка; браузер: замок/«Настройки сайта») + кнопка «Проверить снова». `profile.jsx`: аналогичная инструкция, тумблер разблокировки запрещён при `denied`. |
| **C-11** date.js | ✅ | `toDate()` для `YYYY-MM-DD` по-прежнему трактует строку как календарную дату (без TZ); для ISO-строк со временем (`new Date(value)` валиден) берётся локальный Y/M/D, что исправляет группировку «Сегодня/Вчера» в ночные часы. Нестандартные строки — прежний фолбэк по дате. Добавлен `Frontend/src/utils/date.test.js` (7 тестов, включая 00:30 по local и date-only регрессию). |
| **C-12** readableUrl | ✅ | `notifications.jsx`: отбрасываются не-строки, `//host`, `/\host`; фолбэк `/home`. |
| **C-13** админ-панель | ✅ | `AdminPushPanel.jsx`: Idempotency-Key = `crypto.randomUUID()` на попытку, стабилен при ретрае после сетевой ошибки с теми же полями (`attemptSource` включает `scheduledFor`), сбрасывается после успеха/валидационной ошибки/409; 409 показывается как информационное сообщение; кнопка «Повторить» для `failed`-рассылки (`POST /broadcasts/:id/retry`), при 404/501 кнопки скрываются; пагинация получателей «Показать ещё» (`limit=50`, `offset`, дедупликация, «загружено X из Y»); retry-кнопка при ошибке overview; вывод `removed_count`/`quarantined_count` в последних рассылках и `quarantined`/partial в результате отправки; submit больше не блокируется навсегда при ошибке overview. |
| **C-14** ThemeContext | ✅ | Запрос `notification-preferences` выполняется один раз за приватную сессию (ref-guard; refetch только после public↔private перехода или ошибки), а не на каждый `location.pathname`; 401 в `setThemePreference` теперь ошибка (тема не «сохраняется» ложно), а не `return true`. |
| **C-15** /notifications routing | ✅ | `Frontend/htaccess`: `/notifications` добавлен в 301-редирект `.html`, в исключение правила «чужой .html → 404» и в rewrite `^(...|notifications)/?$ $1.html`; `prerender.mjs`: `notifications` в `privateRoutes` (создаёт `notifications.html`); `verify-routing.mjs`: кейс `/notifications → 200`. |

Дополнительно: `sw.js` — дефолтный заголовок push теперь «Лейка» (вместо «CheckThePlants»), `timestamp` для сортировки OS-уведомлений; `pushsubscriptionchange` использует `event.newSubscription`, если браузер его отдаёт, и best-effort удаляет старый endpoint; `notifications.jsx` — при включении push снимается opt-out и показывается success-состояние. `main.jsx` менять не потребовалось: URL SW формируется внутри `registerServiceWorker()`.

---

## 2. Изменённые файлы (все — из write-scopes task-8)

```
Frontend/public/sw.js
Frontend/src/utils/pushNotifications.js
Frontend/src/utils/date.js
Frontend/src/utils/date.test.js                      (новый)
Frontend/src/component/home/home.jsx
Frontend/src/component/homePage/homePage.jsx
Frontend/src/component/notifications/notifications.jsx
Frontend/src/component/NotificationPrompt/NotificationPrompt.jsx
Frontend/src/component/profile/profile.jsx
Frontend/src/component/registration/registration.jsx
Frontend/src/component/adminPush/AdminPushPanel.jsx
Frontend/src/context/ThemeContext.jsx
Frontend/htaccess
Frontend/scripts/prerender.mjs
Frontend/scripts/verify-routing.mjs
state/notif-audit/fixes/04-client-fixes.md           (этот файл)
```

---

## 3. Проверки и результаты

| Команда | Результат |
|---|---|
| `cd Frontend && npm run lint` | `eslint .` — **exit 0**, ошибок/предупреждений нет (весь Frontend, включая затронутые файлы). Baseline-ошибок не возникло. |
| `cd Frontend && npm test` | `node --test "src/**/*.test.js"` — **7/7 pass**, 0 fail (новый `date.test.js`). |
| `node --test src/utils/date.test.js` с `TZ=America/New_York` и `TZ=Asia/Tokyo` | **7/7 pass** в обеих зонах (проверена независимость от TZ). |
| `node --check Frontend/public/sw.js`, `.../pushNotifications.js`, `.../date.js` | exit 0 (синтаксис). |
| `npx eslint` по всем изменённым frontend-файлам | exit 0. |
| `node scripts/verify-routing.mjs /notifications` | в текущем (непересобранном) `dist` — 404, т.к. `notifications.html` создаётся только `npm run build` (prerender). С временным стабом `dist/notifications.html`: **`/notifications → 200 (отдаётся notifications.html)`**, `/notifications/ → 200`, `/notifications.html → 301 → /notifications`; стаб удалён. |
| Полный `node scripts/verify-routing.mjs` | с временными стабами отсутствующих prerender-файлов (в `dist` нет ни `home.html`, ни `plants.html` и т.п.) — **«Все 48 проверок маршрутизации пройдены»**; временные файлы удалены. Без сборки полный прогон не проходит по объективным причинам (dist не содержит prerender-артефактов), к моим правилам это не относится. |
| `npm run build` | **не запускался** (по указанию Lead). |

**Важно для Lead:** чтобы `/notifications` отдавался в реальном деплое, нужен `npm run build` (prerender создаст `notifications.html`) и выгрузка обновлённого `Frontend/htaccess` (в `dist/.htaccess` копируется на шаге prerender). До сборки проверка живого сайта даст 404.

---

## 4. Остаточные риски и что осталось за рамками

1. **SW API base**: валидируется только протокол; абсолютный URL передаётся при регистрации и не контролируется пользователем. Если `API_URL` в проде будет пустым/неверным — SW деградирует к same-origin `/api` (для текущего деплоя это 404, как и раньше).
2. **VAPID key compare**: некоторые браузеры могут не отдавать `subscription.options.applicationServerKey`; в этом случае подписка считается валидной (ротация на таких клиентах не детектится — но и `pushsubscriptionchange` остаётся основным механизмом, который теперь работает).
3. **409-перепривязка** создаёт новый endpoint; старый endpoint в БД остаётся до 410-очистки (сервер удаляет такие подписки при отправке).
4. **Badge sync** зависит от обновления SW: старые закешированные SW не шлют `postMessage` до активации новой версии (`ctp-v5`); после установки новой версии — работает. При закрытом приложении badge обновится при следующем открытии/фокусе.
5. **Mark-read по клику на push** — best-effort: при офлайне/401 отметка не произойдёт, unread останется; сам клик всё равно откроет приложение.
6. **`/notifications`**: маршрут теперь есть в htaccess/prerender/verify-routing, но реальная проверка возможна только после сборки (см. §3). `App.jsx` и package.json не менялись.
7. **Админ-панель**: серверный лимит получателей — 200 за запрос/страницу; клиент грузит по 50, «Показать ещё» ограничен серверным `MAX_RECIPIENTS_LIMIT` (offset/limit сервер принимает). Retry-эндпоинт сервером поддержан; при 404/501 кнопка скрывается gracefully.
8. **Idempotency-Key**: при сетевой ошибке ключ переиспользуется только для идентичного набора полей; если админ поменяет текст/время — это осознанно новая отправка (новый ключ). Серверный CORS-заголовок для `Idempotency-Key` добавляет Lead — до этого preflight может отклонять заголовок в проде (клиент его отправляет).
9. **date.js** меняет трактовку timestamp-строк во всех местах использования `toDate`; date-only строки не изменились; тесты покрывают оба случая. Потенциально изменится отображение «Вчера/Сегодня» только там, где раньше был UTC-сдвиг (это и есть целевой фикс).
10. **Не входило в task-8 / осталось**: создание in-app записей для рассылок, deep-link к растению из push, app badge (`setAppBadge`), полная a11y-панель админки; это продуктовые решения вне клиентского write-scope.
