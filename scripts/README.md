# Синхронизация реестра багов с Google Sheets

Реестр багов ведётся в Google Sheets:
<https://docs.google.com/spreadsheets/d/1L7tFQ7F6zib4b-BS46vwNCk0VWiWdXrMIIXREyvNgPw/edit?gid=2001850722>

Скрипт [`sync-bug-tracker.mjs`](sync-bug-tracker.mjs) переносит таблицу в репозиторий:

| Файл | Роль |
| --- | --- |
| `Bug-Tracker-WebPlant.xlsx` | копия книги целиком: листы «Реестр багов», «Дашборд», «Справочники», «Инструкция», формулы и проверки данных |
| `Bug-Tracker-WebPlant.csv` | CSV-зеркало листа «Реестр багов»: по нему видно, что изменилось (дифф xlsx в git нечитаем) и определяется, нужно ли обновлять xlsx |

Google Sheets — источник правды: синхронизация односторонняя (Google → репозиторий), правки в xlsx/CSV при следующем запуске будут перезаписаны таблицей. Доступ к таблице нужен анонимный, по ссылке «Все, у кого есть ссылка → Читатель»: токены и сервисные аккаунты не используются.

## Запуск

```bash
node scripts/sync-bug-tracker.mjs            # обновить файлы, если таблица изменилась
node scripts/sync-bug-tracker.mjs --check    # только проверить; код возврата 1, если есть расхождение
node scripts/sync-bug-tracker.mjs --force    # перезаписать xlsx, даже если CSV не изменился
node scripts/sync-bug-tracker.mjs --print    # показать список багов и сводку по статусам
```

Коды возврата: `0` — успех (в режиме `--check` — расхождений нет), `1` — есть расхождения (`--check`), `2` — ошибка (нет доступа, нет сети, файл занят Excel).

Переменные окружения: `BUG_TRACKER_SHEET_ID`, `BUG_TRACKER_GID`, `BUG_TRACKER_XLSX`, `BUG_TRACKER_CSV`, `BUG_TRACKER_NODE` (путь к node.exe для `.cmd`-обёртки).

Если xlsx открыт в Excel, замена файла упадёт с понятной ошибкой — закройте книгу и повторите.

## Автоматизация

Синхронизация зарегистрирована в планировщике задач Windows и запускается ежедневно:

| Параметр | Значение |
| --- | --- |
| Задача | `WebPlant-BugTracker-Sync` (`\WebPlant-BugTracker-Sync`) |
| Расписание | ежедневно в 10:00, только когда пользователь в системе |
| Команда | [`sync-bug-tracker.cmd`](sync-bug-tracker.cmd) → `node scripts/sync-bug-tracker.mjs` |
| Лог | `%LOCALAPPDATA%\WebPlant\bug-tracker-sync.log` (UTF-8, при 256 КБ уходит в `bug-tracker-sync.prev.log`) |

Обёртка ищет Node.js в порядке: `BUG_TRACKER_NODE` → `node.exe` в `PATH` → `%ProgramFiles%\nodejs` → `%LOCALAPPDATA%\Programs\nodejs`. Лог в UTF-8, поэтому в PowerShell смотрите его как `Get-Content -Encoding utf8 $env:LOCALAPPDATA\WebPlant\bug-tracker-sync.log`.

Управление задачей:

```powershell
schtasks /Query  /TN "WebPlant-BugTracker-Sync" /V /FO LIST   # состояние и результат
schtasks /Run    /TN "WebPlant-BugTracker-Sync"               # запустить сейчас
schtasks /Change /TN "WebPlant-BugTracker-Sync" /ST 09:30     # другое время
schtasks /Delete /TN "WebPlant-BugTracker-Sync" /F            # удалить
```

Другие варианты, если планировщик не подходит:

**Git hook** — обновлять перед коммитом (`.git/hooks/pre-commit`):

```bash
#!/bin/sh
node scripts/sync-bug-tracker.mjs --quiet || exit 1
git add Bug-Tracker-WebPlant.xlsx Bug-Tracker-WebPlant.csv
```

**CI** — проверять, что реестр не отстал от таблицы:

```bash
node scripts/sync-bug-tracker.mjs --check
```

## Ограничения

- Односторонняя синхронизация: правки, внесённые прямо в xlsx/CSV, при следующем запуске будут перезаписаны таблицей.
- Задача планировщика выполняется только при активной сессии пользователя: «выполнять без входа в систему» потребовало бы сохранения пароля Windows.
- Если понадобится обратная запись (xlsx → Google Sheets), нужен сервисный аккаунт с доступом на редактирование либо Apps Script-вебхук: анонимной выгрузки для записи недостаточно.

## Git-хуки репозитория

Хуки лежат в [`.githooks/`](../.githooks/README.md), установщик копирует их в `$GIT_DIR/hooks`
(в этом репозитории — `C:\WebPlant.git\hooks`), чтобы хук не зависел от синхронизации Yandex.Disk:

```bash
node scripts/install-git-hooks.mjs             # установить/обновить копии хуков
node scripts/install-git-hooks.mjs --status    # сверить копии с источником
node scripts/install-git-hooks.mjs --uninstall # удалить установленные копии
```

Сейчас подключён [`.githooks/pre-push`](../.githooks/pre-push): при push он берёт `version` из
`Frontend/package.json` отправляемого коммита, ставит аннотированный тег `v<version>` на этот
коммит и отправляет его в тот же remote (разово пропустить: `WEBPLANT_SKIP_AUTOTAG=1 git push ...`).
