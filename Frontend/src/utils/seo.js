
export const SITE_URL = 'https://checktheplants.ru/'

export const INDEXABLE_ROBOTS =
    'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1'

export const NOINDEX_ROBOTS = 'noindex, follow'

export function normalizePath(pathname) {
    if (!pathname || pathname === '/') return '/'
    return pathname.replace(/\/+$/, '') || '/'
}

export function upsertMeta(attribute, key, content) {
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`)
    if (!element) {
        element = document.createElement('meta')
        element.setAttribute(attribute, key)
        document.head.appendChild(element)
    }
    element.content = content
}

export function markPageAsNotFound() {
    const previousTitle = document.title
    const robots = document.head.querySelector('meta[name="robots"]')
    const previousRobots = robots ? robots.content : null

    document.title = 'Страница не найдена — Лейка'
    upsertMeta('name', 'robots', NOINDEX_ROBOTS)

    return () => {
        document.title = previousTitle
        if (previousRobots !== null) upsertMeta('name', 'robots', previousRobots)
    }
}
