import { API_URL } from './api.js'
import { fetchWithTimeout } from './fetchWithTimeout.js'
import { dayOfMonth, monthGenitive } from './date.js'
import { matchGuidePlants } from './plantConditions.js'

export const HEALTH_CHECKS_STORAGE_KEY = 'webplant-plant-health-checks'
export const PLANTS_EXTRA_TIMEOUT_MS = 20000

const UNAVAILABLE_STATUSES = new Set([404, 405, 501, 502, 503, 504])
const MAX_STORED_CHECKS = 60
const PHOTO_FIELDS = ['url', 'photo_url', 'src']
const DATE_FIELDS = ['taken_at', 'takenAt', 'created_at', 'createdAt', 'date']

export class PlantFeatureUnavailableError extends Error {
    constructor(message, { status = 0, code = 'feature-unavailable', cause } = {}) {
        super(message, cause === undefined ? undefined : { cause })
        this.name = 'PlantFeatureUnavailableError'
        this.status = status
        this.code = code
    }
}

export function isFeatureUnavailable(error) {
    if (!error) return false
    if (error instanceof PlantFeatureUnavailableError) return true
    if (error.code === 'feature-unavailable') return true
    if (error.code === 'network' || error.code === 'timeout') return true
    return UNAVAILABLE_STATUSES.has(Number(error.status))
}

export function isUnavailableStatus(status) {
    return UNAVAILABLE_STATUSES.has(Number(status))
}

async function readJson(response) {
    return response.json().catch(() => ({}))
}

function toIsoString(value) {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    const date = new Date(trimmed)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function photoUrlOf(raw) {
    if (typeof raw === 'string') return raw.trim()
    if (!raw || typeof raw !== 'object') return ''
    for (const field of PHOTO_FIELDS) {
        const value = raw[field]
        if (typeof value === 'string' && value.trim()) return value.trim()
    }
    return ''
}

function photoDateOf(raw) {
    if (!raw || typeof raw !== 'object') return null
    for (const field of DATE_FIELDS) {
        const iso = toIsoString(raw[field])
        if (iso) return iso
    }
    return null
}

export function normalizePhotoList(payload) {
    const raw = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.photos)
                ? payload.photos
                : []

    const result = []
    const seen = new Set()

    raw.forEach((item, index) => {
        const url = photoUrlOf(item)
        if (!url || seen.has(url)) return
        seen.add(url)
        const object = item && typeof item === 'object' ? item : {}
        result.push({
            id: Number.isInteger(object.id) ? object.id : `photo-${index}`,
            url,
            createdAt: photoDateOf(object),
            isMain: object.is_main === true || object.isMain === true,
            metadata: object.metadata && typeof object.metadata === 'object' ? object.metadata : null
        })
    })

    return result
}

export function sortPhotosByDate(photos) {
    return [...(Array.isArray(photos) ? photos : [])].sort((a, b) => {
        const left = a?.createdAt ? new Date(a.createdAt).getTime() : 0
        const right = b?.createdAt ? new Date(b.createdAt).getTime() : 0
        return left - right
    })
}

export function normalizeDiagnosis(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const likelyProblems = Array.isArray(raw.likelyProblems)
        ? raw.likelyProblems
            .filter(item => item && typeof item === 'object' && typeof item.name === 'string' && item.name.trim())
            .map(item => ({
                name: item.name.trim(),
                confidence: typeof item.confidence === 'string' ? item.confidence : '',
                why: typeof item.why === 'string' ? item.why.trim() : ''
            }))
            .slice(0, 4)
        : []
    const careAdvice = Array.isArray(raw.careAdvice)
        ? raw.careAdvice.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 6)
        : []
    const visibleSymptoms = Array.isArray(raw.visibleSymptoms)
        ? raw.visibleSymptoms.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()).slice(0, 6)
        : []
    const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''

    if (raw.isPlant === undefined && !summary && !likelyProblems.length && !visibleSymptoms.length) return null

    return {
        isPlant: raw.isPlant !== false,
        plantName: typeof raw.plantName === 'string' ? raw.plantName.trim() : '',
        severity: typeof raw.severity === 'string' ? raw.severity : '',
        summary,
        likelyProblems,
        careAdvice,
        visibleSymptoms,
        needsAnotherPhoto: raw.needsAnotherPhoto === true
    }
}

