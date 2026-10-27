import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const SITE_URL = 'https://checktheplants.ru'
const USER_AGENT = 'Mozilla/5.0 (compatible; LejkaSEOAudit/1.0; +https://checktheplants.ru)'

const EXTRA_PATHS = [
  '/',
  '/plants',
  '/plants/',
  '/care',
  '/care/',
  '/plants/monstera',
  '/plants/monstera/',
  '/plants/monstera.html',
  '/care/kak-chasto-polivat',
  '/care/pochemu-zhelteyut-listya',
  '/care/kak-chasto-polivat/',
  '/unknown-page-404-check',
  '/nonexistent.html',
  '/robots.txt',
  '/sitemap.xml',
  '/404.html',
  '/home.html',
  '/index.html',
  '/garden.html',
  '/assets/not-a-real-chunk.js'
]

const args = process.argv.slice(2)
const jsonArg = args.find(arg => arg.startsWith('--json='))
const jsonPath = jsonArg ? resolve(jsonArg.slice('--json='.length)) : null
const quiet = args.includes('--quiet')

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function metaContent(html, attribute, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${escaped}"\\s+content="([^"]*)"`,
    'i'
  )
  const match = pattern.exec(html)
  return match ? match[1] : null
}

function countTag(html, tag) {
  return (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
}

function jsonLdTypes(html) {
  const types = []
  const pattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi
  let match
  while ((match = pattern.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const item of list) {
        if (item && item['@type']) {
          types.push(String(item['@type']))
        }
      }
    } catch {
      types.push('INVALID_JSON')
    }
  }
  return types
}

function imgAltIssues(html) {
  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(match => match[0])
  const withoutAlt = images.filter(tag => !/\balt=/.test(tag)).length
  const emptyAlt = images.filter(tag => /\balt=""/.test(tag)).length
  return { count: images.length, withoutAlt, emptyAlt }
}

async function fetchText(path, options = {}) {
  const response = await fetch(`${SITE_URL}${path}`, {
    redirect: options.follow === false ? 'manual' : 'follow',
    headers: { 'user-agent': USER_AGENT, 'accept-encoding': 'gzip, deflate, br' }
  })
  const body = await response.text()
  return { response, body }
}

async function fetchHead(path) {
  const response = await fetch(`${SITE_URL}${path}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'user-agent': USER_AGENT }
  })
  return response
}

function sitemapLocations(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1])
}

function sitemapLastmods(xml) {
  return [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map(match => match[1])
}

async function auditPage(path) {
  const { response, body } = await fetchText(path)
  const finalUrl = response.url
  const html = response.ok && /text\/html/.test(response.headers.get('content-type') ?? '')
    ? body
    : ''

  if (!html) {
    return {
      path,
      status: response.status,
      finalUrl: finalUrl !== `${SITE_URL}${path}` ? finalUrl : null
    }
  }

  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [null, null])[1]
  const description = metaContent(html, 'name', 'description')
  const robots = metaContent(html, 'name', 'robots')
  const canonical = (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html) || [null, null])[1]
  const ogTitle = metaContent(html, 'property', 'og:title')
  const ogImage = metaContent(html, 'property', 'og:image')
  const twitterCard = metaContent(html, 'name', 'twitter:card')
  const h1 = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(match => stripTags(match[1]))
  const h2Count = countTag(html, 'h2')
  const jsonLd = jsonLdTypes(html)
  const text = stripTags(html)
  const alt = imgAltIssues(html)

  return {
    path,
    status: response.status,
    finalUrl: finalUrl !== `${SITE_URL}${path}` ? finalUrl : null,
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    robots,
    canonical,
    canonicalMatches: Boolean(canonical && canonical === finalUrl),
    ogTitle,
    ogImage,
    twitterCard,
    h1Count: h1.length,
    h1: h1[0] ?? null,
    h2Count,
    jsonLd,
    words: text ? text.split(' ').filter(Boolean).length : 0,
    images: alt
  }
}

function reportLine(entry) {
  if (!entry.title) {
    return `${String(entry.status).padEnd(3)} ${entry.path.padEnd(34)} ${entry.finalUrl ? `→ ${entry.finalUrl}` : 'без HTML'}`
  }
  const parts = [
    String(entry.status).padEnd(3),
    entry.path.padEnd(34),
    `t=${String(entry.titleLength).padStart(3)}`,
    `d=${String(entry.descriptionLength).padStart(3)}`,
    `h1=${entry.h1Count}`,
    `h2=${String(entry.h2Count).padStart(2)}`,
    `w=${String(entry.words).padStart(4)}`,
    `ld=${entry.jsonLd.join('+') || '—'}`,
    entry.canonicalMatches ? 'canon=ok' : `canon=${entry.canonical ?? 'нет'}`,
    entry.robots && entry.robots.includes('noindex') ? 'NOINDEX' : 'index',
    entry.images.withoutAlt ? `img-no-alt=${entry.images.withoutAlt}` : ''
  ]
  return parts.filter(Boolean).join(' ')
}

