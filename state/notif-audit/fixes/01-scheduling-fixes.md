# Fixes: планировщик напоминаний (task-5, по аудиту task-1 / A-01…A-16)

**Статус:** реализовано, тесты зелёные. Продуктовые файлы менялись только в рамках
`write_scopes` задачи; `Backend/index.js`, `routes`, `models`, `package.json`,
`Frontend` не трогались. Новые файлы: `Backend/jobs/reminderService.test.js`,
`Backend/services/notificationService.test.js`,
`Backend/migrations/20261023_notification_prefs_indexes.sql`.

**Проверки:**
```
cd Backend && node --test      → 195 tests, 195 pass, 0 fail
node --test jobs/reminderService.test.js utils/wateringSchedule.test.js utils/plantMetadata.test.js → 41/41 pass
node --test services/notificationService.test.js → 6/6 pass
node --check <все изменённые .js> → OK
```

---

## 1. Сводка: находка → что сделано

| ID | Находка | Что изменено | Файлы |
|---|---|---|---|
| **A-01/F-01** | Авто-пропуск «съедал» не просроченный слот | `splitMissedWaterings` grace-aware: `missed` — только слоты с `slot + grace <= now`; `next` — первый НЕпропущенный слот (может быть `<= now`); `autoSkipOverdue` выбирает `next_watering_at <= cutoff`, логи/уведомление только по реально истёкшим слотам; тесты переписаны + новые (interval 1, простой, граница grace) | `utils/wateringSchedule.js`, `utils/wateringSchedule.test.js`, `jobs/reminderService.js` |
| **A-03/F-02** | Не было «догоняющей» доставки on-day | `sendOnDay`: окно `[now − (grace+5мин), now + 5мин]`, слот-привязанный дедуп, позднее напоминание с текстом «полив был запланирован на …»; для позднего догона — тихие часы (локальные 9–21), чтобы не будить ночью | `jobs/reminderService.js` |
| **A-04/F-03** | AI-советы/сводка блокировали reminder tick | Три отдельные cron-задачи с раздельными локами: `job:reminder-tick` (autoSkip/dayBefore/onDay), `job:morning-summary-tick`, `job:care-advice-tick`; duration-логи по стадиям; `start()` запускает все три (index.js не менялся) | `jobs/reminderService.js` |
| **A-02/F-04** | Тихая бессрочная пауза | При переходе в `reminders_paused` — in-app + push «Напоминания приостановлены» (dedupe `plant:<id>:reminders_paused:<slotISO>`, push не шлётся при `notify_morning=false`); `PUT /api/plants/:id {resume_reminders:true}` снимает паузу/`consecutive_skips`, сохраняет `missed_since`, при необходимости сдвигает `next` в будущее; флаг виден во фронте через `plant.metadata.reminders_paused` (модели отдают metadata) | `utils/plantMetadata.js`, `jobs/reminderService.js`, `controllers/plantController.js` |
| **A-05/F-05** | Дубли push при degraded Redis | Push отправляется только если `storeNotification` вернул `created === true` (в notify / autoSkip / pause / сводке); единый helper `sendNotificationPush` (одна быстрая повторная попытка при `sent=0 && failed>0`) | `services/notificationService.js`, `jobs/reminderService.js`, `services/careAdviceService.js` |
| **A-06/F-06** | RMW-гонка `markNotified` | `markNotified` — транзакция + `SELECT … FOR UPDATE` по plant, merge слота в свежий metadata, commit. Флаг уведомления теперь привязан к конкретному слоту (ISO), а не «24ч назад» | `jobs/reminderService.js` |
| **A-07/F-07** | Смена TZ оставляла next в прошлом | После пересчёта `next` всегда прогоняется через `advanceZonedWatering`, если `<= now` | `controllers/userController.js` |
| **A-08/F-08** | Реактивация не пересчитывала расписание | `scheduleChanged` включает `is_active false→true`; при реактивации next считается в будущее, metadata сбрасывается (`withNotificationsReset(clearWateringProgress)`) | `controllers/plantController.js` |
| **A-09/F-09** | Нет разделения in-app/push, 78-повторы | `markNotified`/`last_morning_summary_date` ставятся по факту создания in-app (не по `sent>0`); слот закрывается после создания строки; повторных тиков-циклов больше нет; push — одна быстрая повторная попытка при transient-ошибке | `jobs/reminderService.js`, `services/notificationService.js` |
| **A-10/F-10** | Авто-пропуск игнорировал настройки растения | `notifyAutoSkipOutcome` уважает `notify_morning`, `reminder_weekdays` (по дню пропущенного слота) и паузу; иначе — только лог. Сводка продолжает работать как раньше (см. «Осталось») | `jobs/reminderService.js` |
| **A-11/F-11** | API принимал прошлое `last_watered_at`, 40k итераций | `PUT` отклоняет `last_watered_at < created_at − 24ч` (как бэкфилл в `water()`); `advanceZonedWatering` получил fast-forward (O(1) + 1–2 шага) — 400 мс → ~0 мс для legacy-дат | `controllers/plantController.js`, `utils/wateringSchedule.js` |
| **A-12/F-12** | Молчаливое усечение skip-логов | В `watering_logs` — по-прежнему последние 100, но добавлен `console.warn` с полным числом; в уведомлении остаётся полный `missed.length` | `jobs/reminderService.js` |
| **A-14/F-14** | Дедуп по «24 часам» | Слот-привязанные флаги: `metadata.notifications[key] = slotISO`, сравнение `===` (`isSlotNotified`/`withSlotNotification`) | `jobs/reminderService.js` |
| **L-01** | Сводка могла превысить VARCHAR(1000) | `buildMorningSummaryBody`: имена/локации ≤40 символов, до 5 растений, тело ≤1000; плюс страховка `clampNotificationText` в `storeNotification` (`title` ≤120, `body` ≤1000) | `jobs/reminderService.js`, `services/notificationService.js` |
| **A-15/F-15** | Полный скан `notification_preferences` по флагам | Новая идемпотентная миграция частичных индексов `idx_notification_prefs_morning_enabled` / `idx_notification_prefs_care_enabled` | `Backend/migrations/20261023_notification_prefs_indexes.sql` |
| **A-16/F-16** | Гигиена | Тип уведомлений в БД не менялся (остался `watering_due`); `logAiAdvice` для советов по уходу перенесён после проверки `created` (нет дублей телеметрии при ретрае); примечание авто-пропуска: «истёк grace-период 24ч» | `services/careAdviceService.js`, `jobs/reminderService.js` |