export function normalizeHealthCheck(payload, { photoUrl = '', createdAt = null } = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
    const text = typeof payload.text === 'string'
        ? payload.text.trim()
        : typeof payload.reply === 'string'
            ? payload.reply.trim()
            : typeof payload.message === 'string'
                ? payload.message.trim()
                : ''
    const diagnosis = normalizeDiagnosis(payload.diagnosis)
    if (!text && !diagnosis) return null
    return {
        text,
        diagnosis,
        photoUrl: photoUrlOf(payload.photoUrl) || photoUrlOf(payload.photo_url) || photoUrl,
        createdAt: toIsoString(payload.createdAt) || toIsoString(payload.created_at) || createdAt || new Date().toISOString(),
        saved: payload.saved === true
    }
}

function normalizeHealthCheckList(raw) {
    const items = Array.isArray(raw) ? raw : [raw]
    let latest = null
    for (const item of items) {
        const check = normalizeHealthCheck(item)
        if (!check) continue
        if (!latest || String(check.createdAt) > String(latest.createdAt)) latest = check
    }
    return latest
}

export function healthCheckFromPlant(plant) {
    const metadata = plant && typeof plant === 'object' ? plant.metadata : null
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
    const raw = metadata.health_check ?? metadata.healthCheck
    if (!raw) return null
    return normalizeHealthCheckList(raw)
}

export function healthCheckLabel(check) {
    if (!check) return null
    const diagnosis = check.diagnosis
    if (!diagnosis) return { tone: 'unknown', label: 'без диагноза' }
    if (diagnosis.isPlant === false) return { tone: 'unknown', label: 'на фото не растение' }
    const problem = diagnosis.likelyProblems[0]
    if (problem) return { tone: 'attention', label: `есть проблемы: ${problem.name}` }
    if (diagnosis.severity === 'high' || diagnosis.severity === 'medium') {
        return { tone: 'attention', label: 'нужно внимание' }
    }
    if (diagnosis.visibleSymptoms.length) {
        return { tone: 'attention', label: `заметны изменения: ${diagnosis.visibleSymptoms[0]}` }
    }
    if (!diagnosis.summary) return { tone: 'unknown', label: 'без диагноза' }
    return { tone: 'ok', label: 'здорова' }
}

export function formatCheckDate(value) {
    const date = value instanceof Date ? value : new Date(value)
    if (!Number.isFinite(date.getTime())) return ''
    return `${dayOfMonth(date)} ${monthGenitive(date)}`
}

function getStorage() {
    try {
        if (typeof window === 'undefined' || !window.localStorage) return null
        return window.localStorage
    } catch {
        return null
    }
}

function isStoredCheck(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
        (typeof value.text === 'string' || Boolean(value.diagnosis))
}

export function readHealthChecks() {
    const storage = getStorage()
    if (!storage) return {}
    try {
        const raw = JSON.parse(storage.getItem(HEALTH_CHECKS_STORAGE_KEY) || '{}')
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
        const result = {}
        for (const [plantId, check] of Object.entries(raw)) {
            if (!isStoredCheck(check)) continue
            result[plantId] = check
        }
        return result
    } catch {
        return {}
    }
}

