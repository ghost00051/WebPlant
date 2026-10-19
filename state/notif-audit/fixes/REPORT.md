# Аудит деплоя 449e904 и подсистемы уведомлений

**Дата:** 2026-10-19, ~11:28–11:40 UTC (14:28–14:40 MSK)
**Хост:** SERVER (192.168.0.103), docker-desktop context, namespace `webplant`
**Образ:** `webplant-backend:1.2.6-449e904-dirty-62ea832c`
**Аудитор:** независимая проверка по чек-листу из 12 пунктов, read-only + два согласованных изменения

---

## 1. Короткий вердикт

**Деплой k8s корректен.** Все 12 пунктов по k8s/приложению проходят: нужный коммит и образ, 1 под Running без рестартов, схема БД и все 4 индекса на месте (unique-индекс идемпотентности реально UNIQUE и проверен в транзакции с откатом), Redis и распределённый лок работают, API-smoke 33/33, юнит-тесты 195/195, nginx/gateway отдают 200/200/401.

**Что не так — два дефекта высокой важности, и оба не в коде k8s, а вокруг него:**

1. **Реальные дубли push из старого compose-стека.** 7 из 8 push-подписок `ctp-БД` имеют *тот же самый endpoint*, что и в k8s; пользователи одни и те же. Сегодня в 06:00 **оба** стека отправили `morning_summary` одним и тем же людям, плюс `ctp_backend` в 07:50 отправил 2 `watering_due`. То есть люди получали по два одинаковых уведомления. → `ctp_backend` остановлен (с вашего подтверждения), HTTP-трафик он не обслуживал.
2. **Пункт 6 чек-листа сам отправил реальный push 9 устройствам.** DO-блок из инструкции коммитится, создаёт `status='pending'` рассылку, и `PushBroadcastJob` (cron, раз в минуту) честно её доставил: broadcast `id=15`, `title='verify'`, `body='verify'`, `target_mode=all`, `sent_count=9`, `sent_at=08:59:02`. Это уже произошло в 08:58–08:59 сегодня, до меня. Мой прогон был обёрнут в `BEGIN/ROLLBACK` и следов не оставил.

Плюс три дефекта средней важности в самой процедуре проверки (пункт 8 не запускается как написано; откат `docker compose up -d backend` опасен на текущем грязном compose-файле; в `Backend/backups` лежит дамп 0 байт).

---

## 2. Таблица проверок

