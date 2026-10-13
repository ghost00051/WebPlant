import { mkdir, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import {
    createPlantPhotoThumb,
    ensurePlantPhotoThumb,
    loadSharp,
    PLANT_PHOTO_DIRECTORY,
    PLANT_THUMB_DIRECTORY
} from '../utils/plantPhotoThumb.js'

const PHOTO_FILE = /^[a-f0-9]{32}\.(?:jpe?g|png|webp|heic)$/i

function parseArgs(argv) {
    const options = {
        directory: PLANT_PHOTO_DIRECTORY,
        thumbDirectory: PLANT_THUMB_DIRECTORY,
        force: false,
        dryRun: false
    }

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index]
        if (arg === '--force') options.force = true
        else if (arg === '--dry-run') options.dryRun = true
        else if (arg === '--dir') options.directory = path.resolve(argv[++index])
        else if (arg === '--thumbs') options.thumbDirectory = path.resolve(argv[++index])
        else if (arg === '--help' || arg === '-h') options.help = true
        else {
            console.error(`Неизвестный параметр: ${arg}`)
            options.help = true
        }
    }

    return options
}

function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)} КБ`
}

async function fileSize(filePath) {
    try {
        return (await stat(filePath)).size
    } catch {
        return 0
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2))

    if (options.help) {
        console.log('Использование: node scripts/generate-plant-thumbs.mjs [--force] [--dry-run] [--dir <путь>] [--thumbs <путь>]')
        return
    }

    if (!await loadSharp()) {
        console.error('❌ sharp недоступен: установите зависимость (npm install sharp), иначе миниатюры не создаются.')
        process.exitCode = 1
        return
    }

    let entries
    try {
        entries = await readdir(options.directory, { withFileTypes: true })
    } catch (error) {
        console.error(`❌ Не удалось прочитать каталог ${options.directory}:`, error.message)
        process.exitCode = 1
        return
    }

    const photos = entries
        .filter(entry => entry.isFile() && PHOTO_FILE.test(entry.name))
        .map(entry => entry.name)
        .sort()

    if (!options.dryRun) {
        await mkdir(options.thumbDirectory, { recursive: true })
    }

    let created = 0
    let skipped = 0
    let failed = 0
    let originalBytes = 0
    let thumbBytes = 0

    for (const name of photos) {
        const sourcePath = path.join(options.directory, name)
        const thumbnailName = `${name.slice(0, name.lastIndexOf('.')).toLowerCase()}.thumb.jpg`
        const targetPath = path.join(options.thumbDirectory, thumbnailName)
        const originalSize = await fileSize(sourcePath)
        originalBytes += originalSize

        const existing = await fileSize(targetPath)
        if (existing > 0 && !options.force) {
            thumbBytes += existing
            skipped++
            continue
        }

        if (options.dryRun) {
            console.log(`• ${name} → ${thumbnailName} (${formatKb(originalSize)})`)
            continue
        }

        const result = options.force
            ? await createPlantPhotoThumb(sourcePath, { directory: options.thumbDirectory })
            : await ensurePlantPhotoThumb(sourcePath, { directory: options.thumbDirectory })
        if (!result.ok) {
            failed++
            console.error(`✖ ${name}: ${result.reason}`)
            continue
        }

        const thumbnailSize = await fileSize(targetPath)
        thumbBytes += thumbnailSize
        created++
        console.log(`✔ ${name}: ${formatKb(originalSize)} → ${formatKb(thumbnailSize)}`)
    }

    console.log('')
    console.log(`Всего фото: ${photos.length}`)
    console.log(`Создано миниатюр: ${created}`)
    console.log(`Уже были: ${skipped}`)
    console.log(`Ошибок: ${failed}`)
    if (!options.dryRun && thumbBytes > 0) {
        console.log(`Размер оригиналов: ${formatKb(originalBytes)} → миниатюр: ${formatKb(thumbBytes)}`)
    }

    if (failed > 0) process.exitCode = 1
}

await main()
