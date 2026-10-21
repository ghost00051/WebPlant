import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { open, rename, unlink, writeFile } from 'fs/promises'
import crypto from 'crypto'
import sharp from 'sharp'
import { MAX_CHAT_PHOTOS } from '../utils/chatPhoto.js'

export { MAX_CHAT_PHOTOS }

const UPLOAD_DIR = path.resolve('uploads', 'plants')

const MAX_INPUT_PIXELS = 50_000_000

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
    }
})

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

export function detectImageExtension(data) {
    if (!data || data.length < 3) return null
    if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
        return '.jpg'
    }
    if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        return '.png'
    }
    if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') {
        return '.webp'
    }
    if (
        data.length >= 12 &&
        data.toString('ascii', 4, 8) === 'ftyp' &&
        ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(data.toString('ascii', 8, 12))
    ) {
        return '.heic'
    }
    return null
}

const getImageExtension = async filePath => {
    const file = await open(filePath, 'r')
    try {
        const header = Buffer.alloc(12)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        return detectImageExtension(header.subarray(0, bytesRead))
    } finally {
        await file.close()
    }
}

async function removeUploadedFiles(files) {
    await Promise.all(files.map(file => unlink(file.path).catch(error => {
        if (error.code !== 'ENOENT') throw error
    })))
}

async function normalizeImageFile(filePath, extension) {
    try {
        const image = sharp(filePath, {
            failOn: 'none',
            limitInputPixels: MAX_INPUT_PIXELS
        })
        await image.metadata()

        if (extension === '.jpg') {
            await writeFile(filePath, await image.rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer())
        } else if (extension === '.png') {
            await writeFile(filePath, await image.rotate().png({ compressionLevel: 9 }).toBuffer())
        } else if (extension === '.webp') {
            await writeFile(filePath, await image.rotate().webp({ quality: 90 }).toBuffer())
        } else if (extension === '.heic') {
            await writeFile(filePath, await image.rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer())
            return '.jpg'
        }
        return extension
    } catch (error) {
        if (extension === '.heic') {
            console.warn('⚠️ HEIC не удалось перекодировать, файл сохранён как есть:', error?.message || error)
            return extension
        }
        throw error
    }
}

export async function validatePlantPhotos(req, res, next) {
    const files = req.files || []
    try {
        const extensions = await Promise.all(files.map(file => getImageExtension(file.path)))
        if (extensions.some(extension => !extension)) {
            await removeUploadedFiles(files)
            return res.status(400).json({ message: 'Допустимы только изображения JPEG, PNG, WebP и HEIC' })
        }

        for (let index = 0; index < files.length; index++) {
            let extension
            try {
                extension = await normalizeImageFile(files[index].path, extensions[index])
            } catch (error) {
                await removeUploadedFiles(files)
                return res.status(400).json({ message: 'Не удалось обработать изображение' })
            }

            const filename = crypto.randomBytes(16).toString('hex') + extension
            const newPath = path.join(UPLOAD_DIR, filename)
            await rename(files[index].path, newPath)
            files[index].filename = filename
            files[index].path = newPath
        }
        return next()
    } catch (error) {
        await removeUploadedFiles(files)
        return next(error)
    }
}

export const uploadPlantPhotos = multer({
    storage,
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: 2
    }
})

export const uploadChatPhoto = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_UPLOAD_BYTES,
        files: MAX_CHAT_PHOTOS
    }
})

export function validateChatPhoto(req, res, next) {
    const files = Array.isArray(req.files)
        ? req.files
        : (req.file ? [req.file] : [])

    if (!files.length) {
        return res.status(400).json({ message: 'Фото не загружено' })
    }
    if (files.length > MAX_CHAT_PHOTOS) {
        return res.status(400).json({ message: `Можно прикрепить не больше ${MAX_CHAT_PHOTOS} фото` })
    }

    for (const file of files) {
        const extension = detectImageExtension(file.buffer)
        if (!extension) {
            return res.status(400).json({ message: 'Допустимы только изображения JPEG, PNG, WebP и HEIC' })
        }
        file.detectedExtension = extension
    }

    req.files = files
    return next()
}