const { body: robotsTxt } = await fetchText('/robots.txt')
const { body: sitemapXml, response: sitemapResponse } = await fetchText('/sitemap.xml')

const sitemapUrls = sitemapLocations(sitemapXml)
const sitemapPaths = sitemapUrls.map(url => url.replace(SITE_URL, '') || '/')

const paths = [...new Set([...sitemapPaths, ...EXTRA_PATHS])]

const results = []
for (const path of paths) {
  try {
    results.push(await auditPage(path))
  } catch (error) {
    results.push({ path, status: 0, error: error.message })
  }
}

const sitemapStatuses = []
for (const path of sitemapPaths) {
  try {
    const response = await fetchHead(path)
    sitemapStatuses.push({
      path,
      status: response.status,
      location: response.headers.get('location')
    })
  } catch (error) {
    sitemapStatuses.push({ path, status: 0, error: error.message })
  }
}

const titles = new Map()
const duplicateTitles = []
for (const entry of results) {
  if (!entry.title) continue
  if (titles.has(entry.title)) duplicateTitles.push([titles.get(entry.title), entry.path])
  else titles.set(entry.title, entry.path)
}

const longTitles = results.filter(entry => entry.title && entry.titleLength > 70)
const shortTitles = results.filter(entry => entry.title && entry.titleLength < 30)
const longDescriptions = results.filter(
  entry => entry.description && entry.descriptionLength > 165
)
const missingDescription = results.filter(entry => entry.title && !entry.description)
const multipleH1 = results.filter(entry => entry.title && entry.h1Count !== 1)
const missingJsonLd = results.filter(entry => entry.status === 200 && entry.title && !entry.jsonLd.length)
const missingAlt = results.filter(entry => entry.images && entry.images.withoutAlt > 0)
const canonicalMismatch = results.filter(entry => entry.title && !entry.canonicalMatches)
const sitemapRedirects = sitemapStatuses.filter(entry => entry.status !== 200)

if (!quiet) {
  console.log('SEO-аудит прода\n')
  console.log('Страницы:\n')
  for (const entry of results) console.log(`  ${reportLine(entry)}`)

  console.log('\nrobots.txt:\n')
  for (const line of robotsTxt.trim().split(/\r?\n/)) console.log(`  ${line}`)

  console.log('\nSitemap:\n')
  console.log(`  статус: ${sitemapResponse.status}, URL: ${sitemapUrls.length}`)
  const lastmods = sitemapLastmods(sitemapXml)
  const uniqueLastmods = [...new Set(lastmods)].sort()
  console.log(`  lastmod: ${uniqueLastmods.join(', ') || 'нет'}`)
  console.log(`  адресов с не-200: ${sitemapRedirects.length}`)
  for (const entry of sitemapRedirects) {
    console.log(`    ${entry.status} ${entry.path}${entry.location ? ` → ${entry.location}` : ''}`)
  }

  console.log('\nПроблемы:\n')
  const problemGroups = [
    ['дубли title', duplicateTitles],
    ['title длиннее 70 символов', longTitles],
    ['title короче 30 символов', shortTitles],
    ['description длиннее 165 символов', longDescriptions],
    ['нет description', missingDescription],
    ['не ровно один h1', multipleH1],
    ['нет JSON-LD', missingJsonLd],
    ['img без alt', missingAlt],
    ['canonical не совпадает с URL', canonicalMismatch]
  ]
  let problemCount = 0
  for (const [label, items] of problemGroups) {
    if (!items.length) continue
    problemCount += items.length
    console.log(`  ✗ ${label} (${items.length}):`)
    for (const item of items) {
      if (Array.isArray(item)) console.log(`      ${item[0]} = ${item[1]}`)
      else console.log(`      ${item.path} (${item.titleLength ?? item.descriptionLength ?? item.h1Count ?? ''})`)
    }
  }
  if (!problemCount) console.log('  ✓ критичных проблем не найдено')
}

if (jsonPath) {
  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        robots: robotsTxt,
        sitemap: {
          status: sitemapResponse.status,
          urls: sitemapUrls,
          lastmods: sitemapLastmods(sitemapXml),
          nonOk: sitemapRedirects
        },
        pages: results
      },
      null,
      2
    ),
    'utf8'
  )
  if (!quiet) console.log(`\nJSON: ${jsonPath}`)
}
