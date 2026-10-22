import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import net from 'node:net'

const repoRoot = dirname(fileURLToPath(import.meta.url))
const distRoot = join(repoRoot, 'Frontend', 'dist')
const args = new Set(process.argv.slice(2))
const checkOnly = args.has('--check')

const log = (...parts) => console.log(...parts)
const fail = message => {
    console.error(`\n✗ ${message}`)
    process.exit(1)
}

const DEFAULT_CONFIG_PATH = join(repoRoot, 'deploy.config.json')

function configPathFromEnv() {
    const raw = String(process.env.DEPLOY_CONFIG_PATH || '').trim()
    if (!raw) return DEFAULT_CONFIG_PATH
    return isAbsolute(raw) ? raw : resolve(repoRoot, raw)
}

const resolvedConfigPath = configPathFromEnv()

function loadFileConfig() {
    if (!existsSync(resolvedConfigPath)) {
        return { path: null, config: {} }
    }
    let raw
    try {
        raw = readFileSync(resolvedConfigPath, 'utf8')
    } catch (error) {
        fail(`Не удалось прочитать конфиг ${resolvedConfigPath}: ${error.message}`)
    }
    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        fail(`${resolvedConfigPath}: некорректный JSON (${error.message}). Образец без секретов — deploy.config.example.json.`)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail(`${resolvedConfigPath}: ожидается JSON-объект с полями protocol/host/user/password/remoteRoot.`)
    }
    return { path: resolvedConfigPath, config: parsed }
}

const loadedConfig = loadFileConfig()
const config = loadedConfig.config
const envKeys = Object.keys(process.env).filter(key => key.startsWith('DEPLOY_'))

const opt = (name, fallback) => {
    const envKey = `DEPLOY_${name.toUpperCase()}`
    return process.env[envKey] ?? config[name] ?? fallback
}

const protocol = String(opt('protocol', 'ftp')).toLowerCase()
if (!['ftp', 'sftp'].includes(protocol)) {
    fail(`Неизвестный протокол «${protocol}»: поддерживаются только ftp и sftp ` +
        '(задайте DEPLOY_PROTOCOL или protocol в deploy.config.json).')
}
const host = opt('host')
const port = Number(opt('port', protocol === 'sftp' ? 22 : 21))
const user = opt('user')
const password = opt('password')
const remoteRoot = String(opt('remoteRoot', '/')).replace(/\/+$/, '')
const siteUrl = String(opt('siteUrl', '')).replace(/\/+$/, '')
const accountRoot = protocol === 'ftp' ? String(opt('accountRoot', remoteRoot)).replace(/\/+$/, '') : remoteRoot
const skipBuild = args.has('--skip-build') || config.build === false
const skipUpload = args.has('--no-upload')
const skipVerify = args.has('--no-verify')
const onlyMissing = args.has('--only-missing')

if (!host || !user || !password) {
    fail([
        'Не заданы креды деплоя: host, user, password.',
        `Источник конфигурации: ${loadedConfig.path ? resolvedConfigPath : 'файла конфига нет (нет и deploy.config.json)'}` +
            `${envKeys.length ? ' + переменные окружения DEPLOY_*' : ''}.`,
        'Задайте DEPLOY_HOST, DEPLOY_USER, DEPLOY_PASSWORD (дополнительно: DEPLOY_PROTOCOL, DEPLOY_PORT, DEPLOY_REMOTE_ROOT, DEPLOY_SITE_URL)',
        'или скопируйте deploy.config.example.json → deploy.config.json и заполните поля.',
        'Нестандартное расположение конфига: DEPLOY_CONFIG_PATH=/путь/к/config.json.'
    ].join('\n  '))
}
if (loadedConfig.path) {
    log(`Конфигурация: ${relative(repoRoot, loadedConfig.path) || loadedConfig.path}${envKeys.length ? ' + env' : ''}`)
} else {
    log('Конфигурация: только переменные окружения DEPLOY_*')
}

class FtpClient {
    constructor() {
        this.socket = null
        this.buffer = ''
        this.pending = []
    }

