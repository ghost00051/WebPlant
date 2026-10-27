import { PLANTS } from '../data/plants.js'
import { normalizeSpecies, speciesKey } from './popularSpecies.js'

export const LIGHT_OPTIONS = Object.freeze([
    { id: 'sun', label: 'Солнце', hint: 'Прямые лучи большую часть дня' },
    { id: 'partial', label: 'Полутень', hint: 'Рассеянный свет или солнце утром' },
    { id: 'shade', label: 'Тень', hint: 'Света мало, окно в глубине комнаты' }
])

export const LIGHT_IDS = Object.freeze(LIGHT_OPTIONS.map(option => option.id))

export const ROOM_SUGGESTIONS = Object.freeze([
    'Гостиная',
    'Спальня',
    'Кухня',
    'Кабинет',
    'Ванная',
    'Балкон',
    'Коридор'
])

const MAX_ROOM_LENGTH = 255
const MIN_INTERVAL_DAYS = 1
const MAX_INTERVAL_DAYS = 365
const DEFAULT_INTERVAL_DAYS = 7
const DASH_PATTERN = /[\u2010-\u2015\u2212]|[-–—]/

export function normalizeRoom(value) {
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, MAX_ROOM_LENGTH)
}

export function normalizeLight(value) {
    if (typeof value !== 'string') return ''
    const normalized = value.trim().toLowerCase()
    const aliases = {
        sun: 'sun',
        sunny: 'sun',
        солнце: 'sun',
        'прямое солнце': 'sun',
        partial: 'partial',
        partial_shade: 'partial',
        полутень: 'partial',
        shade: 'shade',
        shadow: 'shade',
        тень: 'shade'
    }
    return aliases[normalized] ?? ''
}

export function lightLabel(value) {
    const id = normalizeLight(value)
    return LIGHT_OPTIONS.find(option => option.id === id)?.label ?? ''
}

export function lightHint(value) {
    const id = normalizeLight(value)
    return LIGHT_OPTIONS.find(option => option.id === id)?.hint ?? ''
}

export function lightFromPlant(plant) {
    if (!plant || typeof plant !== 'object') return ''
    return normalizeLight(plant.light) || normalizeLight(plant.metadata?.care_hints?.light)
}

export function roomFromPlant(plant) {
    if (!plant || typeof plant !== 'object') return ''
    const value = plant.location ?? plant.room ?? ''
    return normalizeRoom(value)
}

export function conditionsSummary(room, light) {
    const roomLabel = normalizeRoom(room)
    const lightName = lightLabel(light)
    if (roomLabel && lightName) return `${roomLabel} · ${String(lightName).toLowerCase()}`
    return roomLabel || (lightName ? String(lightName).toLowerCase() : '')
}

export function buildConditionsMetadata(light, baseMetadata) {
    const base = baseMetadata && typeof baseMetadata === 'object' && !Array.isArray(baseMetadata)
        ? baseMetadata
        : {}
    const id = normalizeLight(light)
    if (!id) return base
    const careHints = base.care_hints && typeof base.care_hints === 'object' && !Array.isArray(base.care_hints)
        ? base.care_hints
        : {}
    return { ...base, care_hints: { ...careHints, light: id } }
}

export function clampIntervalDays(value) {
    const days = Math.round(Number(value))
    if (!Number.isFinite(days)) return DEFAULT_INTERVAL_DAYS
    return Math.min(MAX_INTERVAL_DAYS, Math.max(MIN_INTERVAL_DAYS, days))
}

