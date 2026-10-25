# pgAdmin и Postgres: доступ, изоляция, обслуживание

## Как зайти

- Только через сайт: **https://pgadmin.checktheplants.ru**
- Логин: `admin@checktheplants.ru` (пароль задан отдельно, хранится у администратора;
  сменить: `docker exec -it ctp_pgadmin /venv/bin/python /pgadmin4/setup.py update-user admin@checktheplants.ru --password '<новый>' --admin`)
- В pgAdmin зарегистрированы два сервера:
  - `WebPlant (k8s)` → host `172.20.0.5` (нода kind `desktop-control-plane`), port `30432`,
    БД `WebPlant`, пользователь `postgres` — **боевая база в кластере**, см. ниже.
  - `WebPlant` → host `postgres`, port `5432`, БД `WebPlant` — **архив compose-стека**:
    замер 9 октября 2026 (10 пользователей), новые данные сюда не пишутся.
- Пароль базы тот же, что в `.env` (`DB_PASSWORD`): он попадает и в compose-контейнер,
  и в секрет кластера `webplant-secrets`.

## Боевая база в кластере (доступ из pgAdmin)

K8s `ClusterIP` из docker-сетей недостижим, поэтому доступ идёт через `NodePort`:

- `Backend/k8s/20-postgres.yaml` объявляет сервис `postgres-nodeport` (`5432:30432`)
  на IP нод kind (`172.20.0.0/16`) — не на хост и не в интернет;
  создаётся автоматически из `deploy.ps1`.
- `ctp_pgadmin` подключён к docker-сети `kind` (см. `docker-compose.pgadmin.yml`),
  поэтому видит ноды по адресам из `kubectl get nodes -o wide`.
- `pg_hba.conf` кластерной базы: `host all all all scram-sha-256` — вход по паролю.

Проверка доступа:

```bash
docker exec -u pgadmin ctp_pgadmin /venv/bin/python -c "import socket; socket.create_connection(('172.20.0.5', 30432), 5); print('ok')"
kubectl get svc postgres-nodeport -n webplant
```

Если кластер kind пересоздан, IP нод меняются: взять новый из `kubectl get nodes -o wide`
и обновить host у сервера `WebPlant (k8s)` в pgAdmin.

**Про изоляцию:** `backend_pgadmin_net` остаётся `internal` (без выхода в интернет), но
подключение к сети `kind` даёт pgAdmin сетевой выход через её bridge. Если это нежелательно,
вместо прямого подключения ставят TCP-прокси в духе `ctp_docker_socket_proxy`:
socat в сетях `backend_pgadmin_net` + `kind`, а pgAdmin ходит на его IP.


## Схема изоляции

```
                      интернет
                         │  :443
                    ┌────▼─────┐
                    │  nginx   │  единственная публичная точка входа
                    └────┬─────┘
        ctp_network       │        pgadmin_net (internal, без интернета)
   backend, redis, k8s ──┤
                         ├──────────► ctp_pgadmin  (портов наружу нет)
                         └──────────► ctp_postgres (портов наружу нет)
```

- `ctp_pgadmin` и `ctp_postgres` **не публикуют порты** на хост (в `docker-compose*.yml` только `expose`).
- `ctp_pgadmin` живёт только в сети `backend_pgadmin_net` (`internal: true`) — без выхода в интернет;
  видеть его может только nginx.
- `ctp_postgres` доступен из `ctp_network` (backend/migrate/backup) и из `backend_pgadmin_net` (pgAdmin).
- Доступ к pgAdmin — только HTTPS через nginx (+ ограничение частоты на форме входа).

## Конфиги nginx запечены в образ

`nginx/conf.d/` копируется в образ (`nginx/Dockerfile`). Причина: при bind-mount с Windows
каталог иногда читался пустым, и nginx стартовал без server-блоков (сайт молча отдавал RST).

После правки `nginx/conf.d/*.conf`:

```bash
cd Backend
docker compose -f docker-compose.yml build nginx
docker compose -f docker-compose.yml up -d --no-deps nginx
docker exec ctp_nginx nginx -t
```

## Сертификаты

- Хранятся в docker-volume `backend_certbot_conf` (НЕ в `Backend/certbot/conf` —
  тот каталог больше не используется: на Windows symlink'и `live/*.pem` ломаются и
  certbot не мог продлевать сертификаты).
- Продление: контейнер `ctp_certbot` каждые 12 часов (`certbot renew`).
- Проверка: `docker exec ctp_certbot certbot renew --dry-run`
- `nginx/conf.d/pgadmin-tls.conf` — боевой HTTPS-блок (включается после выпуска сертификата,
  исходник лежит в `nginx/pending/pgadmin-tls.conf`).