    async connect() {
        this.socket = await new Promise((resolvePromise, rejectPromise) => {
            const socket = net.connect({ host, port })
            socket.setTimeout(30000)
            socket.once('connect', () => resolvePromise(socket))
            socket.once('error', rejectPromise)
            socket.once('timeout', () => rejectPromise(new Error('таймаут подключения')))
        })
        this.socket.setEncoding('utf8')
        this.socket.on('data', chunk => {
            this.buffer += chunk
            this.drain()
        })
        this.socket.on('error', error => {
            for (const item of this.pending.splice(0)) item.reject(error)
        })
        this.socket.on('close', () => {
            for (const item of this.pending.splice(0)) item.reject(new Error('соединение закрыто'))
        })

        await this.expect(220)
        await this.command(`USER ${user}`, 331, 230)
        await this.command(`PASS ${password}`, 230)
        await this.command('TYPE I', 200)
    }

    drain() {
        let index
        while ((index = this.buffer.indexOf('\n')) !== -1) {
            const line = this.buffer.slice(0, index).replace(/\r$/, '')
            this.buffer = this.buffer.slice(index + 1)
            if (/^\d{3}-/.test(line)) continue
            const item = this.pending.shift()
            if (item) item.resolve(line)
        }
    }

    readLine() {
        return new Promise((resolvePromise, rejectPromise) => {
            this.pending.push({ resolve: resolvePromise, reject: rejectPromise })
        })
    }

    async expect(...codes) {
        const line = await this.readLine()
        const code = Number(line.slice(0, 3))
        if (!codes.includes(code)) throw new Error(`ответ «${line}»`)
        return line
    }

    async command(text, ...codes) {
        if (process.env.DEPLOY_DEBUG_FTP) {
            const safe = text.startsWith('PASS') ? 'PASS ***' : text
            console.log(`   > ${safe}`)
        }
        this.socket.write(`${text}\r\n`)
        return this.expect(...codes)
    }

    async dataConnection() {
        const line = await this.command('PASV', 227)
        const parts = /\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/.exec(line)
        if (!parts) throw new Error('не разобран ответ PASV')
        const dataPort = Number(parts[5]) * 256 + Number(parts[6])
        return new Promise((resolvePromise, rejectPromise) => {
            const socket = net.connect({ host: `${parts[1]}.${parts[2]}.${parts[3]}.${parts[4]}`, port: dataPort })
            socket.setTimeout(60000)
            socket.once('connect', () => resolvePromise(socket))
            socket.once('error', rejectPromise)
            socket.once('timeout', () => rejectPromise(new Error('таймаут передачи данных')))
        })
    }

    async readListing(command) {
        const data = await this.dataConnection()
        await this.command(command, 150, 125)
        const chunks = []
        await new Promise((resolvePromise, rejectPromise) => {
            const timer = setTimeout(() => rejectPromise(new Error('таймаут листинга')), 30000)
            data.on('data', chunk => chunks.push(chunk))
            data.once('end', () => {
                clearTimeout(timer)
                resolvePromise()
            })
            data.once('error', error => {
                clearTimeout(timer)
                rejectPromise(error)
            })
        })
        data.destroy()
        await this.expect(226)
        return Buffer.concat(chunks).toString('utf8')
    }

    async list(path) {
        try {
            const output = await this.readListing(`MLSD ${path}`)
            const entries = []
            for (const line of output.split(/\r?\n/)) {
                if (!line.trim()) continue
                const [first, ...rest] = line.split(';')
                const isFact = part => /^[A-Za-z][A-Za-z0-9.-]*=/.test(part)
                const facts = isFact(first) ? [first, ...rest.filter(isFact)] : rest.filter(isFact)
                const name = (isFact(first) ? rest.filter(part => !isFact(part)) : [first, ...rest.filter(part => !isFact(part))])
                    .join(';')
                    .trim()
                const type = facts.find(fact => fact.toLowerCase().startsWith('type='))
                const size = facts.find(fact => fact.toLowerCase().startsWith('size='))
                if (!type || !name) continue
                if (name === '.' || name === '..') continue
                entries.push({
                    name,
                    isDirectory: type.toLowerCase().includes('dir'),
                    size: size ? Number(size.split('=')[1]) : 0
                })
            }
            if (!entries.length) throw new Error('пустой листинг MLSD')
            return entries
        } catch {
            const output = await this.readListing(`LIST ${path}`)
            const entries = []
            for (const line of output.split(/\r?\n/)) {
                const match = /^([-d])[-rwxst]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line.trim())
                if (!match) continue
                entries.push({
                    name: match[3].trim(),
                    isDirectory: match[1] === 'd',
                    size: Number(match[2])
                })
            }
            if (!entries.length) throw new Error('не разобран листинг LIST')
            return entries
        }
    }

    async ensureDirectory(path) {
        let current = path
        const levels = []
        while (current && current !== '/' && current !== accountRoot) {
            levels.unshift(current)
            current = current.slice(0, current.lastIndexOf('/')) || '/'
        }
        for (const level of levels) {
            try {
                await this.command(`MKD ${level}`, 257)
            } catch {
                /* уже существует */
            }
        }
    }

    async upload(localPath, remotePath) {
        const data = await this.dataConnection()
        await this.command(`STOR ${remotePath}`, 150)
        const content = readFileSync(localPath)
        await new Promise((resolvePromise, rejectPromise) => {
            data.once('error', rejectPromise)
            data.end(content, () => resolvePromise())
        })
        data.destroy()
        await this.expect(226)
    }

    async download(remotePath) {
        const data = await this.dataConnection()
        await this.command(`RETR ${remotePath}`, 150)
        const chunks = []
        await new Promise((resolvePromise, rejectPromise) => {
            data.on('data', chunk => chunks.push(chunk))
            data.once('end', resolvePromise)
            data.once('error', rejectPromise)
        })
        data.destroy()
        await this.expect(226)
        return Buffer.concat(chunks)
    }

    close() {
        if (this.socket) this.socket.destroy()
    }
}

