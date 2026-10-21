# WebPlant: бэкапы, восстановление и сертификаты (runbook)

Документ описывает эксплуатацию бэкапов в обоих контурах (compose — боевой, Kubernetes —
Docker Desktop), ежемесячный restore-тест, целевые RPO/RTO, ротацию секретов и
deploy-hook certbot. Он дополняет `k8s/README.md` (устройство кластера и деплой) и не
заменяет его.

Файлы, о которых идёт речь:

| Файл | Роль |
| --- | --- |
| `Backend/backup.sh` | бэкап в compose: `pg_dump -Fc` + `/uploads`, проверка, шифрование, offsite, heartbeat, retention |
| `Backend/docker-compose.yml` (сервис `backup`) | запускает `backup.sh` каждые 24 часа, хранит `./backups` на хосте |
| `Backend/k8s/jobs/db-backup.cronjob.yaml` | CronJob `db-backup`: ежедневно 02:00 в кластере, дамп на PVC |
| `Backend/k8s/15-storage.yaml` | PVC `backend-backups` (20Gi, ReadWriteOnce) |
| `Backend/k8s/05-serviceaccount.yaml` | ServiceAccount `webplant-backend` без прав в API кластера |
| `Backend/k8s/jobs/db-restore.job.yaml` | разовый Job восстановления БД (используется при переносе и в restore-тесте) |

## Применение изменений

Compose (боевой контур) — изменения не применяются сами:

```sh
cd Backend
docker compose config -q              # синтаксис без печати секретов
docker compose build nginx            # conf.d копируется в образ (Backend/nginx/Dockerfile)
docker compose up -d nginx certbot    # новый конфиг nginx и entrypoint certbot с deploy-hook
docker compose up -d backend backup   # read_only/tmpfs/logging/limits и новые env бэкапа
```

`backup.sh` смонтирован в контейнер как отдельный файл: после замены файла на хосте
контейнер может продолжать видеть старый inode, поэтому `docker compose up -d backup`
(recreate) обязателен, `restart` не достаточно.

Kubernetes: `kubectl apply` манифестов из раздела 2; `k8s/scripts/deploy.ps1` пока **не**
применяет ServiceAccount и CronJob — это шаг владельца.

---

## 1. Бэкапы в compose

`backup.sh` запускается из сервиса `backup` (`postgres:16-alpine`) в цикле
`while :; do backup.sh; sleep 86400; done`. Что происходит за прогон:

1. `pg_dump --format=custom` в скрытый временный файл `.tmp_<STAMP>_db.dump` (umask 077).
2. Проверка `test -s`: пустой или отсутствующий дамп — это `exit 1` с записью
   `ERROR` в лог (временный файл удаляется трапом).
3. Проверка целостности `pg_restore --list`: архив, который `pg_restore` не читает,
   публикуется только после успешного чтения оглавления (число записей пишется в лог).
4. Опциональное шифрование (см. ниже), затем файл получает финальное имя
   `webplant_<STAMP>.dump[.gpg|.age]`.
5. Архив `/uploads` (`uploads_<STAMP>.tar.gz[.gpg|.age]`) — те же проверки.
6. Опциональная offsite-выгрузка каждого готового файла.
7. Retention: удаляются файлы `webplant_*.dump*` и `uploads_*.tar.gz*` старше
   `BACKUP_RETENTION_DAYS` (по умолчанию 14) суток.
8. Heartbeat `/backups/.last-success` — пишется **последним** и только при полном успехе.

Каталог: `Backend/backups` на хосте (bind-mount `/backups`). Логи: `docker logs ctp_backup`
и файл `Backend/backups/backup.log` (только `INFO/WARN/ERROR`, без паролей).

### Heartbeat

`Backend/backups/.last-success` — простой `key=value`, читается мониторингом:

```
finished_at=2026-05-05T02:00:12Z
started_at=2026-05-05T02:00:03Z
stamp=20260505T020003Z
encryption=gpg
offsite=remote:webplant/backups
total_bytes=18349221
retention_days=14
file=/backups/webplant_20260505T020003Z.dump.gpg
size_bytes=10485760
file=/backups/uploads_20260505T020003Z.tar.gz
size_bytes=7863461
```

Алерт: `finished_at` старше 26 часов → бэкап не выполняется (контейнер `ctp_backup`
остановлен, `pg_dump` падает, offsite недоступен). При сбое heartbeat не обновляется
намеренно — «тихий» успех исключён.

### Шифрование