export function saveHealthCheck(plantId, check) {
    if (plantId === null || plantId === undefined || !isStoredCheck(check)) return readHealthChecks()
    const storage = getStorage()
    const current = readHealthChecks()
    current[String(plantId)] = {
        text: typeof check.text === 'string' ? check.text : '',
        diagnosis: check.diagnosis ?? null,
        photoUrl: typeof check.photoUrl === 'string' ? check.photoUrl : '',
        createdAt: toIsoString(check.createdAt) || new Date().toISOString()
    }
    const entries = Object.entries(current)
        .sort((a, b) => String(b[1].createdAt).localeCompare(String(a[1].createdAt)))
        .slice(0, MAX_STORED_CHECKS)
    if (!storage) return current
    try {
        storage.setItem(HEALTH_CHECKS_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
    } catch {
        return current
    }
    return Object.fromEntries(entries)
}

export function checkFromPhotos(photos) {
    const list = normalizePhotoList(photos)
    let latest = null
    for (const photo of list) {
        const raw = photo.metadata?.diagnosis ?? photo.metadata?.health
        const diagnosis = normalizeDiagnosis(raw)
        if (!diagnosis) continue
        if (!latest || String(photo.createdAt || '') > String(latest.createdAt || '')) {
            latest = {
                text: typeof photo.metadata?.diagnosis_text === 'string' ? photo.metadata.diagnosis_text : '',
                diagnosis,
                photoUrl: photo.url,
                createdAt: photo.createdAt
            }
        }
    }
    return latest
}

export function pickLatestHealthCheck({ checks, plantId, photos, serverCheck = null } = {}) {
    const stored = checks && plantId !== null && plantId !== undefined
        ? checks[String(plantId)] ?? null
        : null
    const fromPhotos = checkFromPhotos(photos)
    const candidates = [serverCheck, stored, fromPhotos].filter(Boolean)
    if (!candidates.length) return null
    return candidates.reduce((latest, candidate) =>
        String(candidate.createdAt || '') > String(latest.createdAt || '') ? candidate : latest
    )
}

export async function fetchPlantPhotos(plantId) {
    const response = await fetchWithTimeout(
        `${API_URL}/plants/${encodeURIComponent(plantId)}/photos`,
        { method: 'GET', credentials: 'include' },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    const data = await readJson(response)
    if (!response.ok) {
        const hasServerMessage = typeof data?.message === 'string' && data.message.trim()
        if (isUnavailableStatus(response.status) && !hasServerMessage) {
            throw new PlantFeatureUnavailableError('Галерея фото пока недоступна', { status: response.status })
        }
        throw new Error(data?.message || `Не удалось загрузить фото: HTTP ${response.status}`)
    }
    return normalizePhotoList(data)
}

export function isAbortError(error) {
    if (!error || typeof error !== 'object') return false
    return error.name === 'AbortError' ||
        error.code === 'ABORT_ERR' ||
        error.code === 20 ||
        (Boolean(error.cause) && error.cause.name === 'AbortError')
}

export function createHealthCheckAbortError() {
    const error = new Error('Проверка здоровья отменена')
    error.name = 'AbortError'
    return error
}

function isPlantNotFoundResponse(status, data) {
    if (Number(status) !== 404) return false
    const message = typeof data?.message === 'string' ? data.message : ''
    return /растени/i.test(message) && /(не найден|not found)/i.test(message)
}

async function postHealthCheck(plantId, { photoUrl, file, question, signal }) {
    if (file) {
        const formData = new FormData()
        formData.append('photo', file)
        if (question) formData.append('question', question)
        const response = await fetchWithTimeout(
            `${API_URL}/plants/${encodeURIComponent(plantId)}/health-check`,
            { method: 'POST', body: formData, credentials: 'include', signal },
            PLANTS_EXTRA_TIMEOUT_MS
        )
        const data = await readJson(response)
        if (!response.ok) {
            if (isPlantNotFoundResponse(response.status, data)) {
                throw new Error(data.message)
            }
            if (isUnavailableStatus(response.status)) {
                throw new PlantFeatureUnavailableError('Проверка здоровья пока недоступна', { status: response.status })
            }
            throw new Error(data?.message || `Не удалось проверить здоровье: HTTP ${response.status}`)
        }
        return normalizeHealthCheck(data)
    }

    const response = await fetchWithTimeout(
        `${API_URL}/plants/${encodeURIComponent(plantId)}/health-check`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ photoUrl, ...(question ? { question } : {}) }),
            signal
        },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    const data = await readJson(response)
    if (!response.ok) {
        if (isPlantNotFoundResponse(response.status, data)) {
            throw new Error(data.message)
        }
        if (isUnavailableStatus(response.status)) {
            throw new PlantFeatureUnavailableError('Проверка здоровья пока недоступна', { status: response.status })
        }
        throw new Error(data?.message || `Не удалось проверить здоровье: HTTP ${response.status}`)
    }
    return normalizeHealthCheck(data)
}