---

## 2. Детали реализации

### 2.1 `utils/wateringSchedule.js`
- `splitMissedWaterings(scheduledFor, intervalDays, hour, timeZone, now, { graceMs = MISSED_GRACE_MS })`:
  `missedDeadline = now − graceMs`, слот попадает в `missed` при `cursor <= missedDeadline`
  (инклюзивно: ровно 24ч — уже пропущен), `next` — первый слот после этого. `next` может быть
  `<= now` — это «текущий/опоздавший» слот для догоняющего напоминания, а не пропуск.
- `advanceZonedWatering`: fast-forward по локальным дням (`intervalDays * jumps`) перед
  итеративным добором. Эквивалентно последовательным шагам, т.к. zoned-арифметика аддитивна.
  `MAX_ADVANCE_STEPS` остался страховкой.

Эмпирика (pure-прогон):
```
daily interval=1, Пн 09:00 пропущен:
  Вт 09:00 tick: skipped=[Пн 09:00], next=Вт 09:00, onDay=true   ← «пора полить» по Вт-слоту
  Вт 09:10 tick: skipped=[], next=Вт 09:00, onDay=false          ← нет «пропущено 2»
weekly, тик после недельного простоя в Пн 09:10:
  skipped=[Пн−7 09:00], next=Пн 09:00, onDay=true
weekly, слот 14:00, тики 14:00/14:10 потеряны, тик 14:20:
  onDay=true (догон)
```
Полив Вт 09:15 теперь пишется на Вт-слот: `next_watering_at` после авто-пропуска = Вт 09:00,
а не Ср (проверено логикой `water()`: `scheduled_for = plant.next_watering_at`).

### 2.2 `jobs/reminderService.js`
- **Три задачи** (все `*/10 * * * *`, UTC, отдельные локи):
  `runReminderTick` (TTL 10 мин), `runMorningSummaryTick`, `runCareAdviceTick` (TTL 30 мин).
  `start()` запускает все три; `index.js` не менялся. `tick()` оставлен как ручной
  последовательный прогон (без внешних локов).
- **autoSkipOverdue**: `next_watering_at <= now − grace`; grace-aware split; лог/уведомление
  только по `missed`; при усечении — warn. При паузе — только лог; при переходе в паузу —
  отдельное уведомление.
