# WebPlant — Independent Release Verification (task-4)

**Verifier:** release-verifier (independent gate) · **Date:** 2026-10-15 · **Observation set frozen at 2026-10-15 11:47:49 +03:00**
**Workspace:** `C:\Users\yvan0\Yandex.Disk\WebPlant` · **Branch:** `Development` · **HEAD:** `e2edf44`
**Deploy target:** compose (`Backend/docker-compose.yml`) and Kubernetes (`Backend/k8s/scripts/deploy.ps1`, image tag `webplant-backend:<ver>-<hash>-dirty-<hash>`, `imagePullPolicy: Never`)

---

## 1. VERDICT

# **NO-GO**

Two independent blockers, both security-critical and both live in production right now, not theoretical:

| # | Blocker | Status | Class |
|---|---------|--------|-------|
| B1 | **Live production credentials are baked into the production image that the last applied manifest points to.** 5 of 11 `.k8s-images/*.tar` contain `app/.env.bak-20261012153426` and/or `app/.env.bak-20261012160419`, whose `SECRET_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`, `VAPID_PRIVATE_KEY`, `YANDEX_CLOUD_API_KEY` are byte-identical to the current `Backend/.env`. The newest tar = the image in `.k8s-images/backend.generated.yaml:65` (the manifest `deploy.ps1` applies), `imagePullPolicy: Never`, loaded onto 6 nodes per `.k8s-images/deploy.log`. | **OPEN** — root cause fixed in the working tree, exposed artifacts and keys NOT remediated | CRITICAL |
| B2 | `Backend/middleware/auth.js:77-78` accepts a `{id, tokenType:'session'}` token **with no `jti` and no server-side session lookup**. Combined with B1 (SECRET_KEY readable from the shipped image) this is a one-line forge: an attacker mints a non-revocable session token for any user id, including `role='ADMIN'`. | **OPEN** | CRITICAL (in combination) / HIGH standalone |

The Lead's root-cause fixes to `.dockerignore` and `deploy.ps1` are **correct and verified**, and they stop the leak from recurring — but they do not un-expose the 5 already-built tars, the image already loaded on the production nodes, or the credentials inside them. Rebuilding today produces a *clean* image, but every key in `Backend/.env` must be treated as compromised and rotated before/with this release, and the leaking artifacts must be purged.

Everything else found is non-blocking for a deploy, but the ranked list in §6 should be reviewed.

---

## 2. Scope of what is shipping

```
$ git status --short
 M .gitignore
 M Backend/.dockerignore
 M Backend/controllers/adminManageController.js
 M Backend/controllers/chatController.js
 M Backend/controllers/notificationController.js
 M Backend/controllers/plantController.js
 M Backend/jobs/reminderService.js
 M Backend/k8s/scripts/deploy.ps1
 D Backend/redis.test.js
 M Backend/routes/chatRoutes.js
 D Backend/services/aiService.test.js
 D Backend/services/mailService.test.js
 M Backend/services/pushBroadcastService.js
 M Backend/utils/wateringSchedule.js
 M Bug-Tracker-WebPlant.csv
 M Bug-Tracker-WebPlant.xlsx
 M Frontend/src/component/home/home.desktop.css
 M Frontend/src/component/homePage/dark-theme.css
 M Frontend/src/component/homePage/homePage.css
 M Frontend/src/component/homePage/homePage.jsx
 M Frontend/src/component/landingPage/landingPage.css
 M Frontend/src/component/profile/profile.css
 M Frontend/src/component/profile/profile.jsx
 M Frontend/src/component/registration/registration.jsx
 M Frontend/src/component/visionNextPlant/visionNextPlant.jsx
?? Backend/_notif_smoke.mjs
```

`git diff --stat`: 25 files, +1091 / −647 (608 lines changed in `homePage.jsx`; 397 deleted test lines).

Deploy path traced end to end:

* **compose** — `postgres` (healthcheck) → `migrate` (applies `/migrations/*.sql` in shell-glob order, hard-fails if `users` is missing; `docker-compose.yml:75-104`) → `backend` (`depends_on: service_completed_successfully`, `env_file: .env`, `PORT: 5000`, `REDIS_URL` assembled from `${REDIS_PASSWORD}`; `:106-150`) → `nginx` (proxies `/api/`, `/uploads/`, `/health` to `ctp_k8s_gateway:8090`; `nginx/conf.d/default.conf:35-66`).
* **k8s** — `deploy.ps1` reads `Backend/.env`, regenerates `webplant-env` (ConfigMap) + `webplant-secrets` (Secret, incl. `REDIS_URL`), applies `10/15/20/30`, builds from a staging copy of `Backend/` outside the repo, `docker save`s the tar into `.k8s-images/`, serves it over HTTP :8099, imports it via the `image-loader` DaemonSet, restores data if the cluster DB is empty, runs `Backend/scripts/apply-migrations.ps1`, rolls out `40-backend.yaml`, then the gateway.
* Backend container: `node:22-alpine`, `npm ci --omit=dev`, `COPY . .`, `CMD node index.js`, `EXPOSE 5000`.

---

## 3. Reproduced commands (raw)

### 3.1 Backend tests — PASS (exit 0)

```
$ cd Backend; npm test          # node --test
✔ requireAuth accepts only an active server-side session (5.0202ms)
✔ expired remembered access token refreshes only with an active refresh session (2.1097ms)
✔ guest token persists for the cookie-consent retention period (3.0928ms)
... (20 tests total) ...
ℹ tests 20
ℹ pass 20
ℹ fail 0
ℹ duration_ms 669.9931
BACKEND_TEST_EXIT=0
Node v24.20.0
```

### 3.2 Frontend build / verify / test / lint — all PASS (exit 0)

```
$ cd Frontend; npm run build
> node scripts/generate-seo-meta.mjs && vite build && node scripts/prerender.mjs
✓ src/data/seoMeta.js обновлён: 10 растений, 11 статей
✓ 215 modules transformed.
✓ built in 254ms
✓ Пререндер готов: главная, 23 публичных страниц, 7 закрытых разделов, sitemap на 24 URL
BUILD_EXIT=0

$ npm run verify
Проверок выполнено: 116   ✓ Все проверки пройдены
✓ Все 38 проверок маршрутизации пройдены
VERIFY_EXIT=0

$ npm test
ℹ tests 0            # "node --test src/**/*.test.js" — there are no frontend test files
TEST_EXIT=0

$ npm run lint
LINT_EXIT=0
```

### 3.3 Production config validators executed against the real `Backend/.env` (NODE_ENV=production) — PASS

```
parseLocalDevOrigins: OK
validateProductionPasskeyConfig: OK
SECRET_KEY bytes: 36
missing required: []
FRONTEND_URL entry [https://checktheplants.ru] proto=https: path=/ hasSearch=false hasHash=false
FRONTEND_URL entry [https://test.checktheplants.ru] proto=https: path=/ hasSearch=false hasHash=false
mail problems: []
isMailConfigured: true
isRedisConfigured: true
```

### 3.4 Image-tar secret scan (independent re-derivation) — 5 / 11 tars LEAK