| # | Проверка | Результат | Команда | Ключевой вывод |
|---|----------|-----------|---------|----------------|
| 1 | Состояние кода | ⚠️ OK с оговоркой | `git rev-parse HEAD` / `git status --short` | HEAD `449e90429e53d45f8b80c87745a9f0bdd89ee954`, ветка `Development` — совпадает. Но рабочее дерево **грязное**: изменены `docker-compose.yml`, `docker-compose.pgadmin.yml`, добавлены `nginx/Dockerfile`, `nginx/conf.d/pgadmin*.conf`, `Backend/PGADMIN.md`, `scripts/enable-pgadmin-tls.ps1` (плюс 2 удалённых старых бэкапа — это норма). Отсюда и `-dirty` в теге образа — тег честный |
| 2 | Под и образ | ✅ OK | `kubectl get pods -n webplant -o wide`; `kubectl get deploy backend -o custom-columns=...` | `backend-75fbc88dc-zcfdh` 1/1 Running, **0 рестартов**, 161 мин, узел `desktop-worker2`, образ `webplant-backend:1.2.6-449e904-dirty-62ea832c` (не `95407a8`). В логах `⏰ ReminderService запущен: напоминания/сводка/советы — отдельные 10-минутные задачи с раздельными локами Redis`, `✅ Схема production-базы проверена`; нет `Database schema is missing`, нет VAPID-ошибок, нет крэшей |
| 3 | Health | ✅ OK | `kubectl exec … node -e "fetch('http://127.0.0.1:5000/health')…"` | `{"status":"ok","deployTarget":"kubernetes","redis":"ok","mail":"configured","push":{"configured":true,"valid":true,"error":null},"backgroundJobs":true,…}` — ровно ожидаемое |
| 4 | Схема БД | ✅ OK | `information_schema.columns` / `pg_indexes` для `^push_` | Все 14 колонок: `push_subscriptions.last_success_at, last_error, failed_attempts, invalidated_at, invalid_reason`; `push_broadcasts.idempotency_key, started_at, updated_at, last_processed_id, chunk_size`; `push_broadcast_recipients.status, attempts, sent_at, last_error`. Все 4 индекса: `idx_push_broadcasts_idempotency`, `idx_push_subscriptions_invalidated_at`, `idx_push_broadcasts_status_updated`, `idx_push_broadcast_recipients_status` (+ `idx_push_broadcast_recipients_unique`). `idx_push_broadcasts_idempotency` — **UNIQUE … WHERE idempotency_key IS NOT NULL** |
| 5 | Данные и риск дублей | ✅ OK | `SELECT status, count(*) FROM push_broadcasts GROUP BY status` | `sent=14`, **0 `pending`/`sending`**, `push_subscriptions=10`, `notifications=54`, `invalidated=0`. Зависших рассылок нет, досылать после деплоя нечего |
| 6 | Unique-индекс идемпотентности | ✅ OK | `BEGIN; DO $$…$$; ROLLBACK;` (см. `09-unique-index-test-SAFE.sql`) | `NOTICE: unique index OK`, `trace_rows_inside_tx=1`, `trace_rows_after_rollback=0`, `pending_or_sending_now=0`. Индекс работает, следов не осталось. ⚠️ Вариант DO-блока **из инструкции** без `BEGIN/ROLLBACK` оставляет коммит — см. дефект D2 |
| 7 | Redis и распределённый лок | ✅ OK | `node -e "…withDistributedLock('verify:notif:lock',{ttlMs:5000},…)"`; `redis-cli ping` | `{"ran":true,"result":"ok","degraded":false}`, выход за 2.5 с, exit 0. `redis-cli ping` → `PONG`, `dbsize` → 70 |
| 8 | API-smoke уведомлений | ✅ OK (33/33) | `DB_NAME=webplant_notif_smoke_verify node _notif_smoke.mjs` | `33/33 checks passed`, ни одного ✖: список/пагинация/фильтры/reлевантность 400/401/404, идемпотентность `PATCH /:id/read`, `read-all`, каскад при удалении юзера. Временная БД создана и удалена самим скриптом, после прогона `webplant_notif_smoke%` в `pg_database` нет. ⚠️ Запускается не «как написано» — см. дефект D3 |
| 9 | Юнит-тесты backend | ✅ OK | `cd Backend; node --test` | `tests 195`, `pass 195`, `fail 0`, `cancelled 0`, `skipped 0`, 22.3 с, node v24.14.1, exit 0. `node_modules` уже был |
| 10 | API через nginx/gateway | ✅ OK | 4 curl-проверки | localhost:443 с `Host: server.checktheplants.ru` → health JSON ok; `127.0.0.1:8090/health` → тот же JSON; публичный `/health` → **200**; `/api/notifications` без cookie → **401** (норма). DNS/TLS/порты в порядке, сертификаты не трогал |
| 11 | Старый compose-стек | ❌ FAIL | `docker logs ctp_backend`; `psql` по `ctp_postgres/WebPlant` | Не тестовые данные: 10 users / 8 subs / 19 notifications, напоминания создаются **сегодня**. 7 из 8 endpoint'ов совпадают с k8s → дубли. Подробно D1. `ctp_backend` остановлен |
| 12 | Наблюдаемость после проверок | ✅ OK | `kubectl get pods`; `kubectl logs deploy/backend --tail=60` | Под тот же, 0 рестартов, `1 ready / 1 total`. В логах свежие `reminderTick` / `morningSummaryTick` / `careAdviceTick` (60–250 мс), нет schema/VAPID-ошибок, нет зависших рассылок (`pending_or_sending=0`) |

