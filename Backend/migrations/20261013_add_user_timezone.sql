-- Часовой пояс пользователя: в нём считаются время полива (9:00 / 14:00 / 19:00),
-- сутки для просрочки и группировка календаря. Пусто = Europe/Moscow.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone varchar(64);
