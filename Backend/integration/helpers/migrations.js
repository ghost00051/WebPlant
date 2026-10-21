import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations/', import.meta.url))

export function listMigrationFiles() {
    return readdirSync(MIGRATIONS_DIR)
        .filter(name => name.endsWith('.sql'))
        .sort()
        .map(name => path.join(MIGRATIONS_DIR, name))
}

let psqlAvailable

export function hasPsql() {
    if (psqlAvailable === undefined) {
        const probe = spawnSync('psql', ['--version'], { encoding: 'utf8' })
        psqlAvailable = !probe.error && probe.status === 0
    }
    return psqlAvailable
}

function readConnection() {
    return {
        host: process.env.DB_HOST || 'localhost',
        port: String(process.env.DB_PORT || 5432),
        user: process.env.DB_USER,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD ?? ''
    }
}

function applyWithPsql(file, connection) {
    const result = spawnSync('psql', [
        '-X',
        '-q',
        '-v', 'ON_ERROR_STOP=1',
        '-h', connection.host,
        '-p', connection.port,
        '-U', connection.user,
        '-d', connection.database,
        '-f', file
    ], {
        encoding: 'utf8',
        env: {
            ...process.env,
            PGPASSWORD: connection.password,
            PGCLIENTENCODING: 'UTF8'
        }
    })

    if (result.error) {
        throw new Error(`не удалось запустить psql: ${result.error.message}`)
    }
    if (result.status !== 0) {
        const details = (result.stderr || result.stdout || '').trim()
        throw new Error(`psql завершился с кодом ${result.status}: ${details}`)
    }
}

async function applyWithPg(client, file) {
    const sql = readFileSync(file, 'utf8')
    try {
        await client.query(sql)
    } catch (error) {
        try {
            await client.query('ROLLBACK')
        } catch {
        }
        throw error
    }
}

export async function applyMigrations() {
    const files = listMigrationFiles()
    const runner = hasPsql() ? 'psql' : 'pg'
    const connection = readConnection()

    let client = null
    if (runner === 'pg') {
        const { default: pg } = await import('pg')
        client = new pg.Client({
            host: connection.host,
            port: Number(connection.port),
            database: connection.database,
            user: connection.user,
            password: connection.password
        })
        await client.connect()
    }

    const applied = []
    try {
        for (const file of files) {
            try {
                if (runner === 'psql') {
                    applyWithPsql(file, connection)
                } else {
                    await applyWithPg(client, file)
                }
                applied.push(path.basename(file))
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error)
                throw new Error(`миграция ${path.basename(file)} не применилась (${runner}): ${reason}`)
            }
        }
    } finally {
        if (client) {
            await client.end().catch(() => {})
        }
    }

    return { runner, applied, failed: null }
}