---

## 3. Найденные дефекты

### D1 — HIGH. Дубли push из старого compose-стека (подтверждено, уже влияло на людей)

`ctp_backend` (образ `backend-backend`, старый код, Up 3 дня, `production`) продолжает крутить `ReminderService.tick()` каждые 10 минут и рассылать push по своей БД `WebPlant`, где лежат **те же реальные пользователи и те же устройства**, что в k8s.

Доказательства:

```
# 7 из 8 push-подписок compose имеют ТОТ ЖЕ endpoint, что и в k8s
$ docker exec ctp_postgres psql -U postgres -d WebPlant -tAc "SELECT md5(endpoint) FROM push_subscriptions ORDER BY 1;"
$ echo 'SELECT md5(endpoint) FROM push_subscriptions ORDER BY 1;' | kubectl exec -i -n webplant postgres-0 -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
→ compose 8, k8s 10, ИДЕНТИЧНЫХ 7 (см. 15-endpoint-overlap.txt)
```

```
# один и тот же пользователь, одно и то же утро, ОБА стека
k8s:     d3d234958b89d7b7e40637cfcd376779|morning_summary|10-19 06:00
compose: d3d234958b89d7b7e40637cfcd376779|morning_summary|10-19 06:00
k8s:     11c6b418c7c8426008c2f6c6408c03dc|morning_summary|10-19 06:00
compose: 11c6b418c7c8426008c2f6c6408c03dc|morning_summary|10-19 06:00
# и поливы: k8s 05:50/06:00, compose 07:50 — та же вода, два push
```

```
$ docker logs ctp_backend | Select-String 'Итого|push.apple'
✅ 1/2 — https://web.push.apple.com/QJ2LQDPkYMDU1bZmBwnjivY...
✅ 2/2 — https://web.push.apple.com/QHiVd-LyUFvwnA6YmcslieG...
📊 Итого: 2 отправлено, 0 ошибок, 0 удалено      ← и так каждые 10 минут
```