- **sendDayBefore**: без изменений окна (локальные 9–21, «завтра»), слот-дедуп, push только
  при создании in-app, `markNotified` после создания.
- **sendOnDay**: догон в пределах `grace + 5 мин`; слот-дедуп; текст позднего напоминания;
  тихие часы для позднего догона (локальные 9–21).
- **notify()**: `storeNotification` → push только при `created`; возвращает `{notification, created}`.
- **markNotified()**: транзакция + `FOR UPDATE`, merge в свежий metadata.
- Длительности: `⏱ reminderTick.<stage>`, `⏱ reminderTick/summary/care` — в логах.

### 2.3 `services/notificationService.js`
- `clampNotificationText` (+ применение в `storeNotification`): защита от `VARCHAR(120)/(1000)`.
- `sendNotificationPush`: один вызов push; при `sent=0 && failed>0` — одна быстрая повторная
  попытка (250 мс); исключения push ловятся и логируются (цикл уведомлений не рвётся);
  отсутствие подписок (`total=0, failed=0`) — не ошибка и не ретрай.

### 2.4 `controllers/plantController.js`
- `resume_reminders` (boolean) в `PUT /plants/:id`: снять `reminders_paused`/`consecutive_skips`,
  оставить `missed_since`; если `next_watering_at` старше grace — сдвинуть в будущее.
- `reactivated` входит в `scheduleChanged` (F-08).
- Валидация `last_watered_at >= created_at − 24ч` (F-11).

### 2.5 `controllers/userController.js`
- При смене TZ: `next = advanceZonedWatering(...)`, если после пересчёта `next <= now`.

### 2.6 Миграция
`Backend/migrations/20261023_notification_prefs_indexes.sql` — идемпотентная (`CREATE INDEX
IF NOT EXISTS`, partial `WHERE ... = TRUE`). `apply-migrations.ps1` прогоняет все файлы при
каждом деплое — повторный запуск безопасен. В `index.js` map добавлять не нужно (только индексы).

---

## 3. Тесты

| Файл | Что покрыто |
|---|---|
| `Backend/jobs/reminderService.test.js` (новый, 11) | `truncateText`, `buildMorningSummaryBody` (пусто/5+«ещё N»/обрезка/L-01), `buildOnDayNotification` (обычное/позднее), `formatSlotLabel`, `buildAutoSkipNotification`, `buildRemindersPausedNotification`, `isSlotNotified`/`withSlotNotification` (slot-bound, legacy-значение не считается, merge без мутации), `clampNotificationText` |
| `Backend/utils/wateringSchedule.test.js` (24) | обновлён ежедневный тест под grace-aware; новые: слот в пределах grace не пропущен и возвращается как next; ровно на границе grace; простой неделя — пропущен только старый слот; `graceMs` override; fast-forward `advanceZonedWatering` из 1900 года (результат в будущем, < 2 c) |
| `Backend/utils/plantMetadata.test.js` (6) | `resumeReminders`: снимает паузу/счётчик, сохраняет `missed_since`, не мутирует вход |
| `Backend/services/notificationService.test.js` (новый, 6) | `sendNotificationPush`: успех = 1 попытка; transient (`sent=0 && failed>0`) = ровно 1 ретрай; нет подписок = без ретрая; исключение не пробрасывается (→ null); валидация userId; `clampNotificationText` |
| остальные | без изменений, 195/195 суммарно |

---

## 4. Поведение после фикса (приёмка A-01)

Сценарий: ежедневный полив 09:00, понедельник пропущен, пользователь не поливает.
- **Вт 09:00** — авто-пропуск фиксирует только Пн (`skipped=[Пн]`), `next` остаётся
  Вт 09:00; in-app/push «Пора полить» по Вт-слоту (обычное окно).
- **Вт 09:10** — нет «пропущено 2»; повторного on-day нет (слот закрыт).
- **Полив Вт 09:15** — `watering_logs.scheduled_for = Вт 09:00` (не будущий слот), `hours_late`
  считается от Вт-слота.
- Авто-скип теперь срабатывает и ровно на границе 24ч (`<=`), поэтому «висящий» вчерашний слот
  обрабатывается в тот тик, когда он реально истёк, а не «съедает» текущий.

Сценарий «потеряны 2 тика»: слот 14:00, тики 14:00/14:10 пропущены → тик 14:20 отправит
позднее on-day-напоминание (один раз на слот), а не потеряет его.

Сценарий «две реплики / Redis degraded»: оба экземпляра делают `findOrCreate`; push уходит
только у того, кто создал строку (`created=true`).

