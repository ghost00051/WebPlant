import express from 'express'
import cookieParser from 'cookie-parser'
import jwt from 'jsonwebtoken'
import { createHash, randomUUID } from 'node:crypto'
import pg from 'pg'
import sequelize from './db.js'
import notificationRouter from './routes/notificationRoutes.js'

const SMOKE_DB = process.env.DB_NAME
if (!/^webplant_notif_smoke[a-z0-9_]*$/.test(SMOKE_DB || '')) {
  console.error(
    `Refusing to run: DB_NAME must be a throwaway "webplant_notif_smoke*" database, got "${SMOKE_DB}"`
  )
  process.exit(1)
}

const results = []
function check (name, condition, detail = '') {
  results.push({ name, ok: Boolean(condition), detail })
  console.log(
    `${condition ? '✔' : '✖'} ${name}${condition ? '' : ` — ${detail}`}`
  )
}

const stamp = Date.now()
const emails = [
  `notif-smoke-a-${stamp}@local.test`,
  `notif-smoke-b-${stamp}@local.test`
]

async function adminQuery (sql, values) {
  const client = new pg.Client({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'postgres'
  })
  await client.connect()
  try {
    return await client.query(sql, values)
  } finally {
    await client.end()
  }
}

const SCHEMA = [
  `DO $$ BEGIN
        CREATE TYPE enum_users_role AS ENUM ('USER', 'ADMIN');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100),
        username VARCHAR(30) UNIQUE,
        phone VARCHAR(20),
        bio VARCHAR(300),
        role enum_users_role NOT NULL DEFAULT 'USER',
        privilege_level VARCHAR(20) NOT NULL DEFAULT 'free',
        welcome_email_sent_at TIMESTAMPTZ,
        timezone VARCHAR(64)
    )`,
  `CREATE TABLE notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
        plant_id INTEGER,
        type VARCHAR(32) NOT NULL
            CHECK (type IN ('watering_due', 'watering_day_before', 'morning_summary')),
        title VARCHAR(120) NOT NULL,
        body VARCHAR(1000) NOT NULL,
        url VARCHAR(2048) NOT NULL DEFAULT '/home',
        dedupe_key VARCHAR(255) NOT NULL,
        scheduled_for TIMESTAMPTZ,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE TABLE auth_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        token_type VARCHAR(20) NOT NULL CHECK (token_type IN ('session', 'refresh')),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  `CREATE UNIQUE INDEX idx_notifications_user_dedupe ON notifications (user_id, dedupe_key)`,
  `CREATE INDEX idx_notifications_user_created ON notifications (user_id, created_at DESC, id DESC)`,
  `CREATE INDEX idx_notifications_user_read ON notifications (user_id, read_at)`
]

async function createUser (email) {
  const [rows] = await sequelize.query(
    `INSERT INTO users (email, password, name, role, privilege_level)
         VALUES ($1, $2, $3, 'USER', 'free') RETURNING id`,
    { bind: [email, 'smoke-not-a-real-password', 'Notif Smoke'] }
  )
  return rows[0].id
}

async function createNotification (userId, index, type, title, body) {
  const [rows] = await sequelize.query(
    `INSERT INTO notifications (user_id, type, title, body, url, dedupe_key, created_at)
         VALUES ($1, $2, $3, $4, '/home', $5, CURRENT_TIMESTAMP) RETURNING id`,
    { bind: [userId, type, title, body, `smoke:${stamp}:${index}`] }
  )
  return rows[0].id
}

async function token (userId) {
  const jti = randomUUID()
  await sequelize.query(
    `INSERT INTO auth_sessions (user_id, token_hash, token_type, expires_at)
         VALUES ($1, $2, 'session', NOW() + INTERVAL '10 minutes')`,
    { bind: [userId, createHash('sha256').update(jti).digest('hex')] }
  )
  return jwt.sign(
    { id: userId, tokenType: 'session', jti },
    process.env.SECRET_KEY,
    {
      expiresIn: '10m'
    }
  )
}

function api (port, cookie, path, options = {}) {
  return fetch(`http://127.0.0.1:${port}/api/notifications${path}`, {
    ...options,
    headers: { Cookie: `token=${cookie}`, ...(options.headers || {}) }
  })
}