let client = null
const ftp = async () => {
    if (!client) {
        client = new FtpClient()
        await client.connect()
    }
    return client
}

function walkFiles(directory) {
    const files = []
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const full = join(directory, entry.name)
        if (entry.isDirectory()) files.push(...walkFiles(full))
        else files.push({
            local: full,
            remote: relative(distRoot, full).split('\\').join('/'),
            size: statSync(full).size
        })
    }
    return files
}

async function remoteIndex() {
    if (protocol === 'sftp') return remoteIndexViaSftp()
    const connection = await ftp()
    const files = new Map()
    const stack = [accountRoot || '/']
    while (stack.length) {
        const current = stack.pop()
        const entries = await connection.list(current)
        for (const entry of entries) {
            if (entry.name === '.' || entry.name === '..') continue
            const remotePath = `${current}/${entry.name}`.replace(/\/{2,}/g, '/')
            if (entry.isDirectory) stack.push(remotePath)
            else {
                const relativePath = remotePath.slice(remoteRoot.length).replace(/^\/+/, '')
                files.set(relativePath, entry.size)
            }
        }
    }
    return files
}

async function remoteIndexViaSftp() {
    const result = spawnSync('sftp', ['-b', '-', `${user}@${host}`], {
        input: `ls -l ${remoteRoot || '/'}\n`,
        encoding: 'utf8'
    })
    const files = new Map()
    const output = `${result.stdout || ''}${result.stderr || ''}`
    for (const line of output.split(/\r?\n/)) {
        const match = /^-[-rwx]{9}\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+\S+\s+(.+)$/.exec(line.trim())
        if (match) files.set(match[2].trim(), Number(match[1]))
    }
    return files
}

async function uploadAll(files) {
    if (protocol === 'sftp') return uploadAllViaSftp(files)
    const connection = await ftp()
    const failed = []
    const directories = new Set()
    let done = 0
    for (const file of files) {
        const remotePath = `${remoteRoot}/${file.remote}`.replace(/\/{2,}/g, '/')
        const directory = remotePath.slice(0, remotePath.lastIndexOf('/'))
        try {
            if (directory && !directories.has(directory)) {
                await connection.ensureDirectory(directory)
                directories.add(directory)
            }
            await connection.upload(file.local, remotePath)
            done += 1
            if (done % 10 === 0 || done === files.length) log(`  загружено ${done}/${files.length}`)
        } catch (error) {
            failed.push(`${file.remote}: ${error.message}`)
            log(`  ✗ ${file.remote}: ${error.message}`)
            if (/соединение закрыто|таймаут/.test(error.message)) {
                client = null
                try {
                    await ftp()
                } catch {
                    break
                }
            }
        }
    }
    return { done, failed }
}

