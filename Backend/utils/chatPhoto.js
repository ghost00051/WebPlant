import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { loadSharp } from './plantPhotoThumb.js'

export const CHAT_PHOTO_DIRECTORY = path.resolve('uploads', 'chat')
export const CHAT_PHOTO_MAX_SIDE = 1280
export const CHAT_PHOTO_QUALITY = 80
export const MAX_CHAT_PHOTOS = 5

const CHAT_PHOTO_FILENAME = /^[0-9a-f]{32}\.jpg$/i

export async function saveChatPhoto(imageBuffer) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
        const error = new Error('Фото не получено')
        error.code = 'CHAT_PHOTO_EMPTY'
        throw error
    }

    const sharp = await loadSharp()
    if (!sharp) {
        const error = new Error('Обработка изображений недоступна')
        error.code = 'CHAT_PHOTO_UNAVAILABLE'
        throw error
    }

    let prepared
    try {
        prepared = await sharp(imageBuffer, { failOn: 'none' })
            .rotate()
            .resize({
                width: CHAT_PHOTO_MAX_SIDE,
                height: CHAT_PHOTO_MAX_SIDE,
                fit: 'inside',
                withoutEnlargement: true
            })
            .jpeg({ quality: CHAT_PHOTO_QUALITY, mozjpeg: true })
            .toBuffer()
    } catch {
        const error = new Error('Не удалось прочитать изображение')
        error.code = 'CHAT_PHOTO_UNSUPPORTED'
        throw error
    }

    const filename = `${crypto.randomBytes(16).toString('hex')}.jpg`
    await mkdir(CHAT_PHOTO_DIRECTORY, { recursive: true })
    await writeFile(path.join(CHAT_PHOTO_DIRECTORY, filename), prepared)

    return { filename, bytes: prepared.length }
}

export function chatPhotoUrl(baseUrl, filename) {
    return `${baseUrl}/uploads/chat/${filename}`
}

export function chatPhotoFilenameFromUrl(url) {
    if (typeof url !== 'string' || !url) return null
    const match = /\/uploads\/chat\/([0-9a-f]{32}\.jpg)(?:[?#].*)?$/i.exec(url)
    if (!match || !CHAT_PHOTO_FILENAME.test(match[1])) return null
    return match[1]
}

export async function readChatPhoto(filename) {
    if (typeof filename !== 'string' || !CHAT_PHOTO_FILENAME.test(filename)) return null
    try {
        return await readFile(path.join(CHAT_PHOTO_DIRECTORY, filename))
    } catch {
        return null
    }
}
