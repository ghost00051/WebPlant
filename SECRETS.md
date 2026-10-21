# SECRETS.md — реестр секретов WebPlant

Реестр закрывает аудит-пункты I6.1 (инвентарь секретов) и B20.5. Значения секретов в
документе, репозитории и тикетах **не хранятся**.

Владелец всех секретов — **владелец продукта** (роль). Он же принимает решение о ротации
и фиксирует её в журнале в конце документа.

## 1. Где что хранится

| Хранилище | Что лежит | Кто имеет доступ |
| --- | --- | --- |
| `Backend/.env` на сервере (compose) | все переменные backend, включая секреты | владелец продукта (SSH/RDP к серверу) |
| Kubernetes Secret `webplant-secrets` (namespace `webplant`) | `SECRET_KEY`, `DB_PASSWORD`, `REDIS_PASSWORD`, `REDIS_URL`, `VAPID_PRIVATE_KEY`, `SMTP_PASSWORD`, ключи из `$secretKeys` в `deploy.ps1` | владелец продукта, аккаунт с доступом к кластеру |
| Kubernetes ConfigMap `webplant-env` / `webplant-config` | не секреты: `DB_NAME`, `DB_USER`, `DB_HOST`, `SMTP_HOST/PORT/SECURE`, `MAIL_*`, таймауты, retention, флаги | тот же доступ (значения не секретны) |
| Корневой `.env` / `deploy.config.json` | параметры FTP-деплоя фронта, в т.ч. `DEPLOY_PASSWORD` | владелец продукта (локальная машина деплоя) |
| `Backend/certbot/conf/` на диске сервера | приватный ключ TLS Let's Encrypt, ключ ACME-аккаунта | root/владелец сервера; **в git не попадает** (`git ls-files Backend/certbot` пуст) |
| `Backend/backups/` | дампы БД и архивы `uploads` (содержат персональные данные); шифрование — только если задан `BACKUP_ENCRYPTION_PASSPHRASE` (gpg/age) | владелец продукта; права `umask 077` |
| GitHub Secrets | `GITHUB_TOKEN` (автоматический, для gitleaks/issue), при необходимости `GITLEAKS_LICENSE` (для приватных репозиториев организаций); прикладных секретов нет | GitHub Actions; workflow `security` (`ci.yml`) |
| `users.password` в БД | bcrypt-хэши паролей пользователей | доступ к БД |

Правила:

* секреты не коммитятся и не попадают в скриншоты/логи; `Backend/.env`, `.env.*`,
  `deploy.config.json`, `Backend/certbot`, `Backend/backups`, `Backend/uploads` исключены
  через `.gitignore`/`.dockerignore` (`.env` и `.k8s-images/` — в корневом `.gitignore`);
* образ backend собирается без `.env` (`Backend/.dockerignore`), переменные приходят из
  окружения контейнера;
* файл `Backend/_notif_smoke.mjs` умеет чеканить реальные токены сессий и поэтому исключён
  из образа — не копируйте его в контейнеры и не публикуйте;
* пароль Redis при первом `deploy.ps1` генерируется и затем переиспользуется; менять его
  произвольно нельзя без обновления `REDIS_URL` (иначе backend потеряет Redis);
* утечки ищутся автоматически: job `security` в CI запускает `gitleaks` по полной истории
  и `npm audit` для обоих пакетов; находка в CI — повод действовать по §3, даже если
  секрет уже удалён из кода.

## 2. Реестр

Легенда: «ротация» — см. `RUNBOOK.md` §8 (там точные команды).