* `BACKUP_ENCRYPTION_PASSPHRASE` (пусто = выключено).
* Парольная фраза передаётся `gpg` через pipe (stdin, `--passphrase-fd 0`), не через
  argv — её нет ни в `ps`, ни в логах, ни в heartbeat.
* Приоритет: `gpg --symmetric` (AES256, `--pinentry-mode loopback`) → `age --passphrase`.
  `age` читает пароль только с терминала, поэтому в неинтерактивном контейнере он
  непригоден: `gpg` — рекомендуемый вариант для автоматических прогонов.
* Если задан passphrase, но ни `gpg`, ни `age` в образе нет — файл остаётся
  незашифрованным, в лог пишется `WARN` (прогон не падает, чтобы не потерять бэкап).
* Если инструмент есть, но шифрование не удалось — прогон завершается `exit 1`, ничего
  незашифрованного не публикуется (заданный секрет не игнорируется молча).

Шифрование стоит включить: дампы содержат хэши паролей пользователей и переписку.
Восстановление зашифрованного дампа:

```sh
# gpg
gpg --batch --pinentry-mode loopback --decrypt webplant_20260505T020003Z.dump.gpg > db.dump
# age
age --decrypt -o db.dump webplant_20260505T020003Z.dump.age
```

### Offsite

* `BACKUP_OFFSITE_TARGET` (пусто = выключено), например `rclone-remote:webplant/backups`.
* Нужен `rclone` в образе `backup` и настроенный remote (`rclone config` / `RCLONE_CONFIG_*`).
* Копирование: `rclone copy --no-traverse --retries 3 <файл> <target>`; ошибка
  логируется как `ERROR`, прогон завершается `exit 1`, heartbeat не обновляется, локальная
  копия остаётся.
* В стандартном образе `postgres:16-alpine` нет ни `gpg`, ни `rclone`, ни `age`:
  для включения шифрования/offsite нужен свой образ (например,
  `apk add --no-cache gnupg rclone age` поверх `postgres:16-alpine`) либо вынести
  эти шаги на хост.

### Проверка и восстановление в compose

```sh
# список бэкапов и heartbeat
ls -lah Backend/backups; cat Backend/backups/.last-success
# прогнать бэкап вне графика
docker exec ctp_backup /bin/sh /usr/local/bin/backup.sh
# читаемость дампа
docker exec ctp_backup pg_restore --list /backups/webplant_<STAMP>.dump | head
# восстановление (БД будет пересоздана!)
docker exec -i ctp_postgres pg_restore --clean --if-exists --no-owner --no-privileges \
  -U "$DB_USER" -d "$DB_NAME" < Backend/backups/webplant_<STAMP>.dump
```

---

## 2. Бэкапы в Kubernetes

CronJob `db-backup` (`k8s/jobs/db-backup.cronjob.yaml`):

* расписание `0 2 * * *`, `timeZone: Europe/Moscow` (поле поддерживается с Kubernetes
  1.27; на более старых кластерах оно игнорируется и время считается в поясе кластера —
  на kind/Docker Desktop это UTC, то есть 05:00 МСК);
* `concurrencyPolicy: Forbid` — два прогона не накладываются; `backoffLimit: 2`,
  `activeDeadlineSeconds: 1800`;
* образ `postgres:16-alpine`, запуск от uid/gid 70 (`postgres`), `readOnlyRootFilesystem`,
  `allowPrivilegeEscalation: false`, `seccompProfile: RuntimeDefault`, `/tmp` — `emptyDir`;
* `serviceAccountName: webplant-backend`, токен API не монтируется;
* дамп `pg_dump -Fc` → `/backups/db-<STAMP>.dump` на PVC `backend-backups` (20Gi,
  ReadWriteOnce, StorageClass `standard`);
* проверки: `test -s` (пустой дамп = падение), `pg_restore --list` (целостность);
* heartbeat `/backups/.last-success` (`finished_at`, `file`, `size_bytes`);
* retention: `find /backups -name 'db-*.dump' -mtime +14 -delete` (≈14 суток).

Применение (deploy.ps1 пока **не** применяет ServiceAccount и CronJob — шаг нужно добавить
в пайплайн или выполнить один раз вручную):

```sh
kubectl apply -f Backend/k8s/05-serviceaccount.yaml
kubectl apply -f Backend/k8s/15-storage.yaml       # добавит PVC backend-backups
kubectl apply -f Backend/k8s/jobs/db-backup.cronjob.yaml
kubectl get cronjob db-backup -n webplant
```

