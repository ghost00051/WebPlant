import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { open, rename, unlink } from 'fs/promises'
import crypto from 'crypto'

const UPLOAD_DIR = path.resolve('uploads', 'plants')

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        cb(null, crypto.randomBytes(16).toString('hex') + '.upload')
    }
})

const getImageExtension = async filePath => {
    const file = await open(filePath, 'r')
    try {
        const header = Buffer.alloc(12)
        const { bytesRead } = await file.read(header, 0, header.length, 0)
        const data = header.subarray(0, bytesRead)

        if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
            return '.jpg'
        }
        if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
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
    } finally {
        await file.close()
    }
}

async function removeUploadedFiles(files) {
    await Promise.all(files.map(file => unlink(file.path).catch(error => {
        if (error.code !== 'ENOENT') throw error
    })))
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
            const filename = crypto.randomBytes(16).toString('hex') + extensions[index]
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
        fileSize: 5 * 1024 * 1024, 
        files: 2                    
    }
})