export function parseGuideInterval(value) {
    if (typeof value === 'number') {
        return { min: clampIntervalDays(value), max: clampIntervalDays(value) }
    }
    if (typeof value !== 'string') return null
    const numbers = value
        .split(DASH_PATTERN)
        .flatMap(part => part.split(/\s+/))
        .map(part => Number(part.replace(',', '.')))
        .filter(number => Number.isFinite(number) && number > 0)
        .map(clampIntervalDays)
    if (!numbers.length) return null
    return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

export function guideIntervalDays(plant) {
    const bounds = parseGuideInterval(plant?.intervalDays ?? plant?.interval_days)
    if (!bounds) return DEFAULT_INTERVAL_DAYS
    return bounds.max
}

function guideSpecies(plant) {
    return normalizeSpecies(plant?.latin) || normalizeSpecies(plant?.name)
}

export function guidePlants(limit) {
    const list = Array.isArray(PLANTS) ? PLANTS : []
    const mapped = list
        .filter(plant => plant && typeof plant.slug === 'string')
        .map(plant => ({
            slug: plant.slug,
            name: normalizeSpecies(plant.name),
            latin: normalizeSpecies(plant.latin),
            species: guideSpecies(plant),
            intervalDays: guideIntervalDays(plant),
            intervalLabel: typeof plant.intervalLabel === 'string' ? plant.intervalLabel : '',
            lightLabel: typeof plant.light === 'string' ? plant.light : ''
        }))
    if (!Number.isInteger(limit) || limit <= 0) return mapped
    return mapped.slice(0, limit)
}

export function guidePlantBySlug(slug) {
    if (typeof slug !== 'string' || !slug.trim()) return null
    return guidePlants().find(plant => plant.slug === slug) ?? null
}

function readQueryValue(searchParams, key) {
    if (!searchParams || !key) return ''
    if (typeof searchParams.get === 'function') {
        const value = searchParams.get(key)
        return typeof value === 'string' ? value : ''
    }
    if (typeof searchParams === 'object' && typeof searchParams[key] === 'string') {
        return searchParams[key]
    }
    return ''
}

export function resolveAddPlantPrefill(searchParams) {
    const rawSpecies = readQueryValue(searchParams, 'species')
    const preset = guidePlantBySlug(rawSpecies)
    const rawName = normalizeSpecies(readQueryValue(searchParams, 'name'))
    const rawDays = Number(readQueryValue(searchParams, 'days') || readQueryValue(searchParams, 'interval'))
    const intervalDays = Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 365
        ? rawDays
        : (preset ? preset.intervalDays : null)

    return {
        slug: preset?.slug ?? '',
        matchedGuide: Boolean(preset),
        name: rawName || (preset ? preset.name : ''),
        species: preset ? preset.latin : normalizeSpecies(rawSpecies),
        intervalDays,
        room: normalizeRoom(readQueryValue(searchParams, 'room')),
        light: normalizeLight(readQueryValue(searchParams, 'light'))
    }
}

function normalizeMatchText(value) {
    return speciesKey(value)
        .replace(/[^a-zа-я0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function tokenStems(value) {
    return normalizeMatchText(value)
        .split(' ')
        .filter(token => token.length >= 4)
        .map(token => token.slice(0, Math.max(4, token.length - 2)))
}

export function matchGuidePlants(text, limit = 3) {
    const haystack = normalizeMatchText(text)
    if (!haystack) return []
    const max = Number.isInteger(limit) && limit > 0 ? limit : 3
    const matches = []
    const seen = new Set()

    for (const plant of guidePlants()) {
        const nameKey = normalizeMatchText(plant.name)
        const latinKey = normalizeMatchText(plant.latin)
        const latinGenus = latinKey.split(' ')[0]
        const stemHit = tokenStems(plant.name).some(stem => haystack.includes(stem))
        const hit =
            (nameKey && haystack.includes(nameKey)) ||
            stemHit ||
            (latinKey && haystack.includes(latinKey)) ||
            (latinGenus.length > 3 && haystack.includes(latinGenus))
        if (!hit) continue
        const key = plant.slug
        if (seen.has(key)) continue
        seen.add(key)
        matches.push(plant)
        if (matches.length >= max) break
    }

    return matches
}

export function findGuidePlantBySpecies(species, plants) {
    const key = normalizeMatchText(species)
    if (!key) return null
    const list = Array.isArray(plants) && plants.length ? plants : guidePlants()
    return list.find(plant =>
        normalizeMatchText(plant.latin) === key ||
        normalizeMatchText(plant.name) === key ||
        normalizeMatchText(plant.species) === key
    ) ?? null
}
