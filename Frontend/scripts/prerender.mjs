import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, 'dist')
const siteUrl = 'https://checktheplants.ru'
const landingTitle = 'Лейка — календарь полива и уход за комнатными растениями'
const landingDescription =
  'Планируйте полив комнатных растений, ведите коллекцию и получайте напоминания. Календарь ухода и ИИ-подсказки — в приложении «Лейка».'

const privateRoutes = {
  login: 'Вход — Лейка',
  register: 'Регистрация — Лейка',
  home: 'Мой сад — Лейка',
  'add-plant': 'Добавление растения — Лейка',
  'edit-profile': 'Настройки профиля — Лейка',
  'my-plants': 'Мои растения — Лейка',
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function replaceMeta(html, attribute, name, content) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(
    `<meta\\s+${attribute}="${escapedName}"\\s+content="[^"]*"\\s*\\/?>`,
    'i'
  )
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`
  if (!matcher.test(html)) {
    return html.replace('</head>', `  ${tag}\n</head>`)
  }
  return html.replace(matcher, tag)
}

function replaceCanonical(html, url) {
  const tag = `<link rel="canonical" href="${escapeHtml(url)}">`
  const matcher = /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i
  if (!matcher.test(html)) return html.replace('</head>', `  ${tag}\n</head>`)
  return html.replace(matcher, tag)
}

function setPageMetadata(html, { title, description, canonical, indexable }) {
  let page = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  page = replaceMeta(page, 'name', 'description', description)
  page = replaceMeta(
    page,
    'name',
    'robots',
    indexable ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
  )
  page = replaceMeta(page, 'property', 'og:title', title)
  page = replaceMeta(page, 'property', 'og:description', description)
  page = replaceMeta(page, 'property', 'og:url', canonical)
  page = replaceMeta(page, 'name', 'twitter:title', title)
  page = replaceMeta(page, 'name', 'twitter:description', description)
  page = replaceCanonical(page, canonical)

  if (!indexable) {
    page = page.replace(
      /\s*<script\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
      ''
    )
  }
  return page
}

const vite = await createServer({
  configFile: resolve(root, 'vite.config.js'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const [{ default: LandingPage }, { MemoryRouter }] = await Promise.all([
    vite.ssrLoadModule('/src/component/landingPage/landingPage.jsx'),
    import('react-router-dom'),
  ])
  const landingMarkup = renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/'] },
      createElement(LandingPage)
    )
  )

  const indexPath = resolve(outputDirectory, 'index.html')
  const template = await readFile(indexPath, 'utf8')
  let landingPage = template.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="true">${landingMarkup}</div>`
  )
  landingPage = setPageMetadata(landingPage, {
    title: landingTitle,
    description: landingDescription,
    canonical: `${siteUrl}/`,
    indexable: true,
  })
  await writeFile(indexPath, landingPage)

  for (const [route, title] of Object.entries(privateRoutes)) {
    const page = setPageMetadata(template, {
      title,
      description: 'Раздел приложения «Лейка».',
      canonical: `${siteUrl}/${route}`,
      indexable: false,
    })
    await writeFile(resolve(outputDirectory, `${route}.html`), page)
  }

  await copyFile(resolve(root, 'htaccess'), resolve(outputDirectory, '.htaccess'))
} finally {
  await vite.close()
}
