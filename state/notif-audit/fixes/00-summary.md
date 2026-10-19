# Итоги исправлений подсистемы уведомлений (19.10.2026)

Источник: отчёт `Уведомления-Аудит.md` и детальные отчёты `state/notif-audit/01-…04-*.md`.
Исполнители: Lead + 4 владельца зон (scheduling, push-delivery, security, client). Все правки — в рабочем дереве; продуктовый код менялся только в рамках зон, отчёты аудита сохранены.

## 1. Проверки после исправлений

| Проверка | Результат |
|---|---|
| `cd Backend && node --test` | **195/195 pass** (было 141; +54 новых теста: reminderService, notificationService, pushService, pushBroadcastValidation, pushValidation, plantMetadata, wateringSchedule) |
| `cd Frontend && npm run lint` | **0 проблем** |
| `cd Frontend && npm test` | **7/7 pass** (date.js, включая TZ-кейсы) |
| `cd Frontend && npm run build` | успешно, пререндер: 23 публичных + 8 закрытых разделов |
| `npm run verify:build` | **117 проверок, все пройдены** (включая `notifications.html` как закрытый раздел) |
| `npm run verify:routing` | **48/48 проверок** |
| `node scripts/verify-routing.mjs /notifications` | **200** (было 404) |
| Синтаксис | `node --check` для всех изменённых backend-файлов — OK; SW/утилиты проверены |

## 2. Что исправлено (по зонам)

### Планировщик/напоминания (`01-scheduling-fixes.md`)
- **F-01**: `splitMissedWaterings` стал grace-aware — слот помечается пропущенным только после истечения собственного 24-часового grace; `next` может быть «текущим/опоздавшим» слотом. `autoSkipOverdue` — `<= cutoff`. Старый тест, закреплявший ошибочное «съедание» слота, переписан. Приёмка: пропущен Пн → Вт 09:00 приходит «пора полить» по Вт-слоту, Вт 09:10 без «пропущено 2», полив Вт пишется на Вт-слот.
- **F-02**: добавлена догоняющая on-day-доставка в пределах grace+5 мин со слот-дедупом и тихими часами для позднего догона.
- **F-03**: утренняя сводка и советы по уходу вынесены в отдельные cron-задачи с раздельными Redis-локами (`job:morning-summary-tick`, `job:care-advice-tick`) и логами длительности — AI-советы больше не блокируют тик напоминаний.
- **F-04**: пауза больше не тихая — при переходе в `reminders_paused` создаётся in-app + push «Напоминания приостановлены»; добавлен resume через `PUT /api/plants/:id {resume_reminders: true}`; флаг виден во фронте через `plant.metadata.reminders_paused`.
- **F-05/F-09**: push отправляется только если `storeNotification` создал запись (`created=true`); `markNotified`/`last_*` обновляются по факту создания in-app, а не по успеху push; убраны 78-кратные повторы; единый helper `sendNotificationPush` с одним быстрым ретраем transient-ошибки.
- **F-06/F-14**: `markNotified` — транзакция + `SELECT … FOR UPDATE`, merge в свежий metadata; флаги привязаны к ISO-слоту, а не к «24 ч назад».
- **F-07**: смена таймзоны всегда прогоняет `next_watering_at` через `advanceZonedWatering(…, now)`.
- **F-08**: реактивация `is_active:false→true` входит в `scheduleChanged` (сброс metadata, расписание в будущее).
- **F-10**: skip-уведомление уважает `notify_morning`, дни недели и паузу.
- **F-11**: `PUT /plants/:id` отклоняет `last_watered_at` раньше `created_at−24ч`; `advanceZonedWatering` получил O(1) fast-forward (было ~400 мс CPU).
- **L-01**: утренняя сводка обрезается до 1000 символов, имена/локации — до 40 символов; `storeNotification` дополнительно клампит title/body.
- **F-12/F-15/F-16**: честный лог усечения истории; partial-индексы `notification_preferences` (миграция `20261023_notification_prefs_indexes.sql`); гигиенические мелочи.