| № | Секрет | Где хранится | Для чего | Ротация | Периодичность |
| --- | --- | --- | --- | --- | --- |
| 1 | `SECRET_KEY` | `.env` / Secret `webplant-secrets` | подпись JWT (session/access/refresh) **и** HMAC гостевых токенов | RUNBOOK §8.1: отозвать все `auth_sessions`, сгенерировать ≥32 байта, перезапустить | 12 месяцев, при утечке, при уходе человека с доступом |
| 2 | `DB_PASSWORD` | `.env` / Secret; читается postgres, `migrate`, `backup`, backend | доступ к PostgreSQL | RUNBOOK §8.5 | 12 месяцев или при утечке |
| 3 | `REDIS_PASSWORD`, `REDIS_URL` | `.env` / Secret | доступ к Redis (AOF, пароль в `--requirepass`) | RUNBOOK §8.6 | 12 месяцев или при утечке |
| 4 | `YANDEX_CLOUD_API_KEY` | `.env` / Secret | вызовы Yandex Cloud AI | RUNBOOK §8.4: новый ключ → перезапуск → отзыв старого | 12 месяцев или при утечке/смене исполнителя |
| 5 | `VAPID_PRIVATE_KEY` (`VAPID_PUBLIC_KEY` — публичный) | `.env` / Secret | подпись push-уведомлений | RUNBOOK §8.2: `npx web-push generate-vapid-keys`, пометить подписки недействительными | 12 месяцев, при утечке, при смене домена |
| 6 | `SMTP_PASSWORD` (пароль приложения почты) | `.env` / Secret | письма: сброс пароля, приветствие, рассылки | RUNBOOK §8.3 | 6–12 месяцев, при утечке, при смене провайдера |
| 7 | `DEPLOY_PASSWORD` (FTP) | корневой `.env` / `deploy.config.json` (вне git) / секрет-хранилище | выгрузка `Frontend/dist` | сменить в панели хостинга, обновить локально, проверить `upload-dist.ps1 -ListRemote` | 6 месяцев или при утечке |
| 8 | Приватный ключ TLS (`Backend/certbot/conf/live/...`) и ключ ACME-аккаунта | файлы на сервере (не в git) | HTTPS на `server.checktheplants.ru` | автоматически certbot каждые 60–90 дней; при компрометации — `certbot revoke` + новый выпуск | автоматически |
| 9 | `PGADMIN_DEFAULT_PASSWORD` | передаётся в окружение при запуске `docker-compose.pgadmin.yml` | вход в pgAdmin | сменить в pgAdmin и в окружении запуска (`Backend/PGADMIN.md`) | 12 месяцев или при утечке |
| 10 | Пароль администратора приложения (`role = ADMIN`) | bcrypt-хэш в `users.password` | вход в админ-панель | смена пароля в интерфейсе + отзыв сессий (`UPDATE auth_sessions SET revoked_at = now() …`) | 6–12 месяцев, при утечке, при уходе администратора |
| 11 | Сессионные и refresh-токены пользователей | JWT в httpOnly cookie; в БД только `sha256(jti)` | аутентификация | отзыв строк в `auth_sessions` (`revoked_at`) | по инциденту/при смене пароля |
| 12 | `Idempotency-Key` рассылок | Redis `ctp:idem:*` + `push_broadcasts.idempotency_key` | защита от дублей | TTL 24 часа, отдельной ротации не требует | — |
| 13 | `BACKUP_ENCRYPTION_PASSPHRASE` | `.env` / Secret (compose) или Secret/переменная Job (k8s) | шифрование дампов (`backup.sh`: gpg/age) | сменить пароль, перешифровать новый дамп; старые дампы остаются под старым паролем до истечения 14 дней | 12 месяцев или при утечке; при утечке считать все дампы скомпрометированными |
| 14 | Токены отписки от рассылок | **не хранятся**: HMAC-SHA256(`unsubscribe:<user_id>`, `SECRET_KEY`) | ссылки `/unsubscribe?uid&token` | ротация вместе с `SECRET_KEY` (старые ссылки перестают работать) | при ротации `SECRET_KEY` |
| 15 | `GITLEAKS_LICENSE` (если используется) | GitHub Secrets | лицензия gitleaks для приватного репозитория организации | перевыпуск в кабинете gitleaks | при утечке/смене организации |

не являются секретами (можно хранить в ConfigMap/репозитории): `DB_NAME`, `DB_USER`,
`DB_HOST`, `DB_PORT`, `FRONTEND_URL`, `FRONTEND_ORIGIN`, `ADMIN_PANEL_ORIGIN`, `RP_ID`,
`RP_NAME`, `PASSKEY_REQUIRE_USER_VERIFICATION`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`,
`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `MAIL_FROM`, `MAIL_REPLY_TO`,
`YANDEX_CLOUD_FOLDER`, `YANDEX_CLOUD_MODEL`, `UNSUBSCRIBE_URL_BASE`, `BACKUP_RETENTION_DAYS`,
`BACKUP_OFFSITE_TARGET` (сам адрес хранилища — не секрет, но доступ к нему — да),
лимиты, таймауты и retention-переменные.

## 3. Что делать при утечке

Порядок одинаковый для всех секретов; различаются команды ротации.

1. **Немедленно** (не дожидаясь разбора): ротировать скомпрометированный секрет по
   `RUNBOOK.md` §8. Для `SECRET_KEY` — сначала отозвать все `auth_sessions`, потом менять
   ключ; для `VAPID` — пометить подписки недействительными; для `DB_PASSWORD`/`REDIS_PASSWORD` —
   сменить пароль и перезапустить зависимые сервисы.
2. **Оценить охват**: какие системы видели секрет (репозиторий, чат, скриншот, чужой
   ноутбук, CI-лог), за какой период, был ли доступ к продовым данным.
3. **Проверить следы использования**: логи backend (`unhandled_error`, всплески
   `/api/users/registration`, `/api/users/login`, `/api/admin/*`), попытки подключения к
   БД/Redis, обращения к Yandex Cloud (квоты/биллинг), отправленные письма, push-рассылки.
4. **Оценить персональные данные**: если есть риск доступа к данным пользователей —
   действовать по `INCIDENT-RUNBOOK.md`, включая уведомление РКН в течение 72 часов.
5. **Зафиксировать**: запись в журнале ротаций (§4), отчёт об инциденте и постмортем.
6. **Устранить причину**: убрать секрет из коммита (и из истории, если попал),
   добавить проверку в `.gitignore`/pre-commit, ограничить доступ, сменить способ передачи.

### 3.1 Если секрет попал в git

```powershell
# есть ли файл в истории и что в нём было
git log --all --oneline -- Backend/.env
git log -p --all -- Backend/.env | Select-String -Pattern "SECRET_KEY|DB_PASSWORD|API_KEY"

# после очистки истории — обязательная ротация всех засвеченных секретов
```

Пока история не переписана, секрет считается публичным: ротация важнее «удаления коммита».

## 4. Журнал ротаций

Заполняется владельцем продукта вручную (дата, секрет, причина, кто выполнил, где
обновлено, проверка после ротации).

| Дата | Секрет | Причина | Кто | Проверка |
| --- | --- | --- | --- | --- |
| — | — | журнал пуст: плановые ротации ещё не выполнялись | — | — |

Регламент регулярных проверок (пентест, ревизия доступов, TLS, лицензии) — в
`docs/REVIEW-CHECKLIST.md`. Действия при инциденте — `INCIDENT-RUNBOOK.md`.
