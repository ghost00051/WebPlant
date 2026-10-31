# Админ-панель «Лейки» (admin.checktheplants.ru)

Автономная статическая панель: обычные HTML, CSS и ES-модули без сборки.
Содержимое этой папки выгружается в корень поддомена `admin.checktheplants.ru`
как есть — никаких `npm install`, `vite build` и Node.js на хостинге не нужно.
Данные панель берёт из API `https://server.checktheplants.ru/api` под
cookie-сессией администратора.

## Что внутри

```text
Frontend/admin/
├── index.html          точка входа
├── robots.txt          закрывает панель от индексации
├── .htaccess           HTTPS, CSP, запрет индексации, кэш
├── css/admin.css       тёмная и светлая темы, адаптив
└── js/
    ├── config.local.js настройки API (правится при выгрузке)
    ├── config.js       чтение настроек и константы
    ├── api.js          обёртка над fetch с cookie-сессией
    ├── format.js       форматирование чисел/дат, CSV-выгрузка
    ├── ui.js           таблицы, пагинация, модальные окна, тосты
    ├── charts.js       графики на SVG без внешних библиотек
    ├── app.js          вход, каркас, hash-маршруты
    └── views/          разделы: обзор, продукт, посетители, пользователи,
                        растения, поливы, фото, чат, боты, рассылки и сервер, ИИ
```

## Разделы панели

| Раздел | Что показывает | Что можно делать |
| --- | --- | --- |
| Обзор | посетители, просмотры, регистрации, растения, поливы, чат, фото, push, сессии; графики по дням, поливы по дням недели и часам, топы | — |
| Посетители | уникальные визиты, просмотры, новые и авторизованные посетители, устройства, страницы входа, источники | выгрузка CSV по дням |
| Пользователи | регистрация, растения, поливы, фото, сообщения, последняя активность; поиск, сортировка, пагинация | карточка пользователя, смена роли, удаление аккаунта со всеми данными |
| Растения | владелец, вид, интервал полива, счётчики, следующий полив, главное фото | удаление растения вместе с историей и фото |
| Поливы | журнал отметок «полив»/«пропуск», план и опоздание | удаление записи с пересчётом расписания |
| Фотографии | превью, владелец, растение, главное фото | удаление фото вместе с файлом на сервере |
| Чат с ИИ | история сообщений с автором и токенами | удаление сообщения или всей переписки |
| Боты | F16/F10: подключения Telegram/MAX, доставки и ошибки по дням, конверсия кодов привязки, доля напоминаний в мессенджерах, последние ошибки и команды, recap-доставки и серия ухода | — (только просмотр) |
| Рассылки и сервер | push-подписки, последние рассылки, `/health`, Redis, поды Kubernetes и контейнеры Docker | переход к созданию рассылки на основном сайте |

## Выгрузка на поддомен