### Push-доставка/рассылки (`02-push-fixes.md`)
- **D-01**: рассылка отправляется чанками 100–500 (курсор `last_processed_id`), счётчики и `updated_at` сохраняются после каждого чанка, поддерживается resume после падения; stale `sending` (>10 мин) возвращается в `pending` с курсором; `sent_at` — только при завершении; `failed` — только VAPID-fatal; добавлен `POST /api/admin/push/broadcasts/:id/retry`.
- **D-02**: политика ошибок: 404/410 → удаление; 400/401/403/413 → карантин (`invalidated_at`, `invalid_reason`, исключение из будущих выборок); 429/5xx/timeout/network → `failed_attempts`/`last_error`, карантин после 5; успех сбрасывает попытки и пишет `last_success_at`.
- **D-03/D-04**: идемпотентность через partial unique index по `idempotency_key` в БД + обработка unique-violation → 200 deduplicated; Redis GET/SET убран из критического пути; клиент генерирует UUID на попытку (стабилен при сетевом ретрае, сбрасывается после успеха/валидационной ошибки).
- **D-05/D-06**: worker pool `PUSH_CONCURRENCY` (10 по умолчанию, 1–50), страницы вместо `findAll()` всех подписок; endpoint в логах маскируется sha256-префиксом; в API не возвращаются полные endpoint'ы/ошибки; `getPushStatus()` в `/health`; overview отдаёт `invalidated`, `pushStatus`, счётчики.
- **D-07**: VAPID-инициализация в try/catch — невалидные ключи больше не роняют процесс, push отключается с понятной причиной; все send-пути проверяют `ensureConfigured`; создание рассылки (в т.ч. scheduled) без VAPID → 503; `vapid-public-key` → 503.
- **D-08**: payload ≤3800 UTF-8 байт проверяется при создании рассылки и защитно урезается в reminder-путях.
- **D-09/D-10**: idempotency не зависит от Redis; прогресс чанков сохраняется с ретраями; transient-ошибка возвращает рассылку в `pending` для продолжения.
- **D-13**: `GUEST_PUSH_RETENTION_DAYS` (30 по умолчанию), чистка invalidated >30 дней, активные user-подписки не трогаются.
- **D-14**: 409 при попытке привязать чужой endpoint (включая анонимный запрос — больше не отвязывает), гонка unique → update вместо 500, guest-aware unsubscribe, всегда 200.
- **D-15**: удалены мёртвые `pushService.sendToAll/sendToFiltered` и legacy-методы контроллера `sendToUser/sendToAll/getStats`.

### Безопасность (`03-security-fixes.md`)
- **S-01/NS-01**: ужесточены квоты subscribe (10/15 мин + 50/сутки на user/IP, fail-closed при сбое Redis-store).
- **S-02/NS-07**: `POST /api/push/unsubscribe` теперь `optionalAuth` — гость может отозвать свою подписку; авторизованный удаляет свои строки.
- **S-04**: удалены legacy-маршруты `/api/push/send`, `/send-all`, `/stats`; добавлены лимиты на админ-рассылки (20/час, 60/сутки) и на cancel/retry (30/10 мин).
- **S-06**: лимиты на чтение уведомлений (300/мин) и отметки прочтения (120/мин), на PATCH prefs (60/мин).
- **S-07**: экспорт `validateSubscriptionForSend` (endpoint ≤2048, https/443, allowlist, ключи 65/16 байт, без control/whitespace) + 12 тестов; используется и на этапе отправки.
- **S-09/NS-10/NS-11**: CORS `allowedHeaders` += `Idempotency-Key`; guest_token включён в CSRF-fallback; mail opt-out и информативность `/health` — вне зоны (см. §4).