```
$ tar -xf <tar> -C <tmp>; for each gzip layer: tar -tzf <layer> | grep env
LEAK  webplant-backend-1.2.6-45225b0-dirty-5d039d6c.tar
        app/.env.bak-20261012153426
        app/.env.bak-20261012160419
clean webplant-backend-1.2.6-742be7e-dirty-087a22b5.tar
clean webplant-backend-1.2.6-742be7e-dirty-3873b738.tar
clean webplant-backend-1.2.6-742be7e-dirty-7550e0e0.tar
clean webplant-backend-1.2.6-b92f5e7-dirty-2d948798.tar
LEAK  webplant-backend-1.2.6-df67d39-dirty-1ca44887.tar
        app/.env.bak-20261012153426
        app/.env.bak-20261012160419
LEAK  webplant-backend-1.2.6-df67d39-dirty-445e3c78.tar
        app/.env.bak-20261012153426
clean webplant-backend-1.2.6-df67d39-dirty-5ae1d1f1.tar
LEAK  webplant-backend-1.2.6-df67d39-dirty-7bdaa0e0.tar
        app/.env.bak-20261012153426
LEAK  webplant-backend-1.2.6-df67d39-dirty-7cf43eab.tar
        app/.env.bak-20261012153426
        app/.env.bak-20261012160419
clean webplant-backend-1.2.6-df67d39-dirty-8c500e2d.tar
=== TARS WITH SECRETS: 5 / 11 ===
```

Secret equality check (values never printed, compared in-process):

```
--- 45225b0-dirty-5d039d6c : app/.env.bak-20261012153426 (23 keys) ---
    SECRET_KEY            present=True  equalsCurrent=True
    DB_PASSWORD           present=True  equalsCurrent=True
    REDIS_PASSWORD        present=True  equalsCurrent=True
    VAPID_PRIVATE_KEY     present=True  equalsCurrent=True
    YANDEX_CLOUD_API_KEY  present=True  equalsCurrent=True
    SMTP_PASSWORD         present=False equalsCurrent=False
    FRONTEND_ORIGIN       present=True  equalsCurrent=True
    RP_ID                 present=True  equalsCurrent=True
--- 45225b0-dirty-5d039d6c : app/.env.bak-20261012160419 (34 keys) ---
    SECRET_KEY            present=True  equalsCurrent=True
    DB_PASSWORD           present=True  equalsCurrent=True
    REDIS_PASSWORD        present=True  equalsCurrent=True
    VAPID_PRIVATE_KEY     present=True  equalsCurrent=True
    YANDEX_CLOUD_API_KEY  present=True  equalsCurrent=True
    SMTP_PASSWORD         present=True  equalsCurrent=False   # rotated at some point; older value still a valid-format credential
```

`equalsCurrent=True` means byte-equal to the value in the current `Backend/.env`.

### 3.5 Proof the leaking image is the deployed one

```
$ grep image .k8s-images/backend.generated.yaml
65:          image: webplant-backend:1.2.6-45225b0-dirty-5d039d6c
66:          imagePullPolicy: Never

$ grep webplant-backend .k8s-images/image-loader.generated.yaml
27:  value: "webplant-backend:1.2.6-45225b0-dirty-5d039d6c"
29:  value: "webplant-backend-1.2.6-45225b0-dirty-5d039d6c.tar"
33:  value: "docker.io/library/webplant-backend:1.2.6-df67d39-dirty-1ca44887"   # KEEP_IMAGE for rollback — also leaks
```

`backend.generated.yaml` is written by `deploy.ps1:623-626` immediately before `kubectl apply`; `gateway-nginx.conf` (also regenerated by that run, `deploy.ps1:665-667`) is only produced **after** `kubectl rollout status deployment/backend` succeeds (`:630-651`). Both files are timestamped 2026-10-14 01:08–01:14, i.e. that deploy reached the end. The 10.10 run captured in `.k8s-images/deploy.log` documents the same flow and says `Образ импортирован на 6 нод(ы)`, `Backend готов`.

### 3.6 Deleted tests — run verbatim from HEAD against current code: 29/29 PASS

`Backend/redis.test.js` (43 lines), `Backend/services/aiService.test.js` (201), `Backend/services/mailService.test.js` (153) were restored **outside the repo** (`%TEMP%`, hardlinks + junction to `Backend/node_modules`) and executed unchanged:

```
$ node --test redis.test.js services/aiService.test.js services/mailService.test.js
✔ resolveRedisUrl returns null when Redis is not configured
✔ resolveRedisUrl prefers explicit REDIS_URL
✔ resolveRedisUrl builds a url from host, port, password and db
✔ resolveRedisUrl falls back to the default port and no credentials
✔ withTimeout resolves fast promises and rejects slow ones
✔ withTimeout without a timeout passes the promise through
✔ chat context remains outside trusted instructions and is sent as untrusted data
✔ species suggestions are trimmed and normalized to a single line
✔ AI response text extraction supports Responses API content output
✔ watering advice parser accepts questions and bounded recommendations
✔ watering time advice parser accepts only valid time-of-day recommendations
✔ species suggestion retries once with a larger output budget after token exhaustion
✔ watering advice retries once with a larger output budget after token exhaustion
✔ watering advice does not retry failures unrelated to output-token exhaustion
✔ readMailConfig: по умолчанию smtp.mail.ru:465 с SSL
✔ readMailConfig: SMTP_SECURE следует за портом, если не задан явно
✔ readMailConfig: некорректный порт откатывается к 465
✔ isMailConfigured: нужны и логин, и пароль
✔ describeMailStatus различает выключенную и ненастроенную почту
✔ describeMailConfigProblems подсказывает про пароль приложения mail.ru
✔ describeMailConfigProblems ловит чужой домен в MAIL_FROM
✔ describeMailConfigProblems принимает псевдоним того же домена
✔ describeMailConfigProblems ловит рассинхрон порта и SMTP_SECURE
✔ настроенная почта не даёт замечаний
✔ renderPasswordResetEmail кладёт ссылку, срок и подпись
✔ renderPasswordResetEmail экранирует вёрстку и требует ссылку
✔ renderWelcomeEmail: тема, приветствие по имени, подпись разработчика
✔ renderWelcomeEmail: без имени — нейтральное приветствие, логотип переопределяется
✔ renderWelcomeEmail экранирует имя получателя в вёрстке
ℹ tests 29  ℹ pass 29  ℹ fail 0
```

**Conclusion:** the deletion **does not hide a functional regression** — every assertion those files made still holds against the current code. It is a pure coverage loss (397 lines, incl. the mail HTML-escaping and AI prompt-injection boundary tests). Do not ship deletions silently: restore before/after deploy (MEDIUM, §6.6).

---

## 4. Verification of the Lead's 5 working-tree fixes