Сценарий «пауза»: третий авто-пропуск → in-app + push «Напоминания приостановлены» с
объяснением и путём возобновления; `PUT {resume_reminders:true}` возвращает напоминания.

---

## 5. Что осталось / риски (честно)

1. **Frontend не менялся** (вне write-scope): баннер «напоминания приостановлены» и кнопка
   «возобновить» в карточке растения **не реализованы** — нужен frontend-таск. API уже готов:
   `plant.metadata.reminders_paused` и `PUT /api/plants/:id {resume_reminders:true}`.
   До появления UI пользователь видит только push/in-app «Напоминания приостановлены».
2. **Растения, уже находящиеся в паузе до деплоя**, не получат уведомление о паузе
   (оно отправляется только в момент перехода). Их можно разбудить через `resume_reminders`
   или полив. Опционально Lead может сделать одноразовую рассылку/индикацию.
3. **`alreadyNotified` остаётся быстрым чтением** по загруженному растению (без отдельной
   транзакции): атомарность обеспечивают слот-дедуп и `markNotified` под `FOR UPDATE`;
   отдельный `SELECT FOR UPDATE` ради чтения дал бы лишние запросы на каждое растение.
4. **Тихие часы для позднего догона** (локальные 9–21) — добавлено мной как продуктовая
   защита от ночных push; если не нужно, легко убрать (условие в `sendOnDay`).
5. **Сводка по-прежнему показывает растения на паузе** и не учитывает `notify_morning`
   (F-10 ч.2). Не менял, т.к. это меняет продуктовую семантику сводки; при желании — отдельный
   маленький фикс (фильтр `isRemindersPaused`/`notify_morning` в `sendMorningSummaryTo`).
6. **F-13 (DST-полночь) не исправлялся** — Low, отдельная задача: `zonedDateTimeToUtc` для
   несуществующего локального времени; слоты 9/14/19 не затронуты. Две семантики «просрочено»
   (полночь в UI vs 24ч в авто-пропуске) сохранены.
7. **Авто-скип + on-day в одном тике** для ежедневного растения могут дать два уведомления
   (о вчерашнем пропуске и о сегодняшнем поливе). Это корректно по смыслу, но при желании
   можно объединять в одно сообщение.
7a. **Частота авто-скип-уведомлений для ежедневных растений выросла**: теперь каждый день
   помечается реально истёкший вчерашний слот (а не раз в 2 дня из-за «съедания»). Это
   ограничено паузой после 3 запусков (`MAX_CONSECUTIVE_AUTO_SKIPS`), поэтому максимум ~2
   пропускных уведомления + уведомление о паузе, дальше тишина. Если нужно тише — увеличить
   `MAX_CONSECUTIVE_AUTO_SKIPS` или отправлять skip-push не чаще раза в N часов.
8. **`sendNotificationPush` зависит от полей `sent`/`failed`** `pushService.sendToUser`.
   Сейчас они есть (проверено в текущей ветке с параллельными правками push-сервиса); если
   другой таск поменяет контракт — поправить `shouldRetryPush`.
9. **Нагрузка**: сводка/советы по-прежнему сканируют всех пользователей с флагом (индексы
   добавлены, но фильтрация по локальному часу — в JS). Отдельные локи снимают блокировку
   reminder-тика, но при очень большой базе стоит пагинация/материализация локального часа.
10. `watering_due` остаётся типом и для авто-пропуска, и для паузы (по требованию Lead'а не
    менять DB constraint); категория в UI определяется заголовком — фронт может не подсветить
    паузу как «системное» уведомление.

---

## 6. Кросс-файловые просьбы к Lead

1. **Frontend**: карточка растения — читать `plant.metadata.reminders_paused`, показывать
   статус и кнопку «Возобновить» → `PUT /api/plants/:id` с `{resume_reminders:true}`.
2. **Deploy/DB**: применить новую миграцию
   `Backend/migrations/20261023_notification_prefs_indexes.sql` (идемпотентна; правок
   `index.js` не требует). Сообщаю имя файла, как просили.
3. **routes** (`plantRoutes.js`) не менялись: resume идёт через существующий `PUT /:id`.
   Если нужен отдельный `POST /:id/reminders/resume` — это правка `plantRoutes.js`
   (security-owned), скажите.
4. **index.js** не менялся: `reminderService.start()` сам запускает 3 cron-задачи.
   Флаги `BACKGROUND_JOBS_ENABLED` сохраняют смысл.
