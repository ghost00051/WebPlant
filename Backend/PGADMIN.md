# pgAdmin и Postgres: доступ, изоляция, обслуживание

## Как зайти

- Только через сайт: **https://pgadmin.checktheplants.ru**
- Логин: `admin@checktheplants.ru` (пароль задан отдельно, хранится у администратора;
  сменить: `docker exec -it ctp_pgadmin /venv/bin/python /pgadmin4/setup.py update-user admin@checktheplants.ru --password '<новый>' --admin`)
- Сервер Postgres уже зарегистрирован в pgAdmin: `WebPlant` → host `postgres`, port `5432`,
  БД `WebPlant`, пользователь `postgres`. Пароль базы берётся из `.env` (`DB_PASSWORD`).

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
