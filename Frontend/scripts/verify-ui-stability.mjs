import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'

const FLAGS = parseFlags(process.argv.slice(2))
const DIST_ROOT = resolve(import.meta.dirname, '..', String(FLAGS.root || 'dist'))
const WIDTH = Number(FLAGS.w || 390)
const HEIGHT = Number(FLAGS.h || 844)
const SETTLE_MS = Number(FLAGS.settle || 900)
const CLS_LIMIT = Number(FLAGS.cls || 0.1)
const SCROLL_TOLERANCE = 4
const NAV_TIMEOUT_MS = 3500

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

const PRIVATE_PAGES = ['login', 'register', 'home', 'add-plant', 'edit-profile', 'my-plants', 'reset-password', 'notifications']
const BLOCKED_URLS = [
  '*googletagmanager.com*',
  '*google-analytics.com*',
  '*doubleclick.net*',
  '*mc.yandex*',
  '*sw.js*'
]

const COLLECTOR = `
window.__uiStability = { shifts: [] };
try {
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) {
      window.__uiStability.shifts.push({
        value: Number(entry.value.toFixed(5)),
        hadRecentInput: entry.hadRecentInput,
        sources: (entry.sources || []).map(source => {
          const node = source.node;
          if (!node) return null;
          if (typeof node.className === 'string' && node.className) return node.className;
          return node.nodeName;
        }).filter(Boolean)
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });
} catch (error) {}
`

const DATE_NOW = () => new Date().toISOString()
const COOKIE_CONSENTS = [
  { consent_type: 'technical', is_accepted: true, version: '1.0', accepted_at: DATE_NOW() },
  { consent_type: 'analytics', is_accepted: false, version: '1.0', accepted_at: DATE_NOW() },
  { consent_type: 'marketing', is_accepted: false, version: '1.0', accepted_at: DATE_NOW() },
  { consent_type: 'personalization', is_accepted: false, version: '1.0', accepted_at: DATE_NOW() }
]

function parseFlags (argv) {
  const flags = {}
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue
    const [key, ...rest] = arg.slice(2).split('=')
    flags[key] = rest.length ? rest.join('=') : true
  }
  return flags
}

function resolveCandidate (root, urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0])
  const rel = normalize(clean).replace(/^([/\\])+/, '').replace(/\\/g, '/')
  if (rel.includes('..')) return []
  if (!rel) return [join(root, 'index.html')]
  const noSlash = rel.replace(/\/+$/, '')
  if (PRIVATE_PAGES.includes(noSlash)) return [join(root, `${noSlash}.html`)]
  if (noSlash === 'plants') return [join(root, 'plants.html')]
  if (noSlash === 'care') return [join(root, 'care.html')]
  if (/^plants\/[a-z0-9-]+$/.test(noSlash)) return [join(root, `plants-${noSlash.split('/')[1]}.html`)]
  if (/^care\/[a-z0-9-]+$/.test(noSlash)) return [join(root, `care-${noSlash.split('/')[1]}.html`)]
  return [join(root, rel)]
}

async function startStaticServer (root) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = req.url || '/'
      for (const file of resolveCandidate(root, urlPath)) {
        const safe = file === root || file.startsWith(root + sep)
        if (!safe) continue
        try {
          const info = await stat(file)
          if (!info.isFile()) continue
          const body = await readFile(file)
          const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
          res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
          res.end(body)
          return
        } catch (error) {}
      }
      const notFound = await readFile(join(root, '404.html')).catch(() => null)
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(notFound || '404')
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('500')
    }
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolvePromise => {
      try {
        server.closeAllConnections?.()
      } catch (error) {}
      server.close(() => resolvePromise())
      setTimeout(resolvePromise, 2000).unref()
    })
  }
}

function connectWebSocket (ws) {
  let nextId = 1
  const pending = new Map()
  const listeners = new Map()

  ws.addEventListener('message', event => {
    let message
    try {
      message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
    } catch (error) {
      return
    }
    if (message.id && pending.has(message.id)) {
      const { resolve: resolvePending, reject, method } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(`${method}: ${message.error.message}`))
      else resolvePending(message.result)
      return
    }
    if (!message.method) return
    for (const callback of listeners.get(message.method) || []) {
      try {
        callback(message.params, message.sessionId)
      } catch (error) {}
    }
  })

  return {
    send (method, params = {}, sessionId) {
      const id = nextId++
      const payload = { id, method, params }
      if (sessionId) payload.sessionId = sessionId
      return new Promise((resolvePending, reject) => {
        pending.set(id, { resolve: resolvePending, reject, method })
        ws.send(JSON.stringify(payload))
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`${method}: таймаут CDP`))
        }, 45000)
      })
    },
    on (method, callback) {
      if (!listeners.has(method)) listeners.set(method, [])
      listeners.get(method).push(callback)
    }
  }
}