> **Важно:** `40-backend.yaml` теперь ссылается на `serviceAccountName: webplant-backend`.
> Если ServiceAccount не создан до применения Deployment, новые поды останутся в
> `Pending` (`serviceaccount "webplant-backend" not found`), а rollout зависнет
> (`maxUnavailable: 0` — старый под продолжает работать). Поэтому перед первым деплоем
> после этого изменения выполните `kubectl apply -f Backend/k8s/05-serviceaccount.yaml`
> и добавьте этот файл в `k8s/scripts/deploy.ps1` (рядом с применением PVC/Postgres,
> строка ~397), иначе следующий деплой на чистом кластере не раскатится.

Ручной прогон и диагностика:

```sh
kubectl create job --from=cronjob/db-backup db-backup-manual -n webplant
kubectl logs -n webplant job/db-backup-manual -f
kubectl get jobs -n webplant --sort-by=.metadata.creationTimestamp
```

Посмотреть содержимое PVC (CronJob-под уже завершился, поэтому нужен отдельный под):

```sh
kubectl run backup-inspect -n webplant --image=postgres:16-alpine --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"c","image":"postgres:16-alpine","command":["sh","-c","ls -la /backups; cat /backups/.last-success"],"volumeMounts":[{"name":"b","mountPath":"/backups"}]}],"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"backend-backups"}}]}}'
kubectl logs -n webplant backup-inspect
kubectl delete pod backup-inspect -n webplant
```

Особенности:

* PVC `ReadWriteOnce` + `concurrencyPolicy: Forbid` — на одном узле конфликтов нет
  (kind/Docker Desktop — один узел). При появлении второго узла CronJob и под
  восстановления запускайте с учётом привязки тома к узлу.
* `fsGroup: 70` на StorageClass `standard` (local-path) даёт запись в `/backups`
  пользователю 70. Если первый прогон падает с `Permission denied` при `pg_dump`,
  проверьте владельца каталога на узле и, при необходимости, используйте initContainer
  с `chown` или StorageClass, поддерживающий `fsGroup`.
* Бэкапится только БД. `/uploads` в кластере лежит на отдельном PVC `backend-uploads`:
  для него нужен свой снапшот/копия (см. «Что осталось на владельца»).

---

## 3. RPO / RTO

Цели (не гарантии SLA) для текущей конфигурации:

| Сценарий | RPO | RTO | Комментарий |
| --- | --- | --- | --- |
| Compose, локальные бэкапы | ≤ 24 ч | 30–60 мин | `pg_restore` дампа + `docker compose up -d`; зависит от размера БД |
| Compose, offsite настроен | ≤ 24 ч | 1–2 ч | плюс скачивание дампа из удалённого хранилища |
| Kubernetes, локальный PVC | ≤ 24 ч | 30–60 мин | `db-restore.job.yaml` в namespace `webplant` |
| Потеря узла/кластера | ≤ 24 ч | 2–4 ч | пересоздание kind-кластера, образов, секретов; восстановление из offsite |
| `/uploads` (compose/K8s) | ≤ 24 ч | 1–2 ч | отдельный архив/снапшот PVC |

Допущения: размер БД — единицы ГБ, канал до offsite ≥ 10 Мбит/с. При росте БД
пересматривайте расписание (например, `0 */6 * * *`) и retention: PVC 20Gi рассчитан
на ~14 дампов плюс запас.

Redis не входит в RPO/RTO: там кэш, счётчики и распределённые локи, они восстанавливаются
естественным путём (`appendonly` — приятный бонус, не источник истины).

---

## 4. Ежемесячный restore-тест

Цель — доказать, что дамп восстанавливается, а не только создаётся. Тест выполняется
**в отдельном namespace** и не касается боевых подов, секретов и тома `backend-uploads`.
Регламент: первый вторник месяца, ответственный — владелец инфраструктуры; результат
(дата, размер дампа, число таблиц/пользователей, время восстановления) записывается в
журнал эксплуатации.

