export function resolveMultiAddSelection({ plants = [], matched = [], selected = [] } = {}) {
    const selectedSet = new Set(Array.isArray(selected) ? selected : [])
    const chosen = (Array.isArray(plants) ? plants : []).filter(
        plant => plant && typeof plant.slug === 'string' && selectedSet.has(plant.slug)
    )

    const chosenSlugs = new Set(chosen.map(plant => plant.slug))
    const matchedBySlug = new Map()
    for (const entry of Array.isArray(matched) ? matched : []) {
        const slug = entry?.plant?.slug
        if (slug && chosenSlugs.has(slug)) matchedBySlug.set(slug, entry)
    }

    return { chosen, matchedBySlug }
}