1. В панели хостинга создайте поддомен `admin.checktheplants.ru` с корнем,
   например `/www/admin.checktheplants.ru`, и включите HTTPS (Let's Encrypt).
2. Скопируйте в этот корень **всё содержимое** `Frontend/admin/`, включая
   скрытый файл `.htaccess` (он задаёт HTTPS, CSP и запрет индексации).
   Убедитесь, что на хостинге включены `mod_rewrite`, `mod_headers`,
   `mod_deflate` и что `.htaccess` разрешён.
3. Откройте `https://admin.checktheplants.ru` и войдите под аккаунтом с
   `role = ADMIN`. Если вы уже авторизованы как администратор на основном
   сайте, панель откроется сразу — cookie выдаётся на домен
   `.checktheplants.ru`.

Проверка после выгрузки:

```bash
# панель отвечает и не индексируется
curl -I https://admin.checktheplants.ru
curl -s https://admin.checktheplants.ru/robots.txt
```

## Настройка backend

Панель — это отдельный origin, поэтому backend должен разрешить её запросы:

1. `Backend/.env`:

   ```env
   ADMIN_PANEL_ORIGIN=https://admin.checktheplants.ru
   ```

   Значение — origin без пути, можно перечислить несколько через запятую
   (например, добавив `http://localhost:5599` для локальной отладки).
   Домен админки намеренно не добавляется во `FRONTEND_URL`: этот список
   участвует в проверке passkey, и расширять его не нужно.

2. Примените миграцию — она добавляет дату регистрации пользователей и
   таблицу посещений:

   ```powershell
   # из корня репозитория, для compose-стека
   Get-Content .\Backend\migrations\20261012_create_admin_analytics.sql -Raw |
     docker-compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1'
   ```

   ```bash
   # либо напрямую
   psql -h "$DB_HOST" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" \
     -v ON_ERROR_STOP=1 -f Backend/migrations/20261012_create_admin_analytics.sql
   ```

3. Перезапустите backend:

   ```bash
   docker compose restart backend
   ```

4. Проверьте, что вход разрешён:

   ```bash
   curl -i -X OPTIONS https://server.checktheplants.ru/api/admin/analytics/overview \
     -H "Origin: https://admin.checktheplants.ru" \
     -H "Access-Control-Request-Method: GET"
   ```

   В ответе должен быть `Access-Control-Allow-Origin: https://admin.checktheplants.ru`.

Если миграцию ещё не применили, панель всё равно откроется: даты регистраций
будут считаться по согласиям (часть старых аккаунтов не попадёт в динамику),
а раздел «Посетители» покажет нули и предупреждение. Сервер при этом напишет в
лог, какую миграцию применить.

Раздел «Боты» использует таблицы и колонки из миграций
`20261101_create_bot_channels.sql` (боты) и `20261102_add_weekly_recap.sql`
(recap); пока они не применены, endpoint отдаёт `tablesReady:false`, а панель
показывает нули и подсказку применить миграции.

## Сбор статистики посещений

Посещения считает сам сайт: `POST /api/system/visit` вызывается один раз на
загрузку страницы и **только если посетитель дал согласие на аналитику**
(см. `Frontend/src/utils/visits.js`). Сохраняются случайный идентификатор
браузера, путь входа, хост перехода и тип устройства — IP не пишется.

Чтобы метрика заработала, нужно выгрузить обновлённый основной сайт
(`npm run build` в `Frontend` и выгрузка `dist`). Один посетитель в сутки —
одна строка, повторные открытия увеличивают счётчик просмотров. Данные
хранятся 400 дней и удаляются ежедневной очисткой вместе с остальными
задачами.

Пока сайт не обновлён (или посетители не принимают аналитику), ориентируйтесь
на цифры Яндекс.Метрики, а в панели смотрите активность пользователей по
данным приложения.

## Прочая настройка

Адрес API задаётся в `js/config.local.js`. Приоритет выше у параметров
адресной строки и `localStorage`:

```text
https://admin.checktheplants.ru/?api=https://server.checktheplants.ru/api
https://admin.checktheplants.ru/?api=http://localhost:5099/api&site=http://localhost:5173
```

Локальная отладка панели (backend поднят на `http://localhost:5099`):

```bash
cd Frontend/admin
npx --yes serve -l 5599 .
# либо: python -m http.server 5599
```

Затем откройте `http://localhost:5599/?api=http://localhost:5099/api` и
добавьте `http://localhost:5599` в `ADMIN_PANEL_ORIGIN` на backend.
Обычная cookie-сессия с боевого домена на `localhost` не переносится — войдите
логином и паролем администратора (на тестовой базе это безопасно).

Важно: `.htaccess` задаёт строгий `Content-Security-Policy`, где API и картинки
разрешены только с `server.checktheplants.ru`. Если вы меняете адрес API
(`js/config.local.js` или другой домен), добавьте его в `connect-src` и
`img-src` в `.htaccess`, иначе браузер заблокирует запросы.

## Безопасность

- Доступ есть только у аккаунтов с `role = ADMIN`: все маршруты `/api/admin/*`
  проходят через `requireAdmin`, роль проверяется на сервере, а не в браузере.
- Панель отдаётся с `X-Robots-Tag: noindex`, `X-Frame-Options: DENY`,
  строгим `Content-Security-Policy` и без inline-скриптов.
- Нельзя из панели удалить собственную учётную запись и снять права
  последнего администратора — такие запросы отклоняются с `400`/`409`.
- Удаление необратимо: пользователь удаляется вместе с растениями, поливами,
  фото, сообщениями, согласиями, сессиями и подписками; файлы фото удаляются
  с диска. Подтверждение требует ввода слова `УДАЛИТЬ`.
- Резервная копия базы и каталога `uploads` — обязательна перед массовыми
  удалениями.
- При желании закройте поддомен дополнительной Basic-авторизацией на уровне
  хостинга или ограничьте доступ по IP.

## Проверки при правках

```bash
cd Frontend
npm run verify:admin        # headless-прогон панели: 11 разделов, графики, оболочка
npx eslint admin src/utils/visits.js
npm test                    # unit-тесты, включая src/utils/visits.test.js

cd ../Backend
npm test                    # unit-тесты, включая utils/adminAnalytics.test.js
```

### Сквозная проверка админ-API

`Backend/scripts/admin-api-integration.mjs` проверяет все маршруты админки на
отдельной тестовой базе (94 проверки: аналитика, списки, поиск, удаление,
каскады, права и валидация). Подготовка описана в заголовке скрипта: поднимите
Postgres и Redis на свободных портах, запустите backend с `NODE_ENV=development`,
примените миграцию, затем:

```bash
node Backend/scripts/admin-api-integration.mjs seed
```

После seed повысьте тестового администратора и добавьте демо-данные:

```sql
UPDATE users SET role = 'ADMIN' WHERE email LIKE 'admin.a.%';

INSERT INTO chat_logs (user_id, session_id, role, text, metadata, created_at)
SELECT u.id, '11111111-1111-4111-8111-111111111111', 'user', 'Как поливать монстеру?', '{}'::jsonb, now() - interval '2 days'
FROM users u WHERE u.email LIKE 'user.b.%';

INSERT INTO plant_photos (plant_id, url, sort_order, is_main, metadata)
SELECT p.id, '/uploads/plants/' || md5(p.id::text) || '.jpg', 0, true, '{}'::jsonb
FROM plants p JOIN users u ON u.id = p.user_id WHERE u.email LIKE 'user.b.%';

INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
SELECT u.id, 'https://push.example.com/' || u.id, 'key', 'auth' FROM users u WHERE u.email LIKE 'user.b.%';

INSERT INTO user_cookie_consents (guest_token, consent_type, is_accepted, accepted_at, source, metadata)
VALUES ('guest-test', 'analytics', true, now(), 'banner', '{}'::jsonb);
```

Затем `node Backend/scripts/admin-api-integration.mjs verify`. Скрипт удаляет
тестовые аккаунты, поэтому запускайте его только на тестовой базе. При
повторных прогонах очищайте лимиты регистрации:
`docker exec ctp_admin_redis redis-cli FLUSHALL`.
