import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import {
    PLANT_THUMB_DIRECTORY,
    plantThumbFileName,
    plantThumbPath
} from './plantPhotoThumb.js'

const PLANT_PHOTO_FILE = /^[a-f0-9]{32}\.(?:upload|jpg|png|webp|heic)$/
const PLANT_THUMB_FILE = /^[a-f0-9]{32}\.thumb\.jpg$/

export function plantPhotoFileName(url) {
    if (typeof url !== 'string' || !url) return null
    try {
        const pathname = url.startsWith('/uploads/plants/')
            ? url.split(/[?#]/, 1)[0]
            : new URL(url).pathname
        const name = path.posix.basename(pathname)
        return PLANT_PHOTO_FILE.test(name) ? name : null
    } catch {
        return null
    }
}

export async function removePlantPhotoFiles(urls, {
    directory = path.resolve('uploads', 'plants'),
    thumbDirectory = PLANT_THUMB_DIRECTORY
} = {}) {
    const list = Array.isArray(urls) ? urls : [urls]
    let removed = 0

    for (const url of list) {
        const name = plantPhotoFileName(url)
        if (!name) continue
        try {
            await unlink(path.join(directory, name))
            removed++
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn(`⚠️ Не удалось удалить фото растения ${name}:`, error?.code || error)
            }
        }

        const thumbnailPath = plantThumbPath(url, { directory: thumbDirectory })
        if (thumbnailPath) {
            await unlink(thumbnailPath).catch(() => {})
        }
    }

    return removed
}

export async function cleanOrphanedPlantPhotoFiles({
    directory = path.resolve('uploads', 'plants'),
    thumbDirectory = PLANT_THUMB_DIRECTORY,
    referencedUrls,
    olderThan = Date.now() - 24 * 60 * 60 * 1000
}) {
    if (!Array.isArray(referencedUrls)) {
        throw new TypeError('referencedUrls must be an array')
    }

    const referencedFiles = new Set()
    for (const url of referencedUrls) {
        const name = plantPhotoFileName(url)
        if (name) referencedFiles.add(name)
    }

    const entries = await readdir(directory, { withFileTypes: true })
    let removed = 0

    for (const entry of entries) {
        if (!entry.isFile() || !PLANT_PHOTO_FILE.test(entry.name) ||
            referencedFiles.has(entry.name)) {
            continue
        }

        const filePath = path.join(directory, entry.name)
        const fileStats = await stat(filePath)
        if (fileStats.mtimeMs >= olderThan) continue

        await unlink(filePath)
        removed++
    }

    removed += await cleanOrphanedPlantPhotoThumbs({
        directory: thumbDirectory,
        referencedUrls,
        olderThan
    })

    return removed
}

export async function cleanOrphanedPlantPhotoThumbs({
    directory = PLANT_THUMB_DIRECTORY,
    referencedUrls,
    olderThan = Date.now() - 24 * 60 * 60 * 1000
}) {
    if (!Array.isArray(referencedUrls)) {
        throw new TypeError('referencedUrls must be an array')
    }

    const referencedThumbs = new Set()
    for (const url of referencedUrls) {
        const name = plantThumbFileName(url)
        if (name) referencedThumbs.add(name)
    }

    let entries
    try {
        entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
        if (error?.code === 'ENOENT') return 0
        throw error
    }

    let removed = 0

    for (const entry of entries) {
        if (!entry.isFile() || !PLANT_THUMB_FILE.test(entry.name) ||
            referencedThumbs.has(entry.name)) {
            continue
        }

        const filePath = path.join(directory, entry.name)
        const fileStats = await stat(filePath)
        if (fileStats.mtimeMs >= olderThan) continue

        await unlink(filePath)
        removed++
    }

    return removed
}