async function uploadAllViaSftp(files) {
    const directories = [...new Set(files
        .filter(file => file.remote.includes('/'))
        .map(file => `${remoteRoot}/${file.remote.slice(0, file.remote.lastIndexOf('/'))}`.replace(/\/{2,}/g, '/')))]
    const batch = [
        ...directories.map(directory => `-mkdir ${directory}`),
        `put -r ${distRoot}/* ${remoteRoot || '/'}`
    ].join('\n')
    const result = spawnSync('sftp', ['-b', '-', `${user}@${host}`], { input: `${batch}\n`, encoding: 'utf8' })
    const output = `${result.stdout || ''}${result.stderr || ''}`
    const failed = output.split(/\r?\n/).filter(line => /no such|not found|permission denied|failure/i.test(line))
    if (result.status !== 0 && !failed.length) failed.push(`sftp завершился с кодом ${result.status}`)
    return { done: files.length - failed.length, failed, output }
}

function runBuild() {
    log('\n▶ Сборка')
    const result = spawnSync('npm --prefix Frontend run build', { cwd: repoRoot, shell: true, encoding: 'utf8' })
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    log(output.split(/\r?\n/).slice(-3).join('\n'))
    if (result.status !== 0) fail('Сборка завершилась с ошибкой')
}

async function checkServed(files) {
    const problems = []
    const queue = [...files]
    const workers = Array.from({ length: 6 }, async () => {
        while (queue.length) {
            const file = queue.shift()
            const url = `${siteUrl}/${file.remote}`
            const isServiceFile = file.remote.split('/').pop().startsWith('.')
            try {
                const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'WebPlantDeploy/1.0' } })
                if (isServiceFile) {
                    if (response.status !== 403 && response.status !== 404) {
                        problems.push(`${file.remote} → ${response.status} (служебный файл не должен отдаваться)`)
                    }
                    continue
                }
                if (response.status >= 400) problems.push(`${file.remote} → ${response.status}`)
            } catch (error) {
                problems.push(`${file.remote} → ${error.message}`)
            }
        }
    })
    await Promise.all(workers)
    return problems
}

async function checkContent(files) {
    if (protocol === 'sftp') return []
    const connection = await ftp()
    const problems = []
    const sample = [
        'index.html',
        ...files.filter(file => /^plants-[a-z-]+\.html$/.test(file.remote)).slice(0, 2).map(file => file.remote),
        ...files.filter(file => /^care-[a-z-]+\.html$/.test(file.remote)).slice(0, 2).map(file => file.remote)
    ]
    for (const remote of sample) {
        try {
            const served = await connection.download(`${remoteRoot}/${remote}`.replace(/\/{2,}/g, '/'))
            const local = readFileSync(join(distRoot, remote))
            if (!served.equals(local)) problems.push(`${remote} (на сервере ${served.length} Б, локально ${local.length} Б)`)
        } catch (error) {
            problems.push(`${remote}: ${error.message}`)
        }
    }
    return problems
}

async function checkDeployment() {
    log(`\n▶ Проверка конфигурации (--check): ${protocol}://${host}:${port}${remoteRoot}`)
    const connection = await ftp()
    log('  ✓ FTP-подключение и авторизация')

    const entries = await connection.list(remoteRoot || '/')
    const dirs = entries.filter(entry => entry.isDirectory)
    const rootFiles = entries.filter(entry => !entry.isDirectory)
    const rootBytes = rootFiles.reduce((sum, entry) => sum + entry.size, 0)
    log(`  ✓ remoteRoot доступен: папок ${dirs.length}, файлов в корне ${rootFiles.length}, ${(rootBytes / 1024 / 1024).toFixed(1)} МБ`)
    const sample = rootFiles.map(entry => entry.name).sort().slice(0, 8).join(', ')
    if (sample) log(`  образец: ${sample}${rootFiles.length > 8 ? ', …' : ''}`)

    const allFiles = existsSync(distRoot) ? walkFiles(distRoot) : []
    log(`  локальная сборка: ${allFiles.length} файлов (${allFiles.filter(file => file.remote.endsWith('.html')).length} HTML), ${(allFiles.reduce((sum, file) => sum + file.size, 0) / 1024 / 1024).toFixed(1)} МБ`)

    let remoteBuild = null
    try {
        const raw = await connection.download(`${remoteRoot}/build-info.json`.replace(/\/{2,}/g, '/'))
        remoteBuild = JSON.parse(raw.toString('utf8'))
        log(`  сервер: v${remoteBuild.version}, commit ${remoteBuild.commit}, builtAt ${remoteBuild.builtAt}`)
    } catch {
        log('  сервер: build-info.json нет/не читается')
    }

    const localBuildPath = join(distRoot, 'build-info.json')
    if (existsSync(localBuildPath)) {
        try {
            const localBuild = JSON.parse(readFileSync(localBuildPath, 'utf8'))
            log(`  локально: v${localBuild.version}, commit ${localBuild.commit}, builtAt ${localBuild.builtAt}`)
            if (remoteBuild) {
                const same = remoteBuild.commit === localBuild.commit && remoteBuild.version === localBuild.version
                log(same ? '  ✓ версии совпадают — деплой не требуется' : '  ≠ версии отличаются — требуется деплой')
            }
        } catch (error) {
            log(`  локально: build-info.json некорректен (${error.message})`)
        }
    } else {
        log('  локально: build-info.json нет — сначала npm run build')
    }

    if (siteUrl) {
        try {
            const response = await fetch(`${siteUrl}/`, { redirect: 'manual', headers: { 'User-Agent': 'WebPlantDeploy/1.0' } })
            log(`  сайт ${siteUrl}: HTTP ${response.status}, server ${response.headers.get('server') || '—'}`)
        } catch (error) {
            log(`  сайт ${siteUrl}: недоступен (${error.message})`)
        }
    } else {
        log('  siteUrl не задан — проверка живого сайта пропущена')
    }

    log('\n✓ Проверка завершена, изменений не вносилось (режим --check).')
    if (client) {
        client.close()
        client = null
    }
}

