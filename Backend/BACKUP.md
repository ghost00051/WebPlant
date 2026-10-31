# Бэкапы: база и фото

Два раза в сутки, в 02:00 и 14:00 по Москве, снимается **полный** бэкап боевого
окружения: дамп PostgreSQL **и** архив фотографий из кластера.

## Кто что делает

| Слой | Чем | Что попадает | Куда |
| --- | --- | --- | --- |
| Хост (**основной**) | `Backend/scripts/backup-all.ps1`, задача планировщика Windows `WebPlant full backup` | дамп базы + `uploads` (фото) | `Backend/backups/` на диске сервера |
| Кластер (вспомогательный) | CronJob `db-backup` (`k8s/jobs/db-backup.cronjob.yaml`) | только дамп базы | PVC `backend-backups` |

Хостовый слой — тот, что переживает потерю кластера, поэтому он и содержит всё.
Кластерный CronJob оставлен для быстрого восстановления базы внутри кластера:
фото в него положить нельзя — PVC `backend-backups` (нода `desktop-worker4`) и
PVC `backend-uploads` (нода `desktop-worker2`) живут на разных нодах, а один под
не может смонтировать оба RWO-тома (проверено: под висит в `Pending`).

Оба слоя пишут результат в `backup_runs` (`source` = `host` / `cluster`), из неё
админка рисует обратный отсчёт и журнал с размерами дампа и фото.

## Расписание

- Хост: задача планировщика Windows `WebPlant full backup` — триггеры 02:00 и 14:00.
- Кластер: `schedule: "0 2,14 * * *"`, timeZone `Europe/Moscow`.

Админка считает следующий запуск из `BACKUP_TIMES` (по умолчанию `02:00,14:00`).
Если поменяешь время — поправь и задачу планировщика, и CronJob, иначе отсчёт соврёт.

Проверить/пересоздать задачу:

```powershell
Get-ScheduledTask -TaskName 'WebPlant full backup' | Get-ScheduledTaskInfo
Start-ScheduledTask -TaskName 'WebPlant full backup'      # запустить сейчас
```

Задача работает под текущим пользователем и только когда он в системе: ей нужен
его `kubectl` и `~/.kube/config`. Если сервер должен бэкапиться и после выхода из
системы — переведи задачу на «выполнять вне зависимости от входа» и сохрани пароль
(либо перенеси запуск на сервис).

## Что лежит в бэкапе

```
Backend/backups/
├── db-20261025T153857Z.dump          # pg_dump -Fc, проверен pg_restore --list
├── uploads-20261025T153857Z.tar.gz   # /app/uploads целиком (plants/, chat/, thumbs/)
├── .last-success                     # отметка и размеры последнего успеха
└── backup.log                        # журнал запусков
```

Ретенция — 14 дней (`BACKUP_RETENTION_DAYS` в `.env`), чистится при каждом запуске.

## Как снимаются файлы

- **База**: `pg_dump -Fc` внутри пода, проверка `pg_restore --list` там же, затем файл
  (≈220 КБ) выгружается потоком.
- **Фото**: `nice -n 19 tar -czf - -C /app/uploads .` — поток идёт сразу на хост,
  **в поде ничего не пишется**. Это важно: когда архив создавался в `/tmp` пода,
  backend убивался (liveness probe) и поток рвался на середине.
- Выгрузка идёт через `cmd.exe` (он пишет байты как есть), `kubectl cp` не используется:
  на больших объёмах он падает с `unexpected EOF`.
- Архив проверяется `tar -tzf` — оборванный поток не попадёт в бэкап: запуск честно
  помечается `failed`, файл удаляется.
- Под для exec выбирается только в фазе `Running`: упавшие поды
  (`ContainerStatusUnknown`) остаются в списке и ломают `exec`.

## Ручной запуск и восстановление

```powershell
# внеплановый бэкап (база + фото)
powershell -File Backend/scripts/backup-all.ps1
powershell -File Backend/scripts/backup-all.ps1 -SkipUploads   # только база
```

```powershell
# восстановить базу в кластер
kubectl cp Backend/backups/db-<stamp>.dump webplant/postgres-0:/tmp/restore.dump
kubectl exec -n webplant postgres-0 -- pg_restore --no-owner --no-privileges \
  --exit-on-error -U postgres -d WebPlant /tmp/restore.dump

# вернуть фото: распаковать архив в под backend (архив сначала скопировать в под)
kubectl cp Backend/backups/uploads-<stamp>.tar.gz webplant/<backend-pod>:/tmp/uploads.tar.gz
kubectl exec -n webplant <backend-pod> -- tar -xzf /tmp/uploads.tar.gz -C /app/uploads
```

## Диагностика

1. `Get-ScheduledTaskInfo -TaskName 'WebPlant full backup'` — `LastTaskResult = 0` значит успех.
2. `Backend/backups/backup.log` — построчный журнал.
3. «Пропуск» в админке — последний успешный запуск старше 14 часов (12 ч интервал + 2 ч допуска).
4. `kubectl get svc postgres-nodeport -n webplant` — сервис для pgAdmin/диагностики;
   сам бэкап теперь ходит через API кластера, а не через NodePort.
5. Фото не попали в бэкап — смотри лог: ошибка `не удалось выгрузить ...` означает,
   что не отвечает под backend; бэкап при этом честно помечен как `failed`.

## Что осталось за рамками

- Offsite-копия: можно добавить `rclone copy` в конец `backup-all.ps1`
  (в старом `backup.sh` эта логика была — история в git).
- Шифрование архивов: то же место, `gpg --symmetric` перед отправкой offsite.