async function photoUrlToFile(photoUrl, signal) {
    const response = await fetchWithTimeout(
        photoUrl,
        { method: 'GET', credentials: 'include', signal },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    if (!response.ok) throw new Error('Не удалось открыть фото растения')
    const blob = await response.blob()
    if (!blob || !blob.size) throw new Error('Фото растения пустое')
    const type = blob.type || 'image/jpeg'
    const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'
    return new File([blob], `plant-photo.${extension}`, { type })
}

async function postChatPhotoCheck(file, question, signal) {
    const formData = new FormData()
    formData.append('photo', file)
    if (question) formData.append('message', question)
    const response = await fetchWithTimeout(
        `${API_URL}/chat/photo`,
        { method: 'POST', body: formData, credentials: 'include', signal },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    const data = await readJson(response)
    if (!response.ok) {
        const message = typeof data?.message === 'string' && data.message.trim()
            ? data.message.trim()
            : 'Не удалось проверить здоровье растения'
        throw new Error(message)
    }
    return normalizeHealthCheck(data)
}

export async function requestPlantHealthCheck(plantId, { photoUrl = '', file = null, question = '', signal } = {}) {
    if (plantId === null || plantId === undefined) throw new Error('Не выбрано растение')

    const throwIfAborted = () => {
        if (signal?.aborted) throw createHealthCheckAbortError()
    }

    throwIfAborted()

    try {
        return await postHealthCheck(plantId, { photoUrl, file, question, signal })
    } catch (error) {
        if (signal?.aborted || isAbortError(error)) throw error
        if (!isFeatureUnavailable(error)) throw error

        throwIfAborted()
        let fallbackFile = file
        if (!fallbackFile && photoUrl) {
            try {
                fallbackFile = await photoUrlToFile(photoUrl, signal)
            } catch (fallbackError) {
                if (signal?.aborted || isAbortError(fallbackError)) throw fallbackError
                throw error
            }
        }
        throwIfAborted()
        if (!fallbackFile) throw error
        return postChatPhotoCheck(fallbackFile, question, signal)
    }
}

export async function uploadPlantPhoto(file) {
    if (!file) throw new Error('Файл не выбран')
    const formData = new FormData()
    formData.append('photos', file)
    const response = await fetchWithTimeout(
        `${API_URL}/upload`,
        { method: 'POST', body: formData, credentials: 'include' },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    const data = await readJson(response)
    if (!response.ok) {
        throw new Error(data?.message || 'Не удалось загрузить фото')
    }
    const urls = Array.isArray(data?.urls) ? data.urls : []
    const candidates = [urls[0], data?.url, data?.photoUrl, data?.thumbUrl]
    const url = candidates.find(value => typeof value === 'string' && value.trim())
    if (!url) throw new Error('Сервер не вернул ссылку на фото')
    return url.trim()
}

export function normalizeSpeciesSuggestion(payload) {
    if (!payload || typeof payload !== 'object') return []
    const raw = Array.isArray(payload.suggestions)
        ? payload.suggestions
        : Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.species)
                ? payload.species
                : payload.species || payload.name
                    ? [payload]
                    : []

    const seen = new Set()
    const result = []
    for (const item of raw) {
        const object = typeof item === 'string' ? { name: item } : item
        if (!object || typeof object !== 'object') continue
        const name = typeof object.name === 'string' ? object.name.trim() : ''
        const latin = typeof object.latin === 'string' ? object.latin.trim() : ''
        const species = typeof object.species === 'string' ? object.species.trim() : ''
        const label = name || latin || species
        if (!label) continue
        const key = label.toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        const guideMatch = matchGuidePlants(label, 1)[0] ?? matchGuidePlants(species, 1)[0] ?? null
        result.push({
            name: label,
            latin: latin || guideMatch?.latin || '',
            species: species || guideMatch?.species || latin || label,
            guide: guideMatch
        })
        if (result.length >= 3) break
    }
    return result
}

export async function suggestSpeciesFromPhoto(file) {
    if (!file) throw new Error('Файл не выбран')
    const formData = new FormData()
    formData.append('photo', file)
    const response = await fetchWithTimeout(
        `${API_URL}/plants/suggest-species-photo`,
        { method: 'POST', body: formData, credentials: 'include' },
        PLANTS_EXTRA_TIMEOUT_MS
    )
    const data = await readJson(response)
    if (!response.ok) {
        if (isUnavailableStatus(response.status)) {
            throw new PlantFeatureUnavailableError('Подбор вида по фото пока недоступен', { status: response.status })
        }
        throw new Error(data?.message || 'Не удалось подобрать вид по фото')
    }
    return normalizeSpeciesSuggestion(data)
}

export function clearHealthChecks() {
    const storage = getStorage()
    if (!storage) return
    try {
        storage.removeItem(HEALTH_CHECKS_STORAGE_KEY)
    } catch {
        return
    }
}
