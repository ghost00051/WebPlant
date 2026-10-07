import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'


const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, 'dist')
const siteUrl = 'https://checktheplants.ru'
const buildDate = new Date().toISOString().slice(0, 10)

const privateRoutes = {
  login: {
    title: 'Вход — Лейка',
    description: 'Войдите в аккаунт «Лейки», чтобы открыть расписание полива и коллекцию растений.'
  },
  register: {
    title: 'Регистрация — Лейка',
    description: 'Создайте аккаунт «Лейки»: сохраните растения, настройте график полива и напоминания.'
  },
  home: {
    title: 'Мой сад — Лейка',
    description: 'Личный раздел «Лейки»: растения, расписание полива и календарь ухода.'
  },
  'add-plant': {
    title: 'Добавление растения — Лейка',
    description: 'Добавьте новое растение в коллекцию и настройте для него график полива.'
  },
  'edit-profile': {
    title: 'Настройки профиля — Лейка',
    description: 'Настройки аккаунта «Лейки»: профиль, напоминания и согласия.'
  },
  'my-plants': {
    title: 'Мои растения — Лейка',
    description: 'Список растений в вашей коллекции с расписанием полива и историей ухода.'
  }
}

function escapeHtml(value) {
  return String(value)
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

function setPageMetadata(html, { title, description, canonical, indexable, structuredData }) {
  let page = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`)
  page = replaceMeta(page, 'name', 'description', description)
  page = replaceMeta(
    page,
    'name',
    'robots',
    indexable
      ? 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'
      : 'noindex, follow'
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
    return page
  }

  if (structuredData) {
    const json = JSON.stringify(structuredData, null, 2).replaceAll('<', '\\u003c')
    page = page.replace(
      '</head>',
      `  <script type="application/ld+json">\n${json}\n  </script>\n</head>`
    )
  }

  return page
}

function buildBreadcrumbs(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.label,
      item: `${siteUrl}${item.path}`
    }))
  }
}

function buildFaqPage(faq) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faq.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer
      }
    }))
  }
}

function buildSitemap(entries) {
  const urls = entries.map(entry => [
    '  <url>',
    `    <loc>${siteUrl}${entry.path}</loc>`,
    `    <lastmod>${entry.lastmod}</lastmod>`,
    `    <changefreq>${entry.changefreq}</changefreq>`,
    `    <priority>${entry.priority}</priority>`,
    '  </url>'
  ].join('\n'))

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    ''
  ].join('\n')
}

const vite = await createServer({
  configFile: resolve(root, 'vite.config.js'),
  root,
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

try {
  const [
    { default: LandingPage },
    { default: PlantsIndexPage },
    { default: PlantsDetailPage },
    { default: CareIndexPage },
    { default: CareDetailPage },
    { MemoryRouter },
    siteMapModule,
    { PLANTS },
    { ARTICLES },
    seoMetaModule,
  ] = await Promise.all([
    vite.ssrLoadModule('/src/component/landingPage/landingPage.jsx'),
    vite.ssrLoadModule('/src/component/PlantsGuide/PlantsIndexPage.jsx'),
    vite.ssrLoadModule('/src/component/PlantsGuide/PlantsDetailPage.jsx'),
    vite.ssrLoadModule('/src/component/CareGuide/CareIndexPage.jsx'),
    vite.ssrLoadModule('/src/component/CareGuide/CareDetailPage.jsx'),
    import('react-router-dom'),
    vite.ssrLoadModule('/src/data/siteMap.js'),
    vite.ssrLoadModule('/src/data/plants.js'),
    vite.ssrLoadModule('/src/data/careArticles.js'),
    vite.ssrLoadModule('/src/data/seoMeta.js'),
  ])

  const { HOME_PATH, PLANTS_PATH, CARE_PATH, plantPath, articlePath } = siteMapModule
  const { getPlantMeta, getArticleMeta } = seoMetaModule

  const template = await readFile(resolve(outputDirectory, 'index.html'), 'utf8')

  function renderPage(element, path) {
    const markup = renderToString(
      createElement(MemoryRouter, { initialEntries: [path] }, element)
    )
    return template.replace(
      '<div id="root"></div>',
      `<div id="root" data-prerendered="true">${markup}</div>`
    )
  }

  const sitemapEntries = []

  {
    const page = setPageMetadata(renderPage(createElement(LandingPage), HOME_PATH), {
      title: 'Лейка — календарь полива и уход за комнатными растениями',
      description:
        'Планируйте полив комнатных растений, ведите коллекцию и получайте напоминания. Календарь ухода и ИИ-подсказки — в приложении «Лейка».',
      canonical: `${siteUrl}/`,
      indexable: true,
      structuredData: buildFaqPage([
        {
          question: 'Как не забывать поливать комнатные растения?',
          answer:
            'Добавьте растение, задайте интервал полива и включите уведомления. Календарь покажет, за какими растениями пора ухаживать.'
        },
        {
          question: 'Можно ли вести расписание для разных растений?',
          answer:
            'Да. Для каждого растения можно задать собственную частоту полива, время и дни напоминаний.'
        },
        {
          question: 'Как понять, когда поливать незнакомое растение?',
          answer:
            'Спросите ИИ-помощника «Лейки»: он подскажет ориентировочный график ухода, который можно настроить под условия дома.'
        }
      ])
    })
    await writeFile(resolve(outputDirectory, 'index.html'), page)
    sitemapEntries.push({ path: '/', lastmod: buildDate, changefreq: 'weekly', priority: '1.0' })
  }

  {
    const page = setPageMetadata(renderPage(createElement(PlantsIndexPage), PLANTS_PATH), {
      title: 'Комнатные растения: справочник по поливу и уходу — Лейка',
      description:
        'Частота полива, требования к свету и влажности, типичные проблемы популярных комнатных растений. Справочник «Лейки».',
      canonical: `${siteUrl}${PLANTS_PATH}`,
      indexable: true,
      structuredData: [
        buildBreadcrumbs([{ label: 'Справочник растений', path: PLANTS_PATH }]),
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Комнатные растения',
          itemListElement: PLANTS.map((plant, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: plant.name,
            url: `${siteUrl}${plantPath(plant.slug)}`
          }))
        }
      ]
    })
    await writeFile(resolve(outputDirectory, 'plants.html'), page)
    sitemapEntries.push({
      path: PLANTS_PATH,
      lastmod: buildDate,
      changefreq: 'monthly',
      priority: '0.9'
    })
  }

  for (const plant of PLANTS) {
    const path = plantPath(plant.slug)
    const meta = getPlantMeta(plant.slug)
    if (!meta) {
      throw new Error(
        `Нет метаданных для растения «${plant.slug}». Запустите: node scripts/generate-seo-meta.mjs`
      )
    }
    const page = setPageMetadata(
      renderPage(createElement(PlantsDetailPage, { slug: plant.slug }), path),
      {
        title: meta.title,
        description: meta.description,
        canonical: `${siteUrl}${path}`,
        indexable: true,
        structuredData: buildBreadcrumbs([
          { label: 'Справочник растений', path: PLANTS_PATH },
          { label: plant.name, path }
        ])
      }
    )
    await writeFile(resolve(outputDirectory, `plants-${plant.slug}.html`), page)
    sitemapEntries.push({ path, lastmod: buildDate, changefreq: 'monthly', priority: '0.8' })
  }

  {
    const page = setPageMetadata(renderPage(createElement(CareIndexPage), CARE_PATH), {
      title: 'Уход за комнатными растениями: статьи и руководства — Лейка',
      description:
        'Как понять, пора ли поливать, что делать при переливе, как подготовить растения к отпуску и другие руководства по уходу.',
      canonical: `${siteUrl}${CARE_PATH}`,
      indexable: true,
      structuredData: [
        buildBreadcrumbs([{ label: 'Уход', path: CARE_PATH }]),
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: 'Статьи об уходе за комнатными растениями',
          itemListElement: ARTICLES.map((article, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: article.title,
            url: `${siteUrl}${articlePath(article.slug)}`
          }))
        }
      ]
    })
    await writeFile(resolve(outputDirectory, 'care.html'), page)
    sitemapEntries.push({
      path: CARE_PATH,
      lastmod: buildDate,
      changefreq: 'weekly',
      priority: '0.9'
    })
  }

  for (const article of ARTICLES) {
    const path = articlePath(article.slug)
    const lastmod = article.updated || buildDate
    const structuredData = [
      buildBreadcrumbs([
        { label: 'Уход', path: CARE_PATH },
        { label: article.title, path }
      ]),
      {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: article.title,
        description: article.description,
        inLanguage: 'ru',
        datePublished: lastmod,
        dateModified: lastmod,
        mainEntityOfPage: `${siteUrl}${path}`,
        author: {
          '@type': 'Person',
          name: 'Никитин Иван Сергеевич'
        },
        publisher: {
          '@type': 'Organization',
          name: 'Лейка',
          url: `${siteUrl}/`
        }
      }
    ]

    if (article.faq?.length) {
      structuredData.push(buildFaqPage(article.faq))
    }

    const meta = getArticleMeta(article.slug)
    if (!meta) {
      throw new Error(
        `Нет метаданных для статьи «${article.slug}». Запустите: node scripts/generate-seo-meta.mjs`
      )
    }

    const page = setPageMetadata(
      renderPage(createElement(CareDetailPage, { slug: article.slug }), path),
      {
        title: meta.title,
        description: meta.description,
        canonical: `${siteUrl}${path}`,
        indexable: true,
        structuredData
      }
    )
    await writeFile(resolve(outputDirectory, `care-${article.slug}.html`), page)
    sitemapEntries.push({ path, lastmod, changefreq: 'monthly', priority: '0.7' })
  }

  for (const [route, meta] of Object.entries(privateRoutes)) {
    const page = setPageMetadata(template, {
      title: meta.title,
      description: meta.description,
      canonical: `${siteUrl}/${route}`,
      indexable: false
    })
    await writeFile(resolve(outputDirectory, `${route}.html`), page)
  }

  await writeFile(
    resolve(outputDirectory, 'sitemap.xml'),
    buildSitemap(sitemapEntries),
    'utf8'
  )

  await copyFile(resolve(root, 'htaccess'), resolve(outputDirectory, '.htaccess'))

  console.log(
    `✓ Пререндер готов: главная, ${sitemapEntries.length - 1} публичных страниц, ` +
    `${Object.keys(privateRoutes).length} закрытых разделов, sitemap на ${sitemapEntries.length} URL`
  )
} finally {
  await vite.close()
}