### Клиент/SW/UX (`04-client-fixes.md`)
- **C-01**: SW регистрируется как `/sw.js?api=<API_URL>` и использует абсолютную API-базу в `pushsubscriptionchange` и mark-read по клику push; `CACHE_NAME` → `ctp-v5`.
- **C-02**: SVG-иконка переименована, `Notification.permission` снова читается глобальный — restore/sync подписки на главной достижимы.
- **C-03**: сверка VAPID-ключа с существующей подпиской (unsubscribe+resubscribe при mismatch); при POST 409 — пересоздание endpoint и повторная привязка (смена аккаунта на устройстве).
- **C-04**: logout сначала отписывает устройство; локальный unsubscribe выполняется даже при 401/сетевой ошибке; opt-out флаг ставится после успешной отписки и снимается при включении.
- **C-05/C-06**: клик по push отмечает in-app запись прочитанной (`data.notificationId`), фокусирует/навигирует корректно; SW шлёт `push-received`, badge и счётчик обновляются без ожидания focus.
- **C-07/C-08/C-09**: таймауты всех push-запросов и `serviceWorker.ready`; ошибки подписки показываются в UI; offline-PWA: precache `/home`, runtime SWR-кеш ассетов, offline-навигация отдаёт shell, а не 404.
- **C-10**: промпт — `role=dialog`, `aria-modal`, focus trap, Escape, `role=alert`; denied-состояние с пошаговыми инструкциями и «Проверить снова»; transient-ошибка не сжигает 7-дневный cooldown.
- **C-11/C-12**: `date.js` учитывает локальный день для ISO-datetime (date-only не изменён); `readableUrl` отбрасывает `//` и `/\`.
- **C-13**: админка — UUID Idempotency-Key на попытку, кнопка retry для failed, пагинация получателей, retry обзора, отображение partial/quarantined, 409 как защитная информация.
- **C-14**: ThemeContext — один GET prefs на приватную сессию, 401 в PATCH = ошибка.
- **C-15**: `/notifications` добавлен в `.htaccess`, prerender (`notifications.html`) и `verify-routing`; профиль не POST-ит подписку на каждом монтировании (sync 24 ч).

## 3. Удаление комментариев

По выбору пользователя комментарии удалены **только в 49 файлах, изменённых в рамках фикса** (Backend + Frontend, включая новые миграции/тесты). Удалено ~198 комментариев. Сохранены функциональные директивы: `eslint-*`, `@vite-ignore`, `sourceMappingURL`, shebang. После удаления:
- исправлены 3 пустых `catch`, которые стали ошибками `no-empty`;
- backend-тесты 195/195, frontend lint 0, build/verify — зелёные.
Старые комментарии в файлах вне фикса не трогались.

## 4. Что осознанно не исправлено (вне зоны/риск)

1. **F-13 (Low)**: экзотические DST-переходы локальной полуночи (`America/Santiago`, `Africa/Cairo`, `Asia/Beirut`) — молчаливая нормализация; правка рискованна без интеграционных TZ-тестов.
2. **Mail-рассылки**: нет opt-out/`List-Unsubscribe` (NS-12) — отдельная подсистема, не уведомления.
3. **`/health`** по-прежнему отдаёт deployTarget/redis/mail/push/aiCache без авторизации (NS-11, Nit) — нужно сохранить для k8s-проб.
4. **Глобальный `/api` rate-limiter** не добавлен (мультиаккаунт-фермы); есть только точечные лимитеры.
5. **Сводка** по-прежнему показывает paused-растения (продуктовое решение); растения, уже находившиеся в паузе до деплоя, не получат уведомление о паузе (только при новом переходе).
6. **Push TTL/Urgency/Topic** не добавлены (L-03) — дефолтный TTL web-push 4 недели.
7. **At-least-once на границе чанка**: если БД умирает ровно после отправки чанка до сохранения курсора, возможны дубли ≤ chunk_size; политика задокументирована.
8. **Интеграционных тестов с реальными PG/Redis нет**: рекомендация — staging-сценарий `kill -9` в середине рассылки + параллельные POST с одним Idempotency-Key + проверка VAPID-ротации.

## 5. Чек-лист деплоя

1. Применить миграции: `Backend/migrations/20261022_push_delivery_hardening.sql`, `Backend/migrations/20261023_notification_prefs_indexes.sql` (обе идемпотентны). В production старт упадёт с подсказкой, если колонки не применены.
2. Перед релизом проверить/закрыть legacy-строки `push_broadcasts.status='sending'` с `last_processed_id=0`: после релиза они будут восстановлены и досланы; чтобы избежать дублей — заранее перевести их в `failed`.
3. Задеплоить `Backend` (нужны `Idempotency-Key` в CORS, новые маршруты, `/health` c `push`), затем `Frontend/dist` (в нём `notifications.html` и обновлённый `.htaccess`).
4. Service worker обновится через `ctp-v5`; у части пользователей старый SW может жить до суток — mark-read/badge работают best-effort.
5. Настроить алерт на рост `push_subscriptions.invalidated_at` (VAPID-инцидент) и на `push_broadcasts.status='failed'`.
6. Проверить на staging: `/notifications` F5, админ-рассылка из браузера (preflight с `Idempotency-Key`), push-клик → mark-read, logout → отписка, смена аккаунта на одном устройстве, `kill -9` в середине рассылки → resume.

## 6. Ссылки

- `state/notif-audit/fixes/01-scheduling-fixes.md`
- `state/notif-audit/fixes/02-push-fixes.md`
- `state/notif-audit/fixes/03-security-fixes.md`
- `state/notif-audit/fixes/04-client-fixes.md`
- Итоговый аудит: `Уведомления-Аудит.md`
