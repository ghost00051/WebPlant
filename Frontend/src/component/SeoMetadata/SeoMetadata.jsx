import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

const SITE_URL = 'https://checktheplants.ru/'
const HOME_TITLE = 'Лейка — календарь полива и уход за комнатными растениями'
const HOME_DESCRIPTION =
    'Планируйте полив комнатных растений, ведите коллекцию и получайте напоминания. Календарь ухода и ИИ-подсказки — в приложении «Лейка».'

function getPageTitle(pathname) {
    if (pathname === '/') return HOME_TITLE
    if (pathname === '/login') return 'Вход — Лейка'
    if (pathname === '/register') return 'Регистрация — Лейка'
    return 'Мой сад — Лейка'
}

function upsertMeta(attribute, key, content) {
    let element = document.head.querySelector(`meta[${attribute}="${key}"]`)
    if (!element) {
        element = document.createElement('meta')
        element.setAttribute(attribute, key)
        document.head.appendChild(element)
    }
    element.content = content
}

function SeoMetadata() {
    const { pathname } = useLocation()
    const isPublicLanding = pathname === '/'

    useEffect(() => {
        const canonicalUrl = new URL(pathname, SITE_URL).href
        document.title = isPublicLanding
            ? HOME_TITLE
            : getPageTitle(pathname)

        upsertMeta(
            'name',
            'description',
            isPublicLanding ? HOME_DESCRIPTION : 'Вход в приложение «Лейка».'
        )
        upsertMeta(
            'name',
            'robots',
            isPublicLanding ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'
        )
        upsertMeta('property', 'og:title', isPublicLanding ? HOME_TITLE : 'Лейка')
        upsertMeta(
            'property',
            'og:description',
            isPublicLanding ? HOME_DESCRIPTION : 'Войдите в приложение «Лейка».'
        )
        upsertMeta('property', 'og:url', canonicalUrl)

        let canonical = document.head.querySelector('link[rel="canonical"]')
        if (!canonical) {
            canonical = document.createElement('link')
            canonical.rel = 'canonical'
            document.head.appendChild(canonical)
        }
        canonical.href = canonicalUrl
    }, [isPublicLanding, pathname])

    return null
}

export default SeoMetadata