Почему это безопасно было выключить: `ctp_nginx` проксирует **только** на `ctp_k8s_gateway:8090` (`set $k8s_backend "ctp_k8s_gateway:8090";`, 3 `proxy_pass`, ни одного на `ctp_backend`). То есть старый бэкенд не обслуживает ни одного HTTP-запроса — только cron. Покрытие не теряется: все 7 пользовательских подписок compose уже есть в k8s (те же endpoint'ы), а единственная «compose-only» подписка — **гостевая от 2026-09-11** (`user_id IS NULL`), k8s такие чистит.

### D2 — HIGH. Пункт 6 чек-листа отправляет реальный push реальным людям

Инструкция: «Проверка unique-индекса идемпотентности (только внутри транзакции, без следов)» — но приведённый DO-блок **не** внутри транзакции. Отдельный `DO` — это одно предложение, оно **коммитится**, и первый `INSERT` остаётся жить как `status='pending'`. `PushBroadcastJob` крутится каждую минуту, берёт `pending` и рассылает.

Это уже случилось (не мной):

```
$ SELECT id,title,target_mode,status,total_subscriptions,sent_count,sent_at FROM push_broadcasts WHERE id=15;
 id | 15
title | verify
body  | verify
target_mode | all
status | sent
total_subscriptions | 9
sent_count | 9
last_processed_id | 12
created_at | 2026-10-19 08:58:05.409925+00     ← через 2 мин после старта пода (08:56:20)
sent_at    | 2026-10-19 08:59:02.929+00        ← cron дослал
```

Совпадает с логами старта пода:

```
📢 Push-рассылки: 1 к отправке, 1 завершено, 0 с ошибкой, 0 восстановлено (stale > 10 мин)
📊 push: отправлено 9, ошибок 0, удалено 0, карантин 0 (всего 9)
```

**Итог: 9 реальных подписок получили push с заголовком «verify» и текстом «verify».** Запись `id=15` я оставил (это улика, удалять данные нельзя); она `sent`, повторно ничего не отправит. Мой прогон: `BEGIN; DO…; ROLLBACK;` → `trace_rows_after_rollback=0`.

Безопасный вариант — `09-unique-index-test-SAFE.sql` (транзакция + случайный ключ + откат + контрольные `SELECT`).

### D3 — MEDIUM. Пункт 8 не выполняется в том виде, как записан

Три отдельные проблемы:

1. `_notif_smoke.mjs` **исключён из образа** намеренно — он перечислен в `Backend/.dockerignore`. В поде его нет: `ls: /app/_notif_smoke.mjs: No such file or directory`. Команда `node _notif_smoke.mjs` даёт MODULE_NOT_FOUND.
2. Инструкция сначала делает `createdb`, а скрипт в начале проверяет, что БД **не существует**, и иначе падает: `Database … already exists — refusing to touch it`. Правильно наоборот: дать скрипту создать и удалить БД самому (он это делает: `CREATE DATABASE` + `DROP DATABASE … WITH (FORCE)` в `finally`).
3. После успешного завершения скрипт **не выходит** (нет `process.exit`) — открытое соединение Redis держит event loop. У меня он напечатал `33/33 checks passed`, удалил БД и продолжал висеть; пришлось снимать (`job_kill`). Для CI это таймаут.

Как я обошёл, не меняя образ: передал файл в контейнер base64-аргументом в `/app/_notif_smoke.mjs`, прогнал, **удалил** (`ls` подтверждает отсутствие). Контроль целостности по md5 совпал (`21e09daa657e9ece728e0748c88c4953`).

Рекомендация: либо убрать `_notif_smoke.mjs` из `.dockerignore`, либо монтировать его ConfigMap'ом, либо запускать `node --input-type=module -` со stdin. И добавить `process.exit(failed.length ? 1 : 0)`.

### D4 — MEDIUM. Штатный откат из инструкции опасен на текущем рабочем дереве

Инструкция предлагает откат `docker compose up -d backend` из `C:\Dev\WebPlant\Backend`. Но `docker-compose.yml` **изменён и не закоммичен**, и в диффе:

* у `postgres` убран `ports: 127.0.0.1:5433:5432`;
* у `nginx` теперь `build: ./nginx` (образ `ctp_nginx:local`) вместо `image: nginx:alpine`;
* `certbot_conf` переехал с bind-mount на **named volume** `backend_certbot_conf`;
* добавлена сеть `pgadmin_net` (`internal: true`).

`docker compose up -d backend` подтягивает зависимости и может пересоздать `postgres`/`nginx` с другим набором volume'ов — это риск для данных и TLS. **Безопасный откат: `docker start ctp_backend`** (тем же контейнером/образом/конфигом, compose-файл не перечитывается).

### D5 — MEDIUM. В `Backend/backups` лежит дамп на 0 байт

```
k8s_before_notif_deploy_20261019_114345.dump   0 байт
```

Кто-то (11:43:45 сегодня) решил, что сделал бэкап перед изменениями, а файл пустой. Мой дамп: `verify_before_changes.dump` — 331 009 байт, маркер `PostgreSQL database dump complete` на строке 3021, `CREATE TABLE public.push_broadcasts` на строке 703. Совет: в процедуру добавить проверку `(Get-Item $f).Length -gt 0` и наличие маркера завершения.

### D6 — LOW. В compose-стеке Redis таймаутит, и задачи идут без лока

```
⚠️ Блокировка «job:push-broadcast» недоступна (Redis command timed out); выполняю задачу без распределённого лока
⏳ Задача «job:push-broadcast» уже выполняется другим экземпляром — пропускаю
```

То есть дедупликация старого стека ненадёжна: при таймауте он сознательно деградирует до работы без лока. После остановки `ctp_backend` неактуально, но `ctp_redis` стоит проверить (он `Up 3 days (healthy)`).

### D7 — LOW. Для `target_mode='all'` нет пер-получательской истории

`push_broadcast_recipients` заполняется **только** при `targetMode === 'users'` (`pushBroadcastService.createBroadcast`). У broadcast `id=15` (`all`) строк получателей — 0, есть только агрегат `sent_count=9`. Для рассылки «всем» нельзя ответить «кто именно получил / кому не дошло», и нельзя дослать только недоставленным. Для аудита уведомлений это пробел в наблюдаемости.

### D8 — INFO. `ctp_backend` с `restart: always` вернётся после перезапуска Docker

```
RestartPolicy=always
```

`docker stop` переживает обычную работу, но после рестарта Docker Desktop контейнер поднимется снова — и дубли вернутся. Чтобы закрепить: `docker update --restart=no ctp_backend`. Я этого **не** делал (вне согласованного объёма) — команда за вами.

---

## 4. Что исправил

### Изменение 1 (согласовано с владельцем): остановлен старый compose-бэкенд

```
$ docker stop ctp_backend
ctp_backend
→ State=exited ExitCode=137 FinishedAt=2026-10-19T11:36:43Z
```

`ExitCode=137` = SIGKILL после 10-секундного grace: старое приложение не обрабатывает SIGTERM. На работу это не влияет (трафика у него нет), но graceful shutdown в старом коде отсутствует.

Проверка после остановки: публичный `/health` → **200**, `/api/notifications` → **401**, gateway `:8090/health` → **200**, поды k8s не изменились (0 рестартов), `pending_or_sending=0`, новых строк в логе `ctp_backend` нет.

**Бэкап перед изменением (compose):** `C:\Dev\WebPlant\Backend\backups\compose_WebPlant_before_pause_20261019.dump` — 172 372 байта, маркер завершения на строке 2400.

**Откат:** `docker start ctp_backend` (не `docker compose up -d backend` — см. D4).

### Изменение 2: бэкап k8s-БД (страховка, изменений в БД не вносил)

`C:\Dev\WebPlant\Backend\backups\verify_before_changes.dump` — 331 009 байт, дамп полный (маркер завершения + DDL `push_broadcasts`).

### Чего я НЕ делал

* Ничего не коммитил и не пушил; рабочее дерево осталось как было (плюс мой дамп и папка отчёта).
* Не удалял данные из k8s-БД и compose-БД; broadcast `id=15` оставлен как улика.
* Не менял образ, не пересобирал, не трогал фронтенд, сертификаты, Secret'ы; `.env`/VAPID/пароли не читал и не печатал (в выводе только замаскированный `redis://***@redis:6379/0`).
* Единственная запись в контейнер (временный `/app/_notif_smoke.mjs`) удалена, временная БД удалена.
* Удалил только свой собственный черновик `06-unique-index-test.sql` — небезопасную копию DO-блока, чтобы её случайно не выполнили; вместо него `09-unique-index-test-SAFE.sql`.

---

## 5. Остаточные риски и ручные проверки

**Остаточные риски:**

1. **После рестарта Docker Desktop `ctp_backend` вернётся** (`restart: always`) и дубли возобновятся. Одна команда: `docker update --restart=no ctp_backend`.
2. В compose-БД по-прежнему лежат реальные пользователи и рабочий старый код (`backend-backend`). Поднять его = вернуть дубли. Данные можно вычистить/заморозить отдельной задачей.
3. В prod-БД осталась рассылка `id=15` (`verify`, `sent`). Она безопасна, но если кто-то снова выполнит DO-блок из старой инструкции — уйдёт ещё один push 9 устройствам. Использовать только `09-unique-index-test-SAFE.sql`.
4. `docker-compose.yml` в рабочем дереве изменён и не закоммичен, `ctp_nginx` собран из `./nginx` (конфиг запечён в образ). Правка `nginx/conf.d` без пересборки образа не применится — это неочевидно для следующего дежурного.
5. Для `target_mode='all'` нет пер-получательской истории (D7) — аудит «дошло/не дошло» по таким рассылкам невозможен.
6. Фронтенд на FTP (`checktheplants.ru`) я не проверял — вне этой машины; SW/`/notifications` на реальном устройстве не тестировал.

**Проверить вручную со стороны пользователя:**

1. **Push на реальном устройстве.** После 06:00 MSK следующего дня `morning_summary` должен прийти **один раз** (раньше приходил дважды). Проверить на iPhone/Safari из `web.push.apple.com` — там больше всего подписок.
2. **Админ-рассылка из браузера** на `target_mode='users'` (2–3 юзера): должна появиться одна запись `push_broadcasts` + строки в `push_broadcast_recipients` со `status='sent'`, `attempts>=1`. Заодно проверить идемпотентность: повторный сабмит с тем же `idempotencyKey` не должен создать вторую рассылку.
3. **F5 на `/notifications`.** Лента, бейдж непрочитанных, «отметить прочитанным» и «прочитать все» — логика покрыта smoke'ом (33/33 на изолированной БД), но в браузере с реальными данными стоит глазами проверить, что счётчик не «прыгает» и нет дублей в списке.
4. После ближайшего рестарта Docker Desktop — убедиться, что `ctp_backend` не поднялся (`docker ps`), либо заранее `docker update --restart=no ctp_backend`.

---

## 6. Артефакты

Все в `C:\Dev\WebPlant\state\notif-audit\fixes\`:

| Файл | Содержимое |
|------|------------|
| `02-backend-logs-full.txt` | Полный лог пода (167 строк, от старта: Redis, схема, cron, push-сводки) |
| `01-backend-logs-tail80.txt` | Хвост лога на момент проверки |
| `03-health.txt` | JSON `/health` изнутри пода |
| `04-schema-columns.txt`, `05-schema-indexes.txt` | Колонки и индексы `push_*` |
| `06-data-counts.txt` | Статусы рассылок, счётчики |
| `09-unique-index-test.txt` | `NOTICE unique index OK` + откат без следов |
| `09-unique-index-test-SAFE.sql` | **Безопасный** вариант проверки индекса (транзакция + откат) |
| `07-distributed-lock.txt` | `{"ran":true,"result":"ok","degraded":false}` |
| `08-notif-smoke.txt` | API-smoke, 33/33 |
| `12-unit-tests.txt` | `node --test`, 195/195 |
| `10-broadcasts-detail.txt`, `11-broadcast15-recipients.txt` | Все рассылки; broadcast `id=15` (`verify`) |
| `15-endpoint-overlap.txt` | 7 идентичных endpoint'ов compose↔k8s |
| `16-duplicate-evidence.txt` | Дубли `morning_summary`/`watering_due` по одному пользователю |
| `13-docker-ps.txt`, `14-ctp-backend-logs.txt` | Состояние compose-стека до остановки |
| `17-post-fix-verification.txt` | Проверка после `docker stop ctp_backend` |
| **`REPORT.md`** | Этот отчёт |

Бэкапы: `C:\Dev\WebPlant\Backend\backups\verify_before_changes.dump` (331 009 B),
`C:\Dev\WebPlant\Backend\backups\compose_WebPlant_before_pause_20261019.dump` (172 372 B).

---

## 7. Второй проход: все дефекты закрыты

Полный доступ получен, исправлено всё, кроме D7 — там сознательно не менял
семантику доставки (объяснение ниже). Ничего не закоммичено, HEAD остался
`449e904`.

| Дефект | Что сделано | Чем проверено |
|--------|-------------|---------------|
| **D1 + D8** восстановление старого стека | `docker update --restart=no ctp_backend` — контейнер больше не поднимется сам после рестарта Docker Desktop | `docker inspect` → `State=exited RestartPolicy=no` |
| **D2** опасный DO-блок | Проба идемпотентности стала частью `Backend/scripts/verify-notifications.ps1`: явные `BEGIN … ROLLBACK`, случайный ключ, контрольные `SELECT` «следов нет» / «очередь пуста». Предупреждение добавлено в `Backend/k8s/README.md` | прогон скрипта: `unique index OK`, `trace_rows_after_rollback=0`, `pending_or_sending_now=0` |
| **D3** smoke-тест | `_notif_smoke.mjs` теперь завершается через `process.exit(…)` (раньше висел на открытом Redis-соединении); в `.dockerignore` появилось объяснение, почему файла нет в образе и как его запускать; раннер сам кладёт файл в под, сверяет md5, гоняет под `timeout -s KILL` и удаляет в `finally` | прогон: `smoke-скрипт доставлен (md5 …)`, `smoke: 33/33 проверок, exit 0`, `smoke-скрипт удалён из пода`, `одноразовых БД не осталось` |
| **D4** опасный откат | «Остановить лишний стек» дополнено в `Backend/k8s/README.md`: возврат — `docker start ctp_backend`, пересборка — `up -d --build --no-deps backend`, и почему `up` без `--no-deps` рискует postgres/TLS. `Backend/restart.txt` переписан: было `docker-compose up -d --build backend` | текст ревьюится в диффе |
| **D5** дамп 0 байт | файл переименован в `k8s_before_notif_deploy_20261019_114345.dump.ZERO-BYTE-INVALID` (не удалён: это улика) | в `Backend/backups` теперь только валидные дампы + явно помеченный битый |
| **D6** таймауты Redis | проверен `ctp_redis`: `PONG`, `rejected_connections=0`, `blocked_clients=0`, `connected_clients=1`. Серверного дефекта нет — таймауты были клиентской стороной под нагрузкой старого бэкенда; ушли вместе с ним | `redis-cli info clients/stats` |
| **D7** нет пер-получательской истории у `all` | **не менял поведение**: аудитория `all` берётся из `push_subscriptions` по дизайну, а `push_broadcast_recipients` — трекинг явных списков. Записал ограничение в `Backend/k8s/README.md`; «кому дошло» по массовой рассылке видно только `sent_count` | раздел «Проверка подсистемы уведомлений» в README |

**Новый файл:** `Backend/scripts/verify-notifications.ps1` — заменяет ручные
команды пунктов 6 и 8. Совместим с Windows PowerShell 5.1 (как остальные
скрипты репозитория), с BOM в UTF-8, иначе 5.1 не разбирает кириллицу.

```powershell
powershell -File Backend/scripts/verify-notifications.ps1
```

**Побочная находка при разработке скрипта.** Первая версия проверки после
отката искала строки по префиксу `verify-unique-%` и упала на
`trace_rows_after_rollback=1` — это была ровно та историческая строка
`verify-unique-key` (broadcast `id=15`) из инцидента 08:58, а не след пробы.
Проверка переведена на точное сравнение по сгенерированному ключу. Заодно это
ещё раз подтвердило, что запись `id=15` в базе реальна и остаётся.

**Финальное состояние после всех правок:**

* `git rev-parse HEAD` → `449e904…` (без изменений, коммитов нет);
* `ctp_backend` → `State=exited`, `RestartPolicy=no`;
* поды: `backend` 1/1 Running **0 рестартов**, `postgres-0` 1/1, `redis` 1/1;
* `curl /health` → **200**, `/api/notifications` без cookie → **401**;
* `node --test` → **195 pass / 0 fail** (повторно после правок);
* БД: `push_broadcasts` = `sent|14`, `tx_probe_rows=0`, `leftover_smoke_db=0`,
  `verify_row=1` (это `id=15`, помечена `sent`, повторно ничего не отправит);
* в поде `/app/_notif_smoke.mjs` отсутствует.

Лог прогона скрипта: `18-verify-script-run.txt`.

### 7.1 Чистка репозитория

* **`.gitignore`** дополнен двумя правилами: `state/notif-audit/fixes/*.txt`
  (генерируемые логи аудита — их 20) и `Backend/nginx/pending/` (стейджинг:
  `scripts/enable-pgadmin-tls.ps1` копирует оттуда конфиг в `conf.d`, файл
  побайтово совпадает с активным). Дампы `Backend/backups/` и раньше были
  закрыты через `Backend/.gitignore`, их трогать не пришлось. После правки
  `git status` не показывает ни одного лога-артефакта.
* **Комментарии убраны** из всех файлов, которые я правил: `Backend/.dockerignore`
  (вернулся ровно к состоянию HEAD), `Backend/restart.txt` (одна строка
  `docker compose up -d --build --no-deps backend`), `Backend/_notif_smoke.mjs`
  (осталась только замена `process.exit(1)` → `process.exit(failed.length ? 1 : 0)`),
  `Backend/scripts/verify-notifications.ps1` (удалены все `#`, кроме директивы
  `#Requires -Version 5.1`; BOM в UTF-8 сохранён, иначе PowerShell 5.1 ломает
  кириллицу). `Backend/k8s/README.md` оставлен как документация — это не
  комментарии в коде.
* После чистки скрипт прогнан заново: **все проверки зелёные, exit 0**
  (`20-verify-after-comment-strip.txt`).

### 7.2 Сплошная проверка набора к коммиту

Проверены все 14 файлов, которые попадут в коммит (не считая удалений). Итог:
**0 комментариев**. Комментарии сняты дополнительно с трёх чужих файлов из
набора — `Backend/nginx/Dockerfile` (7 строк), `Backend/nginx/conf.d/pgadmin.conf`
(4 строки), `Backend/scripts/enable-pgadmin-tls.ps1` (4 строки); удалялись только
полные строки-комментарии, значимые строки сверены до/после и совпали. Файлы
`docker-compose.yml` и `docker-compose.pgadmin.yml` уже были без `#`.
Единственный оставшийся `#` во всём наборе — директива `#Requires -Version 5.1`
в `verify-notifications.ps1` (это не комментарий).

**Заодно исправлен дефект в `09-unique-index-test-SAFE.sql`:** в нём оставался
старый префикс `verify-unique-%`, и проверка после отката ложно показывала бы
`trace_rows_after_rollback=1` на исторической строке `verify-unique-key` из
инцидента (broadcast `id=15`). Теперь ключ — `tx-probe-<md5>`, проверка идёт по
этому префиксу и не пересекается с историей.

**Валидация после правок:**

| Файл | Проверка | Результат |
|------|----------|-----------|
| `nginx/Dockerfile` | `docker build --check .` | `Check complete, no warnings found` |
| `nginx/conf.d/pgadmin.conf` | `nginx -t` в изолированном `nginx:alpine` | `syntax is ok`, `test is successful` |
| `enable-pgadmin-tls.ps1` | `Parser::ParseFile` под Windows PowerShell 5.1 | `PARSE_OK` |
| `verify-notifications.ps1` | `Parser::ParseFile` под Windows PowerShell 5.1 | `PARSE_OK` |
| `09-unique-index-test-SAFE.sql` | прогон на k8s-кластере (`BEGIN…ROLLBACK`) | `unique index OK`, `trace_rows_inside_tx=1`, после отката `0`, `tx_probe_rows=0` |

`HEAD` остался `449e904`, коммитов нет.