| # | Fix | Verdict | Evidence (current content) |
|---|-----|---------|----------------------------|
| 1 | `Backend/.dockerignore`: `.env.local`/`.env.production` → `.env.*` | **VERIFIED, CORRECT** | `git diff`: `-.env.local` `-.env.production` `+.env.*`; file lines 4-5 are `.env` + `.env.*`. Matches `.env`, `.env.bak-*`, `.env.local`, `.env.production`. sha256 `F8A80BC5FA545B12` |
| 2 | `Backend/.env.bak-*` moved out of the repo | **VERIFIED** | No `.env.bak*` under `Backend/`; only `Backend/.env` remains (gitignored, untracked). Archive present at `C:\Users\yvan0\Yandex.Disk\webplant-secrets-archive\` with `.env.bak-20261012153426` (992 B) and `.env.bak-20261012160419` (1811 B). Outside the build context. **Note:** the same two files still exist *inside* 5 image tars (§3.4) — the move did not remove them from the artifacts. |
| 3 | `pushBroadcastService.js:123` status expression | **VERIFIED, CORRECT** | `status: subscriptions.length === 0 \|\| (result.sent ?? 0) > 0 ? 'sent' : 'failed'`. `sendToSubscriptions` always returns numeric `sent` (`services/pushService.js:108-112`), so `?? 0` is defensive but harmless; a broadcast with zero subscriptions is now `sent`, not a lie to the admin UI. sha256 `327E50C7F2919FB8` |
| 4 | `adminManageController.js` deleteWatering `nextWateringAt` | **VERIFIED, CORRECT** | `restoredNextWateringAt` initialised `:837`, set from the freshly computed `updates.next_watering_at` `:857`, returned `:868` as `(isLatestAction ? restoredNextWateringAt : null) ?? plant?.next_watering_at ?? null`. The `hasPrevPlan` branch is live: watering logs really carry `metadata.prev_next_watering_at` (`plantController.js:1007,1025,1080`). sha256 `CE79A15293610423` |
| 5 | `registration.jsx` reset button `type=''` → `type='button'` | **VERIFIED, CORRECT** | `registration.jsx:340-346` — `<button className='resetPassword' type='button' onClick={() => navigate('/reset-password')}>Забыли пароль?</button>`. sha256 `1F33A5B5192A4B9E` |

Also verified as part of the remediation chain:

* `deploy.ps1:207` `$roboArgs += @('/XF', '.env*')`, `:215-217` post-copy purge, `:219-222` fail-closed `throw` if any `.env*` survives. `git diff` shows exactly these 10 added lines and nothing else. **UTF-8 BOM preserved** (`EF BB BF` present). sha256 `62DD17B3C1AA1141` (unchanged across three checks at 11:41 / 11:46 / 11:47, mtime 11:36:27).
* Root `.gitignore`: at HEAD it had `.env` + `.env.*.local` only; the working tree now has `.env.*` + `!.env.example` (`git diff -- .gitignore`), closing the gap for `.env.bak-*`.

---

## 5. Claim-by-claim verdicts (tasks 1–3)

Legend: **VERIFIED** = re-derived from current file content; **REFUTED** = current content contradicts it; **UNPROVEN** = could not be tested here, reason stated.

### task-1 — auth / secrets

| Claim | Verdict | Evidence / correction |
|-------|---------|-----------------------|
| CRITICAL: live secrets inside already-built production images; 5 of 11 `.k8s-images/*.tar`; newest included | **VERIFIED** | §3.4/3.5. Independently reproduced the exact 5-of-11 count and the file names; proved the leaked `SECRET_KEY`/`DB_PASSWORD`/`REDIS_PASSWORD`/`VAPID_PRIVATE_KEY`/`YANDEX_CLOUD_API_KEY` equal the current `.env` values. Also verified the deployed manifest points at the leaking tag with `imagePullPolicy: Never` (`backend.generated.yaml:65-66`, `k8s/40-backend.yaml:65-66`). |
| CRITICAL cause chain: `New-LocalBuildContext` robocopy without `.env` exclusion + `.dockerignore` missing `.env.*` + `COPY . .` + `docker save` + `imagePullPolicy: Never` | **VERIFIED (mechanism) / FIXED (code)** | `Dockerfile:9` `COPY . .`; tar layers contain `app/.env.bak-*`; both code points now fixed (`.dockerignore` + `deploy.ps1:207,215-222`). Fix is **forward-looking only**. |
| *UNPROVEN residual* | **UNPROVEN** | Whether the pods running *right now* still use that image cannot be read from this machine: `docker` daemon absent (`npipe ... The system cannot find the file specified`) and `kubectl` has no context (`error: current-context is not set`; API falls back to `localhost:8080` → refused). Evidence is the applied manifest + the completed 14.10 deploy flow, which is strong but not a live cluster read. |
| HIGH-1: `auth.js:77-78` + `:20-23` — no-`jti` session accepted with no DB lookup, so logout/reset revocation is meaningless for that shape | **VERIFIED (code) / CRITICAL in combination** | `middleware/auth.js:20-23` (`legacySession = tokenType === 'session' && !jti` → `next()`) and `:77-78` (`if (verified.tokenType === 'session' && !verified.jti) decoded = verified`). No `isAuthTokenActive` call, no `User` lookup bypassed? — `User.findByPk` still runs (`:114`) but is not a revocation check. Exploitability of *pre-existing* legacy tokens is UNPROVEN (no prod DB). Exploitability *given the leaked SECRET_KEY* is certain: forging `{id, tokenType:'session'}` yields a non-revocable token for any account; this is why B2 is CRITICAL. `Backend/_notif_smoke.mjs:100-104` demonstrates the exact token shape. |
| HIGH-2: `chatRoutes.js` had no auth middleware; `chatController.getUserId` only `jwt.verify` (no `isAuthTokenActive`, no `tokenType` check) | **REFUTED against current content — FIXED** | `git diff` (landed 11:39 today): `chatController.js` no longer imports `jsonwebtoken`; `getUserId(req) { return req.user?.id ?? null }`; `chatRoutes.js` adds `import { optionalAuth }` and `router.use(optionalAuth)` (line 9). Re-derived from the current files, hashes `129253AA2E2F95A7` / `9575EC9F7146C3C4`. *Caveat:* `optionalAuth` inherits the same no-`jti` acceptance as HIGH-1. |
| MEDIUM: `passkeyController.js:194,346` `requireUserVerification: false` | **VERIFIED** | Both lines present. Allows a passkey assertion with `userVerification` not required. Severity as stated (MEDIUM). |
| MEDIUM: enumeration via `userRoutes.js:117,128` → `passkeyController.js:455-474` | **VERIFIED** | `GET /api/users/check-username` (rate-limited) and `GET /api/users/passkey/exists` (rate-limited) are pre-auth and disclose existence. |
| MEDIUM: `rateLimitStore.js:15` `passOnStoreError` (limiters fail open) | **VERIFIED** | `return store ? { store, passOnStoreError: true, ...extra } : { passOnStoreError: true, ...extra }`. If Redis is down, login/reset/chat limits are effectively off. |
| MEDIUM: reset token in GET query (`userRoutes.js:94-98`) | **VERIFIED** | `router.get('/password-reset/verify', ...)` — token travels in the URL (logs/referrer/history). |
| MEDIUM: `origins.js:89` honours `LOCAL_DEV_ORIGINS` in production with `credentials: true` | **VERIFIED** | `origins.js:89` runs **before** the `nodeEnv === 'production'` bail-out at `:90`; `Backend/.env:11` sets `LOCAL_DEV_ORIGINS=http://localhost:5173,http://127.0.0.1:5173,http://192.168.0.111:5173,http://192.168.0.176:5173`, and `deploy.ps1:338-343` copies it into the production ConfigMap (it is not in `$overriddenKeys`). |
| MEDIUM: root `.gitignore` lacks `.env.*` | **REFUTED (now)** | True at HEAD (`.env.local`, `.env.*.local`); the working tree has `.env.*` + `!.env.example` (`git diff -- .gitignore`). No `.env*` file is tracked (`git ls-files` → none) nor ever added in history (`git log --all --diff-filter=A -- '*.env'` → empty). |

### task-2 — logic / migrations

| Claim | Verdict | Evidence / correction |
|-------|---------|-----------------------|
| Migration hypothesis: `watering_logs.metadata` missing → production startup hard-fails | **REFUTED** | Baseline `Backend/backups/pre_auth_migration.sql:546-557` declares `metadata jsonb DEFAULT '{}'::jsonb NOT NULL` (and `:313-331 plants.metadata`, `:259-268 plant_photos.metadata`, `:135-146 chat_logs.metadata`). I dumped all 18 models' tables/columns via `sequelize.models` and matched every one against dump + `Backend/migrations/*.sql`: `users` (+`welcome_email_sent_at` `20261012_add_welcome_email_sent_at.sql:3`, +`timezone` `20261013_add_user_timezone.sql:3`, +`created_at` `20261012_create_admin_analytics.sql:5-44`), `auth_sessions`/`passkeys`/`passkey_challenges` (`20261002:3-49`), `notification_preferences` (`20261005:3-11`), `notifications` (`20261006:3-16`), `push_broadcasts`/`push_broadcast_recipients` (`20261010:3-34`), `password_reset_tokens` (`20261012:3-12`), `site_visit_days` (`20261012_create_admin_analytics.sql:50-61`); the remaining tables come from the dump. `index.js:247-270` guard is consistent with Sequelize (`field || fieldName` = the already-snake_case attribute names). Deploy order is safe in both paths (compose `migrate` before `backend`; `deploy.ps1:608-618` migrations before `:626` rollout). |
| *UNPROVEN residual* | **UNPROVEN** | The guard cannot be executed against the real DB here (no Postgres, no Docker daemon, no cluster). Evidence is static: the declared baseline + migrations + `.k8s-images/deploy.log` reporting `Таблиц в базе кластера: 15`. |
| HIGH: `reminderService.js:340-354` — notification row persisted before push; next tick sees `created=false` and returns early without sending ⇒ that slot's push permanently suppressed | **REFUTED as described** | `storeNotification` (`services/notificationService.js:20-37`) **never** short-circuits on a duplicate — it always returns `{notification, created}` with a non-null row, and `notify()` (`reminderService.js:338-363`) **always** calls `pushService.sendToUser` and ignores `created`. Neither `sendDayBefore` (`:256-283`) nor `sendOnDay` (`:285-312`) has a `created`-based early return; they gate only `markNotified` on `result.sent > 0`. **Residual (real, MEDIUM, not "permanent suppression"):** if `sendToUser` fails or the user has no subscriptions, the in-app row exists but no push is retried outside the ±(15 min) query window, and `pushService.sendToUser` returns `{success:false, message:'No subscriptions'}` with **no `sent` field** (`services/pushService.js:30,42`) so `result.sent > 0` is `undefined > 0`. |
| HIGH: `pushBroadcastService.js:123` | **VERIFIED — FIXED** | See §4 row 3. |
| MEDIUM: `adminManageController.js:866` stale `nextWateringAt` | **VERIFIED — FIXED** | See §4 row 4. |
| MEDIUM: `adminManageController.js:834` no `converted_from_skip` restore vs `plantController.js:1146-1156` | **VERIFIED — still open** | User path restores a skip-converted watering back to `action:'skipped'` and keeps the row (`plantController.js:1146-1159`); admin path destroys the row outright (`adminManageController.js:834`). Deleting the latest entry of a skip-converted slot permanently loses the skip record and re-points `last_watered_at` to the previous watering. Product decision, documented as open. |
| MEDIUM: `reminderService.js:318` `isReminderWeekday` uses local time `getDay()` | **VERIFIED** | `wateringSchedule.js:331-335` → `weekdays.includes(scheduledDate.getDay())`, i.e. **runtime** TZ (container UTC), not the user's IANA zone used everywhere else in the reminder path (`reminderService.js:196-201, 11-12`). For users whose local day differs from the UTC day, the weekday filter can select the wrong day → reminder sent on an unselected weekday or skipped. |
| MEDIUM: tick lock TTL 9 min vs `*/10` cron | **VERIFIED** | `reminderService.js:16` `TICK_LOCK_TTL_MS = 9 * 60 * 1000`, `:81` `cron.schedule('*/10 * * * *')`, `:88-94` `withDistributedLock(TICK_LOCK, {ttlMs})`. A tick exceeding 9 min loses the lock before the next one starts (duplicate tick if another replica has jobs enabled). Mitigated in k8s: jobs default to `false` (`10-configmap.yaml:30`, `deploy.ps1:374-393`). |
| MEDIUM: `autoSkipOverdue` has no per-plant catch | **VERIFIED** | `reminderService.js:106-161`: the per-candidate `try` re-`throw`s at `:159-161`, aborting the whole loop; `tick()` (`:175-182`) wraps all four senders in one `try`, so one poison plant skips `sendMorningSummary`, `sendDayBefore` **and** `sendOnDay` for that tick — and on every subsequent tick while it keeps failing. Arguably higher than MEDIUM. |
| MEDIUM: deleted tests leave 20 backend tests | **VERIFIED (deletion) / no hidden regression** | 20 tests remain (`middleware/auth.test.js`, `middleware/guestToken.test.js`, `services/pushBroadcastService.test.js`). All 29 restored deleted tests pass against current code (§3.6). |

### task-3 — frontend

| Claim | Verdict | Evidence / correction |
|-------|---------|-----------------------|
| build / eslint / verify all pass; no CRITICAL | **VERIFIED** | §3.2 raw output (build exit 0, 116 + 38 checks, lint exit 0, `npm test` = 0 test files). I found no client-side CRITICAL either. |
| HIGH: `editProfile.jsx:210-214` + `:59-64` — email editable, never sent; UI says "Профиль успешно сохранён" | **VERIFIED** | Email input is editable and bound (`editProfile.jsx:209-213`); PATCH body contains only `name, username, bio, phone` (`:59-64`); `userController.updateProfile` destructures `{ name, username, phone, bio, timezone }` — **no email** (`userController.js:369`); success message at `editProfile.jsx:71` then redirect. Silent loss of the user's edit. |
| MEDIUM: no fetch timeout / AbortController in `homePage.jsx` | **VERIFIED** | grep for `AbortController\|signal` in `homePage.jsx` → no matches; fetches at `:95,111,125,139` (and the rest) have no timeout; `:570` renders `Загружаем расписание…` while a hung request never settles. |
| MEDIUM: `getNotifications()` outside `allSettled`, no catch | **VERIFIED** | `homePage.jsx:189-194` `Promise.allSettled([...])` covers only 4 loaders, while `:217` calls `getNotifications()` bare inside `useEffect`; its `throw` on `!response.ok` (`:115-119`) becomes an unhandled rejection. |
| MEDIUM: `profile.jsx:327-337` logout ignores `response.ok` | **VERIFIED** | `await fetch('/users/logout', {method:'POST', credentials:'include'})` with no `ok` check, then `navigate('/register')`: a failed logout leaves the session cookie live while the UI says logged out. |
| MEDIUM: `registration.jsx:342` `type=''` submitted the login form | **VERIFIED — FIXED** | See §4 row 5. |
| MEDIUM: `NotificationPrompt.jsx:47-50` records subscribe failure as `'accepted'` | **VERIFIED** | `catch { markPushPromptAnswered('accepted') ... }` — the prompt never returns for a user whose push subscription failed. |
| MEDIUM: no error boundary | **VERIFIED** | grep for `ErrorBoundary\|componentDidCatch\|getDerivedStateFromError` under `Frontend/src` → no matches. |

---

## 6. Ranked blockers and findings

### 6.1 [CRITICAL · OPEN] Live credentials baked into the deployed production image
**Where:** `Backend/Dockerfile:9` (`COPY . .`) + `.k8s-images/webplant-backend-1.2.6-45225b0-dirty-5d039d6c.tar` (`app/.env.bak-20261012153426`, `app/.env.bak-20261012160419`) + `.k8s-images/backend.generated.yaml:65-66` (`imagePullPolicy: Never`); same content in 4 older tars, incl. the rollback image `df67d39-dirty-1ca44887`.
**Impact:** the bytes of the current `SECRET_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`, `VAPID_PRIVATE_KEY`, `YANDEX_CLOUD_API_KEY` (and a prior `SMTP_PASSWORD`) are readable inside every backend container's filesystem (`/app/.env.bak-*`) on the 6 cluster nodes that imported the image, and in 5 plain tar files on a cloud-synced disk (`.k8s-images/` is inside `Yandex.Disk`). With `SECRET_KEY` an attacker forges session tokens; with `VAPID_PRIVATE_KEY` they can sign push for the site; `YANDEX_CLOUD_API_KEY` is billable; `DB_PASSWORD`/`REDIS_PASSWORD` are full data-store credentials. `middleware/auth.js:77-78` makes forged no-`jti` tokens non-revocable.
**Minimal fix (in order):**
1. Rotate **all** secrets that appear in `.env.bak-*`: `SECRET_KEY` (invalidates all sessions — expected), `DB_PASSWORD`, `REDIS_PASSWORD`, `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` (all existing push subscriptions must be re-created), `YANDEX_CLOUD_API_KEY`, `SMTP_PASSWORD`. Update `Backend/.env`, the archive copies, and any provider consoles.
2. Purge the exposure: delete the 5 leaking tars *and* every other artifact that carried them; rebuild from the now-fixed context so the new image contains no `.env*`; verify with `tar -tf` per layer before loading. Remove the leaking image from the k8s nodes (and the `KEEP_IMAGE` rollback target) so `rollout undo` cannot resurrect it.
3. Fix the code path so it cannot recur: already done (`.dockerignore:5`, `deploy.ps1:207,215-222`) — but note `deploy.ps1` is still owned by `auth-auditor`; re-verify its hash before running (see §8).
4. Stop the image server after the load (§6.2).

### 6.2 [HIGH · OPEN · new] `deploy.ps1` leaves a plain-HTTP file server exposing the entire staging directory
**Where:** `Backend/k8s/scripts/deploy.ps1:436-441` (`docker run -d --name ctp_k8s_img_server --restart unless-stopped -p 8099:80 -v "${StagingDir}:/usr/share/nginx/html:ro" nginx:alpine`) — the container is recreated on each run but never removed at the end (`:504-507` only deletes the loader DaemonSet; `:669` removes only the *gateway*).
**Impact:** `.k8s-images/` (the leaking tars, `webplant-db.dump` with customer data, `webplant-env.properties`, and — until ~11:45 today — `webplant-secrets.yaml` + `webplant-secrets.properties` with live credentials) was served unauthenticated over `http://localhost:8099` and from pods via `host.docker.internal:8099`, with `--restart unless-stopped` surviving reboots.
**Minimal fix:** `docker rm -f ctp_k8s_img_server` after the loader reports ready (`:504`), and serve only a directory that contains the single tar (not `$StagingDir`).
**Observed change under me:** at 11:41 `.k8s-images/webplant-secrets.yaml` (567 B) and `webplant-secrets.properties` (361 B) existed; at 11:46 they are gone (someone deleted them during this verification). The tars and the DB dump are unchanged.

