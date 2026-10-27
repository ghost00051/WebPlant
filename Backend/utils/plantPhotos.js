export const PLANT_PHOTO_NOTE_MAX_LENGTH = 500

export const PLANT_PHOTO_GALLERY_MAX = 200

export function isValidPhotoTakenAt(value) {
    if (value === undefined || value === null || value === '') return true
    if (typeof value !== 'string' || value.length > 64) return false
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return false
    const year = date.getUTCFullYear()
    return year >= 2000 && year <= 2100
}

export function isValidPhotoNote(value) {
    if (value === undefined || value === null) return true
    return typeof value === 'string' && value.length <= PLANT_PHOTO_NOTE_MAX_LENGTH
}

export function isValidPhotoInput(photo) {
    if (typeof photo === 'string') return Boolean(photo.trim()) && photo.length <= 2048
    if (!photo || typeof photo !== 'object' || Array.isArray(photo) ||
        typeof photo.url !== 'string' || !photo.url.trim() || photo.url.length > 2048) {
        return false
    }
    if (photo.sort_order !== undefined &&
        (!Number.isInteger(photo.sort_order) || photo.sort_order < 0)) {
        return false
    }
    if (photo.is_main !== undefined && typeof photo.is_main !== 'boolean') return false
    if (photo.metadata !== undefined &&
        (!photo.metadata || typeof photo.metadata !== 'object' || Array.isArray(photo.metadata))) {
        return false
    }
    if (!isValidPhotoTakenAt(photo.taken_at)) return false
    if (!isValidPhotoNote(photo.note)) return false
    return true
}

export function photoTakenAtOf(photo) {
    if (!photo || photo.taken_at === undefined || photo.taken_at === null || photo.taken_at === '') {
        return null
    }
    const date = new Date(photo.taken_at)
    return Number.isFinite(date.getTime()) ? date : null
}

export function photoNoteOf(photo) {
    if (!photo || typeof photo.note !== 'string') return null
    const note = photo.note.trim()
    return note ? note : null
}

export function buildPlantPhotoRow(photo, { plantId, index = 0, url }) {
    return {
        plant_id: plantId,
        url,
        sort_order: photo && typeof photo === 'object' && photo.sort_order != null
            ? photo.sort_order
            : index,
        is_main: photo && typeof photo === 'object' ? photo.is_main === true : index === 0,
        metadata: photo && typeof photo === 'object' && photo.metadata &&
            typeof photo.metadata === 'object' && !Array.isArray(photo.metadata)
            ? photo.metadata
            : {},
        taken_at: photoTakenAtOf(photo),
        note: photoNoteOf(photo)
    }
}

export function serializePlantPhoto(photo, { thumbUrl = null } = {}) {
    if (!photo || typeof photo !== 'object') return photo
    const source = typeof photo.toJSON === 'function' ? photo.toJSON() : photo
    return {
        ...source,
        thumb_url: thumbUrl
    }
}

export function sortPlantPhotosForGallery(photos = []) {
    const list = Array.isArray(photos) ? [...photos] : []
    const timeOf = photo => {
        const date = photo?.taken_at ?? photo?.takenAt ?? photo?.created_at ?? photo?.createdAt
        const parsed = date ? new Date(date) : null
        return parsed && Number.isFinite(parsed.getTime()) ? parsed.getTime() : null
    }
    const orderOf = photo => {
        const value = Number(photo?.sort_order)
        return Number.isInteger(value) ? value : 0
    }
    const idOf = photo => {
        const value = Number(photo?.id)
        return Number.isInteger(value) ? value : 0
    }

    return list.sort((left, right) => {
        const mainDiff = Number(right?.is_main === true) - Number(left?.is_main === true)
        if (mainDiff !== 0) return mainDiff

        const leftTime = timeOf(left)
        const rightTime = timeOf(right)
        if (leftTime !== rightTime) {
            if (leftTime === null) return 1
            if (rightTime === null) return -1
            return rightTime - leftTime
        }

        const orderDiff = orderOf(left) - orderOf(right)
        if (orderDiff !== 0) return orderDiff
        return idOf(left) - idOf(right)
    })
}

export function pickNextMainPhoto(photos = []) {
    const list = sortPlantPhotosForGallery(photos)
    return list.length ? list[0] : null
}

export default {
    PLANT_PHOTO_GALLERY_MAX,
    PLANT_PHOTO_NOTE_MAX_LENGTH,
    buildPlantPhotoRow,
    isValidPhotoInput,
    isValidPhotoNote,
    isValidPhotoTakenAt,
    photoNoteOf,
    photoTakenAtOf,
    pickNextMainPhoto,
    serializePlantPhoto,
    sortPlantPhotosForGallery
}