let created = false
let server

try {
  const existing = await adminQuery(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [SMOKE_DB]
  )
  if (existing.rowCount) {
    throw new Error(
      `Database ${SMOKE_DB} already exists — refusing to touch it`
    )
  }
  await adminQuery(`CREATE DATABASE "${SMOKE_DB}"`)
  created = true
  console.log(`🗄  создана временная БД ${SMOKE_DB}\n`)

  for (const statement of SCHEMA) {
    await sequelize.query(statement)
  }

  const app = express()
  app.use(cookieParser())
  app.use(express.json({ limit: '100kb' }))
  app.use('/api/notifications', notificationRouter)
  server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const port = server.address().port

  const userA = await createUser(emails[0])
  const userB = await createUser(emails[1])
  const cookieA = await token(userA)
  const cookieB = await token(userB)

  const ids = [
    await createNotification(
      userA,
      0,
      'watering_due',
      '💧 Пора полить!',
      'Smoke ждёт воды'
    ),
    await createNotification(
      userA,
      1,
      'watering_day_before',
      '🌿 Напоминание',
      'Завтра полить Smoke'
    ),
    await createNotification(
      userA,
      2,
      'morning_summary',
      '🌿 Утренняя сводка',
      'Сегодня полить: Smoke'
    )
  ]

  let res = await api(port, cookieA, '?status=unread')
  let body = await res.json()
  check('GET ?status=unread → 200', res.status === 200, `status ${res.status}`)
  check(
    'list returns exactly the 3 seeded notifications',
    body.total === 3 && body.items.length === 3,
    JSON.stringify({ total: body.total })
  )
  check(
    'list reports unreadCount=3',
    body.unreadCount === 3,
    `unreadCount ${body.unreadCount}`
  )
  check('list echoes status=unread', body.status === 'unread')
  check(
    'list items carry read_at=null',
    body.items.every(i => i.read_at === null)
  )
  check(
    'list is newest first',
    body.items[0].id === ids[2] && body.items[2].id === ids[0],
    JSON.stringify(body.items.map(i => i.id))
  )
  check(
    'list nextOffset is null on a full page',
    body.nextOffset === null,
    String(body.nextOffset)
  )

  res = await api(port, cookieA, '')
  body = await res.json()
  check(
    'GET / defaults to status=all',
    res.status === 200 && body.status === 'all'
  )
  check('default limit is 20', body.limit === 20, String(body.limit))

  res = await api(port, cookieA, '/unread-count')
  body = await res.json()
  check(
    'GET /unread-count → 3',
    res.status === 200 && body.unreadCount === 3,
    JSON.stringify(body)
  )

  res = await api(port, cookieA, '?status=archived')
  check(
    'GET ?status=archived → 400',
    res.status === 400,
    `status ${res.status}`
  )
  res = await api(port, cookieA, '?limit=0')
  check('GET ?limit=0 → 400', res.status === 400, `status ${res.status}`)
  res = await api(port, cookieA, '?limit=51')
  check('GET ?limit=51 → 400', res.status === 400, `status ${res.status}`)

  res = await api(port, cookieB, '/unread-count')
  body = await res.json()
  check(
    'another user sees an empty badge',
    body.unreadCount === 0,
    JSON.stringify(body)
  )
  res = await api(port, cookieB, `/${ids[0]}/read`, { method: 'PATCH' })
  check(
    'another user cannot mark my notification read → 404',
    res.status === 404,
    `status ${res.status}`
  )
  res = await api(port, 'not-a-jwt', '/unread-count')
  check('garbage token → 401', res.status === 401, `status ${res.status}`)
  res = await fetch(`http://127.0.0.1:${port}/api/notifications/unread-count`)
  check('no cookie → 401', res.status === 401, `status ${res.status}`)

  res = await api(port, cookieA, `/${ids[0]}/read`, { method: 'PATCH' })
  body = await res.json()
  check(
    'PATCH /:id/read → 200 with changed=true',
    res.status === 200 && body.changed === true,
    JSON.stringify(body)
  )
  check(
    'PATCH /:id/read returns the updated item',
    body.item.id === ids[0] && body.item.read_at !== null,
    JSON.stringify(body.item)
  )
  check(
    'PATCH /:id/read returns unreadCount=2',
    body.unreadCount === 2,
    String(body.unreadCount)
  )

  res = await api(port, cookieA, `/${ids[0]}/read`, { method: 'PATCH' })
  body = await res.json()
  check(
    'second tap is idempotent (changed=false, unreadCount=2)',
    body.changed === false && body.unreadCount === 2,
    JSON.stringify(body)
  )

  res = await api(port, cookieA, '/999999999/read', { method: 'PATCH' })
  check('PATCH unknown id → 404', res.status === 404, `status ${res.status}`)
  res = await api(port, cookieA, '/abc/read', { method: 'PATCH' })
  check('PATCH malformed id → 400', res.status === 400, `status ${res.status}`)

  res = await api(port, cookieA, '?status=read')
  body = await res.json()
  check(
    '?status=read returns only the tapped one',
    body.total === 1 && body.items[0].id === ids[0],
    JSON.stringify({ total: body.total })
  )

  res = await api(port, cookieA, '?status=unread')
  body = await res.json()
  check(
    '?status=unread now returns 2',
    body.total === 2 && body.unreadCount === 2,
    JSON.stringify({ total: body.total })
  )

  res = await api(port, cookieA, '?limit=1&offset=1')
  body = await res.json()
  check(
    'pagination: limit=1 offset=1 → 1 item and nextOffset=2',
    body.items.length === 1 && body.nextOffset === 2,
    JSON.stringify({ nextOffset: body.nextOffset })
  )

  res = await api(port, cookieA, '/read-all', { method: 'PATCH' })
  body = await res.json()
  check(
    'PATCH /read-all → updatedCount=2, unreadCount=0',
    res.status === 200 && body.updatedCount === 2 && body.unreadCount === 0,
    JSON.stringify(body)
  )

  res = await api(port, cookieA, '/unread-count')
  body = await res.json()
  check(
    'badge is 0 after read-all',
    body.unreadCount === 0,
    JSON.stringify(body)
  )

  res = await api(port, cookieA, '/read-all', { method: 'PATCH' })
  body = await res.json()
  check(
    'read-all is idempotent',
    body.updatedCount === 0 && body.unreadCount === 0,
    JSON.stringify(body)
  )

  res = await api(port, cookieA, '?status=unread')
  body = await res.json()
  check(
    'no unread left in the section',
    body.total === 0 && body.items.length === 0,
    JSON.stringify({ total: body.total })
  )

  res = await api(port, cookieA, '?status=read')
  body = await res.json()
  check(
    'all 3 are read in the section',
    body.total === 3 && body.items.every(i => i.read_at !== null),
    JSON.stringify({ total: body.total })
  )

  const [dbRows] = await sequelize.query(
    'SELECT COUNT(*)::int AS total, COUNT(read_at)::int AS read_count FROM notifications WHERE user_id = $1',
    { bind: [userA] }
  )
  check(
    'database persisted the read state',
    dbRows[0].total === 3 && dbRows[0].read_count === 3,
    JSON.stringify(dbRows[0])
  )

  await sequelize.query('DELETE FROM users WHERE id = $1', { bind: [userA] })
  const [orphans] = await sequelize.query(
    'SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1',
    { bind: [userA] }
  )
  check(
    'deleting a user cascades its notifications',
    orphans[0].total === 0,
    JSON.stringify(orphans[0])
  )
} catch (error) {
  check('smoke test crashed', false, error?.stack || String(error))
} finally {
  if (server) server.close()
  try {
    await sequelize.close()
  } catch {}
  if (created) {
    try {
      await adminQuery(`DROP DATABASE "${SMOKE_DB}" WITH (FORCE)`)
      console.log(`\n🗑  временная БД ${SMOKE_DB} удалена`)
    } catch (error) {
      check(
        'failed to drop the throwaway database',
        false,
        error?.message || String(error)
      )
    }
  }
}

const failed = results.filter(result => !result.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`
)
if (failed.length) {
  console.log('FAILED:')
  for (const failure of failed)
    console.log(` - ${failure.name}: ${failure.detail}`)
}

process.exit(failed.length ? 1 : 0)
