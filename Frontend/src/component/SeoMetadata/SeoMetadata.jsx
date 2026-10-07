import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { getArticleMeta, getPlantMeta } from '../../data/seoMeta.js'
import { CARE_PATH, PLANTS_PATH } from '../../data/siteMap.js'
import {
    INDEXABLE_ROBOTS,
    NOINDEX_ROBOTS,
    SITE_URL,
    normalizePath,
    upsertMeta,
} from '../../utils/seo.js'


const HOME_META = {
    title: 'Лейка — календарь полива и уход за комнатными растениями',
    description:
        'Планируйте полив комнатных растений, ведите коллекцию и получайте напоминания. Календарь ухода и ИИ-подсказки — в приложении «Лейка».',
    indexable: true,
}

const PRIVATE_META = {
    '/login': {
        title: 'Вход — Лейка',
        description: 'Войдите в аккаунт «Лейки», чтобы открыть расписание полива и коллекцию растений.',
        indexable: false,
    },
    '/register': {
        title: 'Регистрация — Лейка',
        description: 'Создайте аккаунт «Лейки»: сохраните растения, настройте график полива и напоминания.',
        indexable: false,
    },
    '/home': {
        title: 'Мой сад — Лейка',
        description: 'Личный раздел «Лейки»: растения, расписание полива и календарь ухода.',
        indexable: false,
    },
    '/add-plant': {
        title: 'Добавление растения — Лейка',
        description: 'Добавьте новое растение в коллекцию и настройте для него график полива.',
        indexable: false,
    },
    '/edit-profile': {
        title: 'Настройки профиля — Лейка',
        description: 'Настройки аккаунта «Лейки»: профиль, напоминания и согласия.',
        indexable: false,
    },
    '/my-plants': {
        title: 'Мои растения — Лейка',
        description: 'Список растений в вашей коллекции с расписанием полива и историей ухода.',
        indexable: false,
    },
}

const PLANTS_INDEX_META = {
    title: 'Комнатные растения: справочник по поливу и уходу — Лейка',
    description:
        'Частота полива, требования к свету и влажности, типичные проблемы популярных комнатных растений. Справочник «Лейки».',
    indexable: true,
}

const CARE_INDEX_META = {
    title: 'Уход за комнатными растениями: статьи и руководства — Лейка',
    description:
        'Как понять, пора ли поливать, что делать при переливе, как подготовить растения к отпуску и другие руководства по уходу.',
    indexable: true,
}

function resolveMeta(pathname) {
    const path = normalizePath(pathname)

    if (path === '/') return HOME_META
    if (PRIVATE_META[path]) return PRIVATE_META[path]
    if (path === PLANTS_PATH) return PLANTS_INDEX_META
    if (path === CARE_PATH) return CARE_INDEX_META

    const plantMatch = new RegExp(`^${PLANTS_PATH}/([^/]+)$`).exec(path)
    if (plantMatch) {
        const plant = getPlantMeta(plantMatch[1])
        if (plant) return { ...plant, indexable: true }
    }

    const articleMatch = new RegExp(`^${CARE_PATH}/([^/]+)$`).exec(path)
    if (articleMatch) {
        const article = getArticleMeta(articleMatch[1])
        if (article) return { ...article, indexable: true }
    }

    return HOME_META
}

function SeoMetadata() {
    const { pathname } = useLocation()

    useEffect(() => {
        const meta = resolveMeta(pathname)
        const normalized = normalizePath(pathname)
        const canonicalUrl = new URL(
            normalized === '/' ? '/' : normalized,
            SITE_URL
        ).href

        document.title = meta.title

        upsertMeta('name', 'description', meta.description)
        upsertMeta('name', 'robots', meta.indexable ? INDEXABLE_ROBOTS : NOINDEX_ROBOTS)
        upsertMeta('property', 'og:title', meta.title)
        upsertMeta('property', 'og:description', meta.description)
        upsertMeta('property', 'og:url', canonicalUrl)
        upsertMeta('name', 'twitter:title', meta.title)
        upsertMeta('name', 'twitter:description', meta.description)

        let canonical = document.head.querySelector('link[rel="canonical"]')
        if (!canonical) {
            canonical = document.createElement('link')
            canonical.rel = 'canonical'
            document.head.appendChild(canonical)
        }
        canonical.href = canonicalUrl
    }, [pathname])

    return null
}

export default SeoMetadata