```sh
# 1. Изолированный namespace
kubectl create namespace webplant-restore-test

# 2. Копия секрета с паролем БД (тот же ключ, другое пространство имён)
kubectl get secret webplant-secrets -n webplant -o json \
  | jq '.metadata.namespace="webplant-restore-test" | del(.metadata.uid,.metadata.resourceVersion,.metadata.creationTimestamp)' \
  | kubectl apply -f -

# 3. Чистый PostgreSQL в тестовом namespace
kubectl run pg-restore-test -n webplant-restore-test --image=postgres:16-alpine \
  --env=POSTGRES_DB=webplant_restore --env=POSTGRES_USER=restore \
  --env=POSTGRES_PASSWORD=restore --expose --port=5432
kubectl wait --for=condition=Ready pod/pg-restore-test -n webplant-restore-test --timeout=180s

# 4. Дамп из PVC на хост (PVC привязан к namespace webplant, поэтому берём его
#    отдельным подом и копируем файл через kubectl cp — байты не искажаются)
kubectl run backup-reader -n webplant --image=postgres:16-alpine --restart=Never \
  --overrides='{"spec":{"containers":[{"name":"c","image":"postgres:16-alpine","command":["sleep","3600"],"volumeMounts":[{"name":"b","mountPath":"/backups"}]}],"volumes":[{"name":"b","persistentVolumeClaim":{"claimName":"backend-backups"}}]}}'
kubectl wait --for=condition=Ready pod/backup-reader -n webplant --timeout=120s
kubectl cp -n webplant backup-reader:/backups/db-<STAMP>.dump /tmp/restore-test.dump
kubectl delete pod backup-reader -n webplant

# 5. Восстановление и проверки (файл кладём внутрь тестового пода)
kubectl cp -n webplant-restore-test /tmp/restore-test.dump pg-restore-test:/tmp/db.dump
kubectl exec -n webplant-restore-test pg-restore-test -- \
  pg_restore --no-owner --no-privileges --exit-on-error -U restore -d webplant_restore /tmp/db.dump
kubectl exec -n webplant-restore-test pg-restore-test -- psql -U restore -d webplant_restore \
  -tAc "select count(*) from information_schema.tables where table_schema='public'"
kubectl exec -n webplant-restore-test pg-restore-test -- psql -U restore -d webplant_restore \
  -tAc "select count(*) from users"
kubectl exec -n webplant-restore-test pg-restore-test -- rm -f /tmp/db.dump

# 6. Убрать всё за собой (namespace удаляет поды, сервисы и копию секрета)
kubectl delete namespace webplant-restore-test
shred -u /tmp/restore-test.dump 2>/dev/null || rm -f /tmp/restore-test.dump
```

Критерии успеха:

* `pg_restore` завершился с кодом 0 и без `errors ignored on restore`;
* число таблиц в `public` совпадает с прод-БД (допускается расхождение на таблицы,
  созданные после дампа);
* `select count(*) from users` > 0 и совпадает с дампом;
* запись в журнале: дата, `stamp` дампа, размер, время восстановления, результат.

Если тест упал — бэкап считается невалидным до выяснения причины: эскалация владельцу
инфраструктуры, разбор `pg_restore` и `backup.log`.

Для зашифрованных дампов шаг 5 предваряется расшифровкой (`gpg --decrypt` / `age --decrypt`,
см. раздел 1) — пароль берётся из хранилища секретов, не из репозитория.

---

## 5. Ротация секретов

Секреты и эффект ротации:

| Секрет | Где используется | Эффект смены |
| --- | --- | --- |
| `DB_PASSWORD` | backend, migrate, postgres, backup, restore | нужен согласованный порядок, иначе падение подключений |
| `REDIS_PASSWORD` | backend, redis | короткий разрыв кэша/локов |
| `SECRET_KEY` | подпись JWT/сессий | все сессии инвалидируются — только в окно обслуживания |
| `VAPID_PUBLIC/PRIVATE_KEY`, `VAPID_SUBJECT` | web-push | старые подписки перестают работать, нужна переподписка |
| `BACKUP_ENCRYPTION_PASSPHRASE` | backup.sh | старые дампы читаются только старым паролем — храните оба |
| offsite-креды (rclone remote) | backup.sh | отзыв старого ключа после успешного прогона с новым |

Порядок для Kubernetes (без простоя):

```sh
# 1. новый пароль в БД (для postgres: сначала создаём/меняем пользователя приложений)
kubectl exec -n webplant statefulset/postgres -- \
  psql -U postgres -c "ALTER USER \"$DB_USER\" WITH PASSWORD '<new>'"
# 2. обновляем секрет
kubectl create secret generic webplant-secrets -n webplant \
  --from-env-file=... --dry-run=client -o yaml | kubectl apply -f -
# 3. перезапуск потребителей и проверка
kubectl rollout restart deployment/backend -n webplant
kubectl rollout status deployment/backend -n webplant
kubectl exec -n webplant deploy/backend -- node -e "fetch('http://127.0.0.1:5000/health').then(r=>console.log(r.status))"
# 4. следующий прогон db-backup должен пройти успешно (heartbeat обновился)
```