async function launchChrome (chromePath) {
  const userDataDir = await mkdtemp(join(tmpdir(), 'webplant-ui-stability-'))
  const args = [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-background-networking',
    '--disable-component-update',
    '--mute-audio',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    `--window-size=${WIDTH},${HEIGHT}`,
    'about:blank'
  ]
  const proc = spawn(chromePath, args, { stdio: 'ignore', windowsHide: true })
  const portFile = join(userDataDir, 'DevToolsActivePort')
  let content = null
  for (let attempt = 0; attempt < 600; attempt += 1) {
    try {
      content = (await readFile(portFile, 'utf8')).trim()
      if (content) break
    } catch (error) {}
    if (proc.exitCode !== null) throw new Error(`Chrome завершился с кодом ${proc.exitCode}`)
    await sleep(50)
  }
  if (!content) throw new Error('Chrome не запустился: нет DevToolsActivePort')
  const [port, wsPath] = content.split('\n')
  const ws = new WebSocket(`ws://127.0.0.1:${port}${wsPath}`)
  await new Promise((resolvePromise, reject) => {
    ws.addEventListener('open', resolvePromise, { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket CDP: ошибка подключения')), { once: true })
  })
  const connection = connectWebSocket(ws)
  return {
    connection,
    async close () {
      try {
        proc.kill()
      } catch (error) {}
      try {
        ws.close()
      } catch (error) {}
      await rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function openPage (browser, origin) {
  const { targetId } = await browser.connection.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.connection.send('Target.attachToTarget', { targetId, flatten: true })
  const send = (method, params) => browser.connection.send(method, params, sessionId)
  const state = { exceptions: [], consoleErrors: [], requestFailures: [] }

  browser.connection.on('Network.responseReceived', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return
    if (params.response.status < 400) return
    try {
      if (new URL(params.response.url).origin !== origin) return
    } catch (error) {
      return
    }
    state.requestFailures.push(`HTTP ${params.response.status} ${params.response.url}`)
  })

  browser.connection.on('Runtime.exceptionThrown', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return
    const description = params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || ''
    const url = params.exceptionDetails?.url || ''
    if (url.startsWith('chrome-extension://')) return
    if (description.includes('ResizeObserver loop')) return
    state.exceptions.push(description)
  })
  browser.connection.on('Runtime.consoleAPICalled', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return
    if (params.type !== 'error') return
    const text = (params.args || []).map(arg => arg.value ?? arg.description ?? '').join(' ')
    if (!text) return
    if (/Failed to load resource|net::ERR/.test(text)) return
    state.consoleErrors.push(text)
  })

  await Promise.all([
    send('Page.enable'),
    send('Runtime.enable'),
    send('Network.enable'),
    send('Log.enable'),
    send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: WIDTH <= 480
    }),
    send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: 'light' },
        { name: 'prefers-reduced-motion', value: 'no-preference' }
      ]
    }),
    send('Network.setBlockedURLs', { urls: BLOCKED_URLS })
  ])

  await send('Page.addScriptToEvaluateOnNewDocument', { source: COLLECTOR })
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try {
      localStorage.removeItem('webplant-theme');
      if (navigator.serviceWorker) {
        navigator.serviceWorker.register = function () { return new Promise(function () {}); };
        navigator.serviceWorker.getRegistrations = function () { return Promise.resolve([]); };
      }
    } catch (error) {}`
  })

  await send('Fetch.enable', {
    patterns: [
      { urlPattern: '*://server.checktheplants.ru/api*' },
      { urlPattern: '*://127.0.0.1:*/api*' },
      { urlPattern: '*://localhost:*/api*' }
    ]
  })

  browser.connection.on('Fetch.requestPaused', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return
    const request = params.request
    const respond = (status, body) => send('Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode: status,
      responseHeaders: [
        { name: 'Content-Type', value: 'application/json; charset=utf-8' },
        { name: 'Access-Control-Allow-Origin', value: origin },
        { name: 'Access-Control-Allow-Credentials', value: 'true' },
        { name: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,PATCH,DELETE,OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'content-type,authorization' }
      ],
      body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64')
    }).catch(() => {})

    let path = ''
    try {
      path = new URL(request.url).pathname
    } catch (error) {
      path = ''
    }
    if (!path.startsWith('/api/') && path !== '/api') {
      send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {})
      return
    }
    if (request.method === 'OPTIONS') {
      respond(204, '')
      return
    }
    if (path === '/api/cookie-consents' && request.method === 'GET') {
      respond(200, COOKIE_CONSENTS)
      return
    }
    if (path === '/api/users/me') {
      respond(401, { message: 'Требуется авторизация' })
      return
    }
    if (path === '/api/system/visit') {
      respond(200, { ok: true })
      return
    }
    respond(200, {})
  })

  const page = {
    state,
    send,
    async goto (url, options = {}) {
      state.exceptions.length = 0
      state.consoleErrors.length = 0
      state.requestFailures.length = 0
      await send('Page.navigate', { url })
      await sleep(120)
      await waitForLoad(page)
      await sleep(options.settle ?? SETTLE_MS)
      return page
    },
    async eval (fn, ...args) {
      const expression = typeof fn === 'function'
        ? `(${fn.toString()})(${args.map(arg => JSON.stringify(arg)).join(',')})`
        : String(fn)
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      })
      if (exceptionDetails) {
        throw new Error('JS: ' + (exceptionDetails.exception?.description || exceptionDetails.text))
      }
      return result?.value
    },
    async scrollTo (top) {
      await page.eval(value => window.scrollTo(0, value), top)
      await sleep(150)
    },
    async scrollY () {
      return page.eval(() => Math.round(window.scrollY))
    },
    async clickLink (href) {
      return page.eval(target => {
        const links = Array.from(document.querySelectorAll('a[href]'))
        const link = links.find(item => item.getAttribute('href') === target)
        if (!link) return false
        link.click()
        return true
      }, href)
    },
    async pathname () {
      return page.eval(() => location.pathname)
    },
    async cls () {
      return page.eval(() => window.__uiStability.shifts
        .filter(shift => !shift.hadRecentInput)
        .reduce((sum, shift) => sum + shift.value, 0))
    },
    async shiftSources () {
      return page.eval(() => window.__uiStability.shifts
        .filter(shift => !shift.hadRecentInput)
        .flatMap(shift => shift.sources)
        .slice(0, 10))
    },
    async goBack () {
      await page.eval(() => history.back())
      await sleep(120)
      await sleep(SETTLE_MS)
    },
    async goForward () {
      await page.eval(() => history.forward())
      await sleep(120)
      await sleep(SETTLE_MS)
    },
    async close () {
      try {
        await browser.connection.send('Target.closeTarget', { targetId })
      } catch (error) {}
    }
  }

  await send('Page.navigate', { url: origin + '/' })
  await sleep(200)
  await waitForLoad(page)
  return page
}

function sleep (ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function waitForLoad (page) {
  await page.eval(() => new Promise(done => {
    if (document.readyState === 'complete') {
      done(true)
      return
    }
    window.addEventListener('load', () => done(true), { once: true })
    setTimeout(() => done(true), 8000)
  }))
}

async function waitForScroll (page, expected, timeout = NAV_TIMEOUT_MS) {
  const started = Date.now()
  let actual = await page.scrollY()
  while (Date.now() - started < timeout) {
    if (Math.abs(actual - expected) <= SCROLL_TOLERANCE) return actual
    await sleep(80)
    actual = await page.scrollY()
  }
  return actual
}

async function waitForPath (page, expected, timeout = NAV_TIMEOUT_MS) {
  const started = Date.now()
  let actual = await page.pathname()
  while (Date.now() - started < timeout) {
    if (actual === expected) return actual
    await sleep(80)
    actual = await page.pathname()
  }
  return actual
}

function report (checks) {
  const failed = checks.filter(check => !check.pass)
  console.log('')
  for (const check of checks) {
    console.log(`  ${check.pass ? '✓' : '✗'} ${check.title}`)
    if (!check.pass && check.detail) console.log(`      ${check.detail}`)
  }
  console.log('')
  if (failed.length) {
    console.error(`✗ Провалено ${failed.length} из ${checks.length} проверок стабильности UI`)
    return 1
  }
  console.log(`✓ Все ${checks.length} проверок стабильности UI пройдены`)
  return 0
}

async function main () {
  const chromePath = process.env.CHROME_PATH || CHROME_CANDIDATES.find(candidate => existsSync(candidate))
  if (!chromePath) {
    const message = 'SKIP: Chrome не найден (задайте CHROME_PATH), проверка стабильности UI пропущена'
    if (process.env.WEBPLANT_UI_STABILITY_REQUIRED === '1') {
      console.error('ОШИБКА: ' + message)
      return 1
    }
    console.log(message)
    return 0
  }
  if (typeof WebSocket !== 'function') {
    console.log('SKIP: нужен Node.js с глобальным WebSocket (22+)')
    return process.env.WEBPLANT_UI_STABILITY_REQUIRED === '1' ? 1 : 0
  }
  if (!existsSync(join(DIST_ROOT, 'index.html'))) {
    console.error(`ОШИБКА: нет собранного dist в ${DIST_ROOT} (сначала npm run build)`)
    return 1
  }

  const routes = String(FLAGS.routes || '/,/plants,/care,/plants/monstera,/login')
    .split(',')
    .map(route => route.trim())
    .filter(Boolean)

  const server = await startStaticServer(DIST_ROOT)
  let browser = null
  const checks = []
  try {
    browser = await launchChrome(chromePath)
    const page = await openPage(browser, server.origin)

    for (const route of routes) {
      await page.goto(server.origin + route)
      const cls = await page.cls()
      const exceptions = page.state.exceptions.slice()
      const consoleErrors = page.state.consoleErrors.slice()
      const requestFailures = page.state.requestFailures.slice()
      const sources = cls > 0 ? await page.shiftSources() : []
      checks.push({
        title: `${route} — CLS ${cls.toFixed(4)} (лимит ${CLS_LIMIT})`,
        pass: cls <= CLS_LIMIT,
        detail: sources.length ? `сдвиги: ${sources.join(', ')}` : ''
      })
      checks.push({
        title: `${route} — нет исключений (${exceptions.length + consoleErrors.length})`,
        pass: exceptions.length === 0 && consoleErrors.length === 0,
        detail: [...exceptions, ...consoleErrors].slice(0, 3).join(' | ').slice(0, 400)
      })
      checks.push({
        title: `${route} — нет ошибок загрузки ресурсов (${requestFailures.length})`,
        pass: requestFailures.length === 0,
        detail: requestFailures.slice(0, 3).join(' | ').slice(0, 400)
      })
    }

    await page.goto(server.origin + '/plants')
    await page.scrollTo(1200)
    const scrolledFrom = await page.scrollY()
    await page.clickLink('/care')
    const afterNav = await waitForScroll(page, 0)
    checks.push({
      title: '/plants → /care — прокрутка начинается с начала (0)',
      pass: afterNav <= SCROLL_TOLERANCE,
      detail: `было ${scrolledFrom}, после перехода ${afterNav}`
    })
    await page.goBack()
    const afterBack = await waitForScroll(page, scrolledFrom)
    checks.push({
      title: '/plants ← назад — прокрутка восстановлена',
      pass: Math.abs(afterBack - scrolledFrom) <= SCROLL_TOLERANCE,
      detail: `ожидалось ${scrolledFrom}, получено ${afterBack}`
    })
    await page.goForward()
    const afterForward = await waitForScroll(page, 0)
    checks.push({
      title: '/care → вперёд — прокрутка начинается с начала (0)',
      pass: afterForward <= SCROLL_TOLERANCE,
      detail: `получено ${afterForward}`
    })

    await page.goto(server.origin + '/care')
    await page.scrollTo(1200)
    const careScrolled = await page.scrollY()
    await page.clickLink('/plants')
    const afterCareNav = await waitForScroll(page, 0)
    checks.push({
      title: '/care → /plants — прокрутка начинается с начала (0)',
      pass: afterCareNav <= SCROLL_TOLERANCE,
      detail: `было ${careScrolled}, после перехода ${afterCareNav}`
    })

    await page.goto(server.origin + '/plants/monstera')
    await page.scrollTo(1500)
    const monsteraScrolled = await page.scrollY()
    await page.clickLink('/')
    const afterHome = await waitForScroll(page, 0)
    checks.push({
      title: '/plants/monstera → / — прокрутка начинается с начала (0)',
      pass: afterHome <= SCROLL_TOLERANCE,
      detail: `было ${monsteraScrolled}, после перехода ${afterHome}`
    })

    await page.goto(server.origin + '/plants')
    await page.scrollTo(1200)
    await page.clickLink('/care')
    await waitForPath(page, '/care')
    await page.goBack()
    const pathAfterBack = await waitForPath(page, '/plants')
    await page.goForward()
    const pathAfterForward = await waitForPath(page, '/care')
    checks.push({
      title: 'назад/вперёд переключают маршрут без перезагрузки',
      pass: pathAfterBack === '/plants' && pathAfterForward === '/care',
      detail: `назад: ${pathAfterBack}, вперёд: ${pathAfterForward}`
    })

    const uncaught = page.state.exceptions.slice()
    checks.push({
      title: `нет необработанных исключений в конце прогона (${uncaught.length})`,
      pass: uncaught.length === 0,
      detail: uncaught.slice(0, 3).join(' | ').slice(0, 400)
    })

    await page.close()
  } finally {
    try {
      await browser?.close()
    } catch (error) {}
    await server.close()
  }

  return report(checks)
}

main()
  .then(code => process.exit(code))
  .catch(error => {
    console.error('ОШИБКА проверки стабильности UI:', error.stack || error.message)
    process.exit(1)
  })