### 6.3 [HIGH · OPEN] No-`jti` session tokens bypass revocation
**Where:** `Backend/middleware/auth.js:77-78` (and the mirrored logic at `:20-23`).
**Impact:** any token shaped `{id, tokenType:'session'}` without `jti` authenticates with no `auth_sessions` lookup, so logout / password-reset revocation has no effect on it. Standalone this needs such a token to exist; with the leaked key (§6.1) it is an unconditional account-takeover primitive (including `ADMIN`).
**Minimal fix:** drop the legacy branch (require `isAuthTokenActive` for every `tokenType === 'session'`), or require `jti` and reject tokens without it. Deploy after rotating `SECRET_KEY` so no legacy tokens exist.

### 6.4 [MEDIUM · OPEN] Reminder push can be lost for a slot while the in-app row exists
**Where:** `Backend/jobs/reminderService.js:338-363` (`notify`), `:279-281`, `:308-310`; `Backend/services/pushService.js:30,42` (returns no `sent` when there are no subscriptions); query windows `:256-258` (±20/28 h) and `:286-287` (−5/+15 min).
**Impact:** if the push send fails (or the user has zero subscriptions), the notification row is kept but no push is retried after the slot leaves the window; `result.sent > 0` is also `undefined > 0` for the no-subscription shape. No future slot is suppressed (the auditor's described mechanism is refuted, §5).
**Minimal fix:** make `sendToUser` always return numeric `sent/failed/total` (add `sent: 0` to the `No subscriptions` returns) and retry an unsent slot for a bounded window (or mark the row for retry).

### 6.5 [MEDIUM · OPEN] Admin delete of a skip-converted watering loses the skip record
**Where:** `Backend/controllers/adminManageController.js:834` vs `Backend/controllers/plantController.js:1146-1159`.
**Impact:** deleting the latest entry of a slot that was a converted skip destroys the row instead of restoring `action:'skipped'`; skip history and the derived `last_watered_at` diverge from the user-facing path.
**Minimal fix:** mirror the `converted_from_skip` restore in the admin handler.

### 6.6 [MEDIUM · OPEN] 397 lines of tests deleted without replacement
**Where:** `D` `Backend/redis.test.js`, `Backend/services/aiService.test.js`, `Backend/services/mailService.test.js`.
**Impact:** `npm test` now covers 20 tests and no longer covers `redis.js` URL/timeout helpers, the AI prompt-injection boundary and parsers, or the mail config + HTML-escaping renderers. (Independently re-run: all 29 pass, so no regression is being hidden — this is coverage/process risk.)
**Minimal fix:** restore the three files (or re-add equivalent cases) before the deploy, so the shipped modules stay covered.

### 6.7 [MEDIUM · OPEN] Untracked dev script will be baked into the next image
**Where:** `Backend/_notif_smoke.mjs` (11888 B, untracked) — not matched by `Backend/.dockerignore`, so `COPY . .` (`Dockerfile:9`) and the `deploy.ps1` staging copy both include it.
**Impact:** a dev smoke harness (imports `express`, `pg`, `jsonwebtoken`; mints a no-`jti` session token from `SECRET_KEY`, `:100-104`) ships to production. Unreferenced by the app (grep for `_notif_smoke` in `Backend/**/*.js` → no matches) and contains no hardcoded secrets. Hygiene/packaging risk, and it advertises the §6.3 token shape.
**Minimal fix:** add `_notif_smoke.mjs` to `Backend/.dockerignore` (or delete it; the Lead asked me not to).

### 6.8 [MEDIUM · OPEN] Staging dir with secrets and a DB dump lives on a cloud-synced disk
**Where:** `.k8s-images/` inside `C:\Users\yvan0\Yandex.Disk\...` (gitignored via `.gitignore:26 .k8s-images/`, but synced to Yandex.Disk). Contains `webplant-db.dump` (76160 B) and 5 secret-bearing tars.
**Minimal fix:** keep the staging dir on a local, non-synced path (e.g. `%LOCALAPPDATA%`), delete dumps/tars after the deploy.

### 6.9 [MEDIUM · OPEN] Single RWO PVC shared by 2 backend replicas
**Where:** `Backend/k8s/40-backend.yaml:43` (`replicas: 2`), `:113-116` (`persistentVolumeClaim: backend-uploads`), `15-storage.yaml:16-29` (RWO). `deploy.ps1` defaults to `-Replicas 2` (`:10`), and the 10.10 log shows a **6-node** cluster.
**Impact:** with `ReadWriteOnce` and pods on different nodes the second pod can fail to attach the uploads volume → `maxUnavailable: 0` rollout stalls or CrashLoop. On a genuinely single-node cluster this is moot.
**Minimal fix:** `ReadWriteMany` (or one PVC per replica / RWX storage class), or pin all backend replicas to one node.

### 6.10 [MEDIUM · OPEN] `isReminderWeekday` uses the container's timezone, not the user's
**Where:** `Backend/utils/wateringSchedule.js:331-335` (`scheduledDate.getDay()`), called from `Backend/jobs/reminderService.js:318`.
**Impact:** for users whose local calendar day differs from UTC, the restricted-weekday filter can send on an unselected weekday or skip a selected one.
**Minimal fix:** compute the weekday from `getDateParts(plant.next_watering_at, userTimeZone)` (the helper already exists at `reminderService.js:19-34`).

### 6.11 [MEDIUM · OPEN] One failing plant aborts the whole reminder tick
**Where:** `Backend/jobs/reminderService.js:106-161` (per-candidate `catch` re-throws), `:175-182` (single `try` around all four senders).
**Impact:** a persistent per-plant DB error stops morning summaries, day-before and on-day reminders for **all** users on every tick.
**Minimal fix:** log and `continue` per candidate instead of re-throwing; wrap each sender in its own `try`.

### 6.12 [MEDIUM · OPEN] `LOCAL_DEV_ORIGINS` trusted in production
**Where:** `Backend/utils/origins.js:89-90` (dev origins checked before the production bail-out), `Backend/.env:11`, propagated into the k8s ConfigMap by `deploy.ps1:338-343`.
**Impact:** `http://localhost:5173` / `http://192.168.0.x:5173` remain credentialed-CORS-allowed in production (an attacker needs the victim to load a page on such an origin — low practical reach, but it is dev config in prod).
**Minimal fix:** only consult `LOCAL_DEV_ORIGINS` when `NODE_ENV !== 'production'` (or strip the key from the production ConfigMap).

### 6.13 [MEDIUM · OPEN] Rate limiters fail open
**Where:** `Backend/utils/rateLimitStore.js:15` (`passOnStoreError: true`).
**Impact:** if Redis is unavailable, login / password-reset / chat limits stop enforcing, i.e. brute force protection disappears exactly when infrastructure is degraded. Minimal fix: `passOnStoreError: false` for auth-critical limiters (accept 500s) or a memory fallback.

### 6.14 [MEDIUM · OPEN] Pre-auth account enumeration
**Where:** `Backend/routes/userRoutes.js:117` (`/check-username`), `:128` (`/passkey/exists`), `Backend/controllers/passkeyController.js:194,346,455-474`.
**Impact:** unauthenticated callers can probe usernames / whether an account has passkeys (rate-limited only).
**Minimal fix:** require auth for `/passkey/exists`, or return a uniform response.

### 6.15 [MEDIUM · OPEN] Password-reset token in a GET query string
**Where:** `Backend/routes/userRoutes.js:94-98` → `passwordResetController.verify`.
**Impact:** the token can land in access logs, `Referer` headers and browser history. Minimal fix: POST it in the body (the email link can still contain it, but the verify call should not be a GET with the token in the URL).

### 6.16 [MEDIUM · OPEN] Frontend UX/robustness items (no crash found)
* `editProfile.jsx:59-64,209-213` + `userController.js:369` — email edits are silently discarded while the UI reports success.
* `homePage.jsx:95,111,125,139` — no request timeout/`AbortController`; `:570` stays on `Загружаем расписание…`.
* `homePage.jsx:217` — `getNotifications()` outside `allSettled`, no `catch` → unhandled rejection.
* `profile.jsx:327-337` — logout ignores `response.ok` and still navigates to `/register`.
* `NotificationPrompt.jsx:47-50` — a failed subscribe is recorded as `'accepted'`.
* No error boundary anywhere under `Frontend/src`.

### 6.17 [INFO] Non-issues verified (so they are not re-litigated)
* **Env wiring is complete and correct.** Every variable `index.js:81-92` requires is present for both paths: compose via `env_file: .env`; k8s via `webplant-config` + `webplant-env` (generated from `.env` minus overridden/secret keys) + `webplant-secrets` (incl. `REDIS_URL`, `deploy.ps1:349-350`). `RP_ID`, `FRONTEND_ORIGIN`, `ADMIN_PANEL_ORIGIN`, `VAPID_*` are all provided; the real validators pass (§3.3).
* **`SERVER_PORT` is dead config.** `Backend/.env:15` sets `SERVER_PORT=3001`, but no backend file reads it (grep `SERVER_PORT` in `Backend/**/*.js` → no matches). `index.js:50` uses `PORT` (5000), set identically by `docker-compose.yml:125`, `10-configmap.yaml:10` and `40-backend.yaml:69,83,89,97`. No port mismatch.
* No secrets are committed: `git ls-files` matches no `.env`/`.bak`/secret file; `.env` was never added in history; `Bug-Tracker-WebPlant.csv` contains no credential strings.

---

## 7. Explicitly UNPROVEN (with reason)

1. **Runtime state of the production cluster** (are the leaking pods still running? did the 14.10 rollout finish? how many nodes?). Reason: no `docker` daemon (`npipe:////./pipe/dockerDesktopLinuxEngine` missing) and `kubectl` has no context (`current-context is not set`, API at `localhost:8080` refuses connections). Evidence used instead: the applied manifest, loader manifest, generated gateway conf and the 10.10 `deploy.log` (§3.5). *Recommendation: run `kubectl get deploy backend -n webplant -o jsonpath='{.spec.template.spec.containers[0].image}'` and `kubectl exec ... ls /app/.env.bak-*` on the machine that has the kubeconfig before the deploy.*
2. **Live DB schema.** Reason: no Postgres/Docker/network. The startup-blocker question is answered statically (§5, task-2) but the `index.js:247-270` guard was not executed against the real database.
3. **Whether legacy no-`jti` tokens exist in production.** Reason: no DB access. The code path is verified; the population of such tokens is not.
4. **`deploy.ps1` runtime behaviour** (robocopy staging, purge, throw, build). Reason: same tooling limitations. The file content is verified statically and its hash was stable across three checks, but `auth-auditor` may still edit it — **re-verify `sha256` `62DD17B3C1AA1141` (or update this report) immediately before running the deploy.**
5. **True failure modes requiring real Redis/Postgres/SMTP** (rate-limit fail-open, distributed lock expiry, mail delivery, push delivery). Not exercised.

---

## 8. Observation set and integrity caveats

* Files changed **under me during this verification** (I caught them): `Backend/controllers/chatController.js` + `Backend/routes/chatRoutes.js` (chat auth fix, 11:39), `Backend/jobs/reminderService.js` (11:40), `.gitignore` (11:41–11:43), and `.k8s-images/webplant-secrets.yaml` / `webplant-secrets.properties` (deleted ~11:45). All statements above refer to the hashes below; anything not listed may have moved.
* Frozen hashes (SHA-256, first 16 hex), 2026-10-15 11:47:49 +03:00:

| File | sha256[:16] |
|------|-------------|
| `Backend/k8s/scripts/deploy.ps1` | `62DD17B3C1AA1141` (BOM present) |
| `Backend/middleware/auth.js` | `F1CEDCC1C86DAE6E` |
| `Backend/routes/chatRoutes.js` | `9575EC9F7146C3C4` |
| `Backend/controllers/chatController.js` | `129253AA2E2F95A7` |
| `Backend/jobs/reminderService.js` | `070DD0ACE08FD18A` |
| `Backend/.dockerignore` | `F8A80BC5FA545B12` |
| `Backend/controllers/adminManageController.js` | `CE79A15293610423` |
| `Backend/services/pushBroadcastService.js` | `327E50C7F2919FB8` |
| `Backend/controllers/userController.js` | `39F0A3EDEF613E00` |
| `Backend/controllers/plantController.js` | `0051D67DE241A24A` |
| `Backend/utils/wateringSchedule.js` | `F9784934945C6D37` |
| `Backend/controllers/notificationController.js` | `B0175D84AF0FBCA9` |
| `.gitignore` | `FDFF194907E7B0A2` |
| `Frontend/src/component/registration/registration.jsx` | `1F33A5B5192A4B9E` |
| `Backend/.env` | `AA49C10B617AAB96` (secret values deliberately not reproduced) |

* `node v24.20.0`; `docker.exe`/`kubectl.exe` installed but daemon/cluster unreachable; Postgres/Redis are compose/k8s services and were not contacted.
* I modified nothing outside this report. `Frontend/dist/` was regenerated by the mandatory `npm run build` (build artifact, gitignored).

---

## 9. What would flip this to GO

1. Rotate every credential that was in `.env.bak-*` (`SECRET_KEY` at minimum, plus DB/Redis/VAPID/Yandex/SMTP) and update `Backend/.env` + the cluster Secret.
2. Delete the 5 leaking tars, rebuild a clean image, verify no `.env*` in any layer, and remove the old image (and the `KEEP_IMAGE` rollback target) from the nodes; stop `ctp_k8s_img_server`.
3. Land §6.3 (reject no-`jti` sessions) — cheap and it closes the takeover path that the leaked key amplifies.
4. Re-run the 0-gate: `cd Backend; npm test` (20 pass), `cd Frontend; npm run build && npm run verify && npm run lint` (all exit 0), and re-verify `deploy.ps1`'s hash.
5. Restore/redo the 3 deleted test files before the next release.

---

## 10. ADDENDUM — Lead actions after the frozen observation set (2026-10-15, after 11:47 +03:00)

This section supersedes §1/§9 only where it says so. The verifier's findings were accepted; the following were applied by the Lead afterwards and then re-verified.

| # | Action | File | Effect |
|---|--------|------|--------|
| A1 | Removed the no-`jti` session shortcut in both places, so every session token must have an active `auth_sessions` row | `Backend/middleware/auth.js` (refresh path + `authenticate`) | Closes report blocker **B2**. Non-revocable forged tokens no longer authenticate. |
| A2 | Image server mounts only the single image tar, drops `--restart unless-stopped` in favour of `--rm`, and is removed after the loader finishes | `Backend/k8s/scripts/deploy.ps1` | Closes the verifier's new HIGH #3: port 8099 no longer exposes the whole `.k8s-images/` directory (db dump, uploads archive, manifests) and does not survive reboots. |
| A3 | Restored the three uncommitted test deletions | `Backend/redis.test.js`, `Backend/services/aiService.test.js`, `Backend/services/mailService.test.js` | Backend suite is now 49/49 passing (was 20). Coverage loss reversed; the verifier had confirmed the restored tests pass against current code. |
| A4 | Added `_notif_smoke.mjs` to the build ignore list | `Backend/.dockerignore` | Dev smoke script no longer ships in the image. |
| A5 | Root ignore now covers all env backups (`.env.*`, with `!.env.example`) | `.gitignore` | A stray `.env.bak-*` in the repo root can no longer be committed. |
| A6 | UTF-8 BOM restored after the Lead's `deploy.ps1` edits | `Backend/k8s/scripts/deploy.ps1` | PowerShell 5.1 parses the file correctly again (Cyrillic strings); AST parse = 0 errors. |

**Re-verified after A1–A6 (Lead, same machine):**
* `node --check` = 0 on `auth.js`, `chatRoutes.js`, `chatController.js`, `adminManageController.js`, `reminderService.js`, `pushBroadcastService.js`.
* `cd Backend; npm test` → **49/49 pass, 0 fail**.
* `cd Frontend; npm run build` → exit 0; `npm run verify` → exit 0 (38/38 routing); `npm run lint` → exit 0.
* `deploy.ps1`: BOM present, AST parse errors = 0; intended edits present (`.env*` exclusion + purge + fail-closed throw, single-tar mount, post-load `docker rm -f`).
* App import graph loads end-to-end (`node index.js` reaches the DB connection attempt; fails only on the intentionally unreachable DB port).
* Secret sweep: no `.env.bak-*` or `webplant-secrets.*` left in the repo tree; the current `SECRET_KEY` appears in no tracked file; `Backend/.env` is untracked and absent from git history. `.k8s-images/webplant-env.*` holds only non-secret config plus the public VAPID key.

**Still OPEN — not fixable from this machine:**
1. **B1 remains a release blocker**: the 5 leaking tars (incl. the rollback image), the stale image on the 6 nodes, and the credentials inside them. Rotation + purge are operator actions.
2. Live cluster state (`kubectl get deploy backend -n webplant -o jsonpath='{.spec.template.spec.containers[0].image}'`) and the live DB schema were never observable here.
3. Non-blocking items from §6 (editProfile email silently dropped; broadcast/notification edge cases; fetch timeouts; no error boundary; k8s `BACKGROUND_JOBS_ENABLED=false` with 2 replicas; single RWO PVC with 2 replicas).

**Current verdict with A1–A6 applied: NO-GO until B1 (rotation + purge) is done. All code-side blockers are closed.**

---

## 11. ADDENDUM 2 — every non-blocking item from §6 closed (2026-10-15, after 12:00 +03:00)

The §6 non-blocking list was worked off by the Lead plus three fixer teammates on disjoint write scopes (task-5 k8s, task-6 backend logic, task-7 frontend). No code comments were added anywhere (explicit user requirement).

| # | Item (§6) | Fix | File |
|---|-----------|-----|------|
| N1 | editProfile email silently dropped | `PATCH /api/users/me` now accepts `email` with format validation and a case-insensitive uniqueness check (`isEmailTaken`, mirroring `isUsernameTaken`); the 409 message covers both fields; the form sends the normalized email and validates it client-side | `Backend/controllers/userController.js`, `Frontend/src/component/editProfile/editProfile.jsx` |
| N2 | k8s background jobs disabled (reminders/broadcasts never ran) | `BACKGROUND_JOBS_ENABLED: "true"` after proving all three cron entry points are `withDistributedLock`-wrapped on the shared cluster Redis; lock-safety proof recorded as a metadata annotation | `Backend/k8s/10-configmap.yaml` |
| N3 | RWO PVC with 2 replicas | `replicas: 1` (uploads must be shared and no RWX class exists, so the 2nd replica was never HA) + PDB `maxUnavailable: 1`; `deploy.ps1 -Replicas` default lowered from 2 to 1 so the script no longer overrides the manifest | `Backend/k8s/40-backend.yaml`, `Backend/k8s/scripts/deploy.ps1` |
| N4 | liveness probe coupled to the DB | New DB-independent `GET /livez`; deployment liveness now uses it, so a Postgres blip no longer empties endpoints or CrashLoops the pods. Readiness keeps `/health` deliberately | `Backend/index.js`, `Backend/k8s/40-backend.yaml` |
| N5 | no graceful shutdown | SIGTERM/SIGINT handler drains in-flight requests via `server.close()`, closes Redis, force-exits after 20 s | `Backend/index.js` |
| N6 | timezone-unaware reminder weekday | `isReminderWeekday(weekdays, date, timeZone)` derives the weekday from `Intl` zoned parts; `reminderService` passes each user's zone via the existing `loadTimeZones()`. Moscow fallback preserved | `Backend/utils/wateringSchedule.js`, `Backend/jobs/reminderService.js` |
| N7 | tick lock TTL 9 min vs `*/10` cron | `TICK_CRON`/`TICK_INTERVAL_MINUTES`/`TICK_LOCK_TTL_MS` derive from one constant so period and TTL cannot drift | `Backend/jobs/reminderService.js` |
| N8 | one poison plant kills the whole tick | Per-plant try/catch with guarded rollback; the loop continues, so morning summary / day-before / on-day still run | `Backend/jobs/reminderService.js` |
| N9 | admin delete loses a skip record | `converted_from_skip` restore ported from `plantController` into the admin delete path, reported as `restoredSkip` | `Backend/controllers/adminManageController.js` |
| N10 | fetch hangs leave homePage stuck | Shared `fetchWithTimeout` helper (15 s AbortController, forwards an external signal) used by all 8 homePage fetches; unmount-safe timers added | `Frontend/src/utils/fetchWithTimeout.js`, `Frontend/src/component/homePage/homePage.jsx` |
| N11 | `getNotifications()` unhandled rejection | Wrapped in try/catch; a notification failure can no longer break the page or hide the badge | `Frontend/src/component/homePage/homePage.jsx` |
| N12 | logout ignores `response.ok` | Failure now shows an inline alert and does not navigate; success goes to `/login`, matching `home.jsx` | `Frontend/src/component/profile/profile.jsx` |
| N13 | failed push subscribe recorded as accepted | Records `declined`, so `shouldOfferPushPrompt` can offer again after the existing 7-day cooldown (no per-visit loop) | `Frontend/src/component/NotificationPrompt/NotificationPrompt.jsx` |
| N14 | no error boundary | New `ErrorBoundary` wrapping `App` for both `hydrateRoot` and `createRoot`; prerendered markup unaffected | `Frontend/src/component/ErrorBoundary/ErrorBoundary.jsx`, `Frontend/src/main.jsx` |
| N15 | origins: `LOCAL_DEV_ORIGINS` trusted in production | Now only honoured when `NODE_ENV !== 'production'` | `Backend/utils/origins.js` |
| N16 | dead code / stale artifacts | Removed commented-out live JSX in `visionNextPlant.jsx`; deleted the dead `ForgotPasssword` component (imported a missing module, unrouted); `_notif_smoke.mjs` reworked to mint a real `auth_sessions`-backed token (it relied on the removed no-`jti` shortcut) | `Frontend/src/component/visionNextPlant/visionNextPlant.jsx`, `Frontend/src/component/ForgotPasssword/`, `Backend/_notif_smoke.mjs` |

**Gates re-run after all work (12:10 +03:00):** backend `node --check` clean on all 12 changed JS/MJS files; `cd Backend; npm test` → **49/49 pass, 0 fail**; `cd Frontend; npm run build` → exit 0, `npm run verify` → exit 0 (116 + 38 checks), `npm run lint` → exit 0 (0 errors, 0 warnings); `deploy.ps1` BOM present and AST parse 0 errors.

**Deliberately NOT changed (reported, not silently skipped):**
* `converted_from_skip` on a log that is *not* the latest action is still destroyed in both the user and admin paths (faithful parity). Changing it needs a product decision.
* `passkeyController` `requireUserVerification: false` (2 call sites) and the format-only guest-token identity: both are behaviour/security-posture changes with breakage risk, held back as decisions rather than release work.
* Account enumeration via `check-username` / `hasPasskey`, reset token in a GET query (lands in access logs), `rateLimitStore` fail-open (`passOnError: true` — deliberate availability tradeoff), and `/health` stats disclosure: documented, not changed.
* `Backend/k8s/30-redis.yaml` still uses `--maxmemory-policy allkeys-lru`, which can evict a held distributed lock under memory pressure (`noeviction` would be the hard guarantee). Left as a recommendation.

**Release command remains the §9/§10 sequence, with two additions from task-5:** `deploy.ps1` patches `BACKGROUND_JOBS_ENABLED` *after* `kubectl apply`, so the cutover must run `deploy.ps1 -EnableBackgroundJobs` (otherwise the cluster keeps its old value) and confirm `GET /health` reports `backgroundJobs: true`; and the compose backend must stop running jobs (or share one Redis) before the k8s jobs are enabled, or reminders/broadcasts will be sent twice.

**Verdict unchanged: NO-GO until B1 (credential rotation + purge of the leaking images) is done. Every code-side and non-blocking item is now closed.**