Порядок для compose: обновить `Backend/.env` → сменить пароль в БД/Redis →
`docker compose up -d postgres redis` → `docker compose up -d backend backup` →
проверить `/health` и `docker exec ctp_backup /bin/sh /usr/local/bin/backup.sh`.

Правила: секреты не коммитятся (`.env` в `.gitignore`), в логах и heartbeat их нет,
дампы БД содержат хэши паролей — поэтому шифрование бэкапов включено в чек-лист.

---

## 6. certbot и reload nginx (deploy-hook)

В `docker-compose.yml` цикл продления теперь такой:

```
certbot renew --deploy-hook "docker exec ctp_nginx nginx -s reload"
```

`nginx` читает сертификат при старте и при `reload`; без него после продления он
продолжает отдавать старый сертификат до перезапуска контейнера. `--deploy-hook`
выполняется только при фактическом продлении (не чаще, чем раз в ~60 дней).

**Требуется от владельца:** в образе `certbot/certbot` нет docker CLI, а
`/var/run/docker.sock` в контейнер не примонтирован (и это осознанное ограничение:
`docker-socket-proxy` запущен с `POST: 0`, `EXEC: 0`). Поэтому «из коробки» хук
завершится ошибкой `docker: not found`; сам сертификат при этом продлится.

Два варианта, рекомендуется первый:

1. **Reload по расписанию на хосте (безопасно, ничего не расширяет).** Cron/systemd
   timer на сервере:
   ```cron
   17 */12 * * * docker exec ctp_nginx nginx -s reload
   ```
   и раз в месяц проверка дат:
   ```sh
   echo | openssl s_client -servername server.checktheplants.ru -connect 127.0.0.1:443 2>/dev/null \
     | openssl x509 -noout -dates -subject
   ```
2. **Дать certbot доступ к docker socket** (docker CLI в образе + bind-mount
   `/var/run/docker.sock`). Работает сразу, но контейнер, общающийся с интернетом,
   получает root-эквивалент на хосте — принимать осознанно.

Проверка продления (без расхода лимитов Let's Encrypt):

```sh
docker exec ctp_certbot certbot renew --dry-run
docker exec ctp_certbot certbot certificates
```

В Kubernetes сертификатами управляет тот же compose-контейнер `ctp_certbot`, а nginx
перечитывает конфиг при переключении трафика (`k8s/scripts/switch-traffic.ps1`,
`k8s/scripts/deploy.ps1` уже выполняют `docker exec ctp_nginx nginx -s reload`).

---

## 7. Что осталось на владельца

1. **Offsite-креды:** создать bucket/remote, прописать `BACKUP_OFFSITE_TARGET` и
   настройки rclone; собрать образ `backup` с `rclone` (и `gnupg`, если нужно шифрование).
2. **Парольная фраза шифрования:** задать `BACKUP_ENCRYPTION_PASSPHRASE` в
   `Backend/.env` / Secret, хранить копию в менеджере секретов (без неё дампы не читаются).
3. **CronJob и ServiceAccount в пайплайн:** добавить `k8s/05-serviceaccount.yaml`, PVC
   `backend-backups` и `k8s/jobs/db-backup.cronjob.yaml` в `k8s/scripts/deploy.ps1`
   (сейчас — ручной apply; без ServiceAccount новый Deployment не раскатится).
4. **Reload nginx после продления:** выбрать вариант из раздела 6 (рекомендуется host cron).
5. **Мониторинг бэкапов:** внешняя проверка `Backend/backups/.last-success` (compose) и
   `/backups/.last-success` (k8s) — алерт, если `finished_at` старше 26 часов; отдельный
   алерт на `ERROR` в `backup.log` и на `kubectl get jobs -l app=db-backup` с `Failed`.
6. **Страница статуса:** нужен домен/эндпоинт (например, `status.checktheplants.ru`) и
   решение, публиковать ли данные heartbeat наружу.
7. **Rate limit:** `30r/s`, burst 60 для `/api/` (в `nginx/conf.d/default.conf`) — стартовые
   значения; после наблюдения за пиками скорректировать под реальный трафик. Если перед
   nginx появится CDN/балансировщик, потребуется `real_ip`/`set_real_ip_from`, иначе
   лимит будет считаться по IP прокси для всех клиентов.
8. **Kubernetes без compose-nginx:** если compose-стек будет выведен из эксплуатации,
   перенести бэкапы uploads (PVC `backend-uploads`) и certbot в кластер (CronJob +
   cert-manager).
