import { mkdir, stat, unlink, rename } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

export const PLANT_PHOTO_DIRECTORY = path.resolve('uploads', 'plants')
export const PLANT_THUMB_DIRECTORY = path.resolve('uploads', 'thumbs')

export const PLANT_PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic']
export const PLANT_THUMB_SIZE = 160
export const PLANT_THUMB_QUALITY = 72

const PLANT_PHOTO_NAME = /^[a-f0-9]{32}\.(?:jpe?g|png|webp|heic)$/i
const PLANT_THUMB_NAME = /^[a-f0-9]{32}\.thumb\.jpg$/i

let sharpPromise = null

export function loadSharp() {
    if (!sharpPromise) {
        sharpPromise = import('sharp')
            .then(module => module.default ?? module)
            .catch(error => {
                console.warn(
                    '⚠️ sharp недоступен: миниатюры фото создаваться не будут',
                    error?.code || error?.message
                )
                return null
            })
    }
    return sharpPromise
}

export function plantPhotoFileName(url) {
    if (typeof url !== 'string' || !url) return null

    const [clean] = url.trim().split(/[?#]/, 1)
    const name = path.posix.basename(clean)

    return PLANT_PHOTO_NAME.test(name) ? name : null
}

export function plantThumbFileName(url) {
    const name = plantPhotoFileName(url)
    if (!name) return null

    return `${name.slice(0, name.lastIndexOf('.')).toLowerCase()}.thumb.jpg`
}

export function plantThumbPath(url, { directory = PLANT_THUMB_DIRECTORY } = {}) {
    const name = plantThumbFileName(url)
    return name ? path.join(directory, name) : null
}

export function plantThumbUrl(url) {
    if (typeof url !== 'string' || !url) return null

    const name = plantPhotoFileName(url)
    if (!name) return null

    const thumbName = plantThumbFileName(url)
    const [clean] = url.trim().split(/[?#]/, 1)
    const plantPathIndex = clean.lastIndexOf('/uploads/plants/')
    if (plantPathIndex === -1) return null

    return `${clean.slice(0, plantPathIndex)}/uploads/thumbs/${thumbName}`
}

async function fileExists(filePath) {
    try {
        const stats = await stat(filePath)
        return stats.isFile()
    } catch {
        return false
    }
}

export async function findPlantPhotoFile(url, { directory = PLANT_PHOTO_DIRECTORY } = {}) {
    const name = plantPhotoFileName(url)
    if (!name) return null

    const base = name.slice(0, name.lastIndexOf('.')).toLowerCase()

    if (await fileExists(path.join(directory, name))) {
        return path.join(directory, name)
    }

    for (const extension of PLANT_PHOTO_EXTENSIONS) {
        const candidate = path.join(directory, `${base}.${extension}`)
        if (await fileExists(candidate)) return candidate
    }

    return null
}

export async function createPlantPhotoThumb(sourcePath, {
    directory = PLANT_THUMB_DIRECTORY,
    size = PLANT_THUMB_SIZE,
    quality = PLANT_THUMB_QUALITY
} = {}) {
    const thumbnailName = `${path.basename(sourcePath, path.extname(sourcePath)).toLowerCase()}.thumb.jpg`
    if (!PLANT_THUMB_NAME.test(thumbnailName)) {
        return { ok: false, reason: 'unknown-source-name' }
    }

    const sharp = await loadSharp()
    if (!sharp) return { ok: false, reason: 'sharp-unavailable' }

    const targetPath = path.join(directory, thumbnailName)
    const tempPath = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`

    try {
        await mkdir(directory, { recursive: true })
        await sharp(sourcePath, { failOn: 'none', limitInputPixels: 50_000_000 })
            .rotate()
            .resize(size, size, { fit: 'cover', position: 'centre', withoutEnlargement: true })
            .jpeg({ quality, mozjpeg: true })
            .toFile(tempPath)
        await rename(tempPath, targetPath)
        return { ok: true, path: targetPath, name: thumbnailName }
    } catch (error) {
        await unlink(tempPath).catch(() => {})
        return { ok: false, reason: error?.message || String(error) }
    }
}

export async function ensurePlantPhotoThumb(sourcePath, { directory, force = false } = {}) {
    const thumbnailName = `${path.basename(sourcePath, path.extname(sourcePath)).toLowerCase()}.thumb.jpg`
    const targetDirectory = directory ?? PLANT_THUMB_DIRECTORY
    const targetPath = path.join(targetDirectory, thumbnailName)

    if (!force && await fileExists(targetPath)) {
        return { ok: true, path: targetPath, name: thumbnailName, skipped: true }
    }

    return createPlantPhotoThumb(sourcePath, { directory: targetDirectory })
}

export function plantThumbRequestHandler({
    photoDirectory = PLANT_PHOTO_DIRECTORY,
    thumbDirectory = PLANT_THUMB_DIRECTORY
} = {}) {
    return async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()

        const requestedName = path.posix.basename(req.path)
        if (!PLANT_THUMB_NAME.test(requestedName)) return next()

        const thumbPath = path.join(thumbDirectory, requestedName)
        if (await fileExists(thumbPath)) return next()

        const base = requestedName.replace(/\.thumb\.jpg$/i, '')
        const sourcePath = await findPlantPhotoFile(`/uploads/plants/${base}.jpg`, {
            directory: photoDirectory
        })

        if (sourcePath) {
            const result = await createPlantPhotoThumb(sourcePath, { directory: thumbDirectory })
            if (!result.ok) {
                console.warn(`⚠️ Не удалось создать миниатюру для ${path.basename(sourcePath)}:`, result.reason)
            }
        }

        return next()
    }
}