async function main() {
    if (checkOnly) {
        await checkDeployment()
        return
    }
    if (!skipBuild) runBuild()
    if (!existsSync(distRoot)) fail('Нет Frontend/dist — сначала выполните сборку')

    const allFiles = walkFiles(distRoot)
    log(`\n▶ Готово к выгрузке: ${allFiles.length} файлов (${allFiles.filter(f => f.remote.endsWith('.html')).length} HTML)`)

    const before = skipUpload ? new Map() : await remoteIndex()
    let files = allFiles
    if (skipUpload) {
        log('  режим --no-upload: выгрузка пропущена')
    } else if (onlyMissing) {
        files = allFiles.filter(file => before.get(file.remote) !== file.size)
        log(`  --only-missing: к загрузке ${files.length} из ${allFiles.length}`)
    }

    let result = { done: 0, failed: [] }
    if (!skipUpload) {
        log(`\n▶ Выгрузка на ${protocol}://${host}${remoteRoot}`)
        result = await uploadAll(files)
        log(`  загружено ${result.done} из ${files.length}`)
        for (const failure of result.failed) log(`  ✗ ${failure}`)
    }

    log('\n▶ Сверка сервера с локальной сборкой')
    const after = await remoteIndex()
    const missing = []
    for (const file of allFiles) {
        const size = after.get(file.remote)
        if (size === undefined) missing.push(`${file.remote} — нет на сервере`)
        else if (size !== file.size) missing.push(`${file.remote} — размер ${size} вместо ${file.size}`)
    }
    log(`  совпадает: ${allFiles.length - missing.length} из ${allFiles.length}`)

    let served = []
    let content = []
    if (!skipVerify && siteUrl) {
        log('\n▶ Проверка живого сайта')
        served = await checkServed(allFiles)
        content = await checkContent(allFiles)
        log(`  отдают ошибку: ${served.length}`)
    } else if (!skipVerify) {
        log('\n▶ Проверка живого сайта пропущена: не задан siteUrl (DEPLOY_SITE_URL или deploy.config.json → siteUrl)')
    }

    log('\n════════ ИТОГ ════════')
    if (!missing.length && !served.length && !content.length && !result.failed.length) {
        log(`✓ Все ${allFiles.length} файлов на сервере${siteUrl && !skipVerify ? ' и отдаются корректно' : ''}`)
        log(`  ${siteUrl || '(siteUrl не задан)'}`)
        return
    }
    if (missing.length) {
        log('\n✗ Не доехали:')
        for (const item of missing) log(`   ${item}`)
    }
    if (served.length) {
        log('\n✗ Сайт отдаёт ошибку:')
        for (const item of served) log(`   ${item}`)
    }
    if (content.length) {
        log('\n✗ Содержимое на сервере отличается:')
        for (const item of content) log(`   ${item}`)
    }
    if (result.failed.length && !missing.length) {
        log('\n✗ Ошибки загрузки:')
        for (const item of result.failed) log(`   ${item}`)
    }
    process.exitCode = 1
}

process.on('exit', () => {
    if (client) client.close()
})

function closeClient() {
    if (client) {
        client.close()
        client = null
    }
}

main()
    .catch(error => fail(error.message))
    .finally(closeClient)
