import { createPlantPhotoThumb, plantThumbUrl } from '../utils/plantPhotoThumb.js'

class UploadController {
    async uploadPlantPhotos(req, res) {
        try {
            if (!req.files || !req.files.length) {
                return res.status(400).json({ message: 'Файлы не загружены' })
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`

            const uploaded = await Promise.all(req.files.map(async file => {
                const url = `${baseUrl}/uploads/plants/${file.filename}`
                const thumbnail = await createPlantPhotoThumb(file.path)

                return {
                    url,
                    thumbUrl: thumbnail.ok ? plantThumbUrl(url) : null
                }
            }))

            return res.status(201).json({
                urls: uploaded.map(item => item.url),
                thumbs: uploaded.map(item => item.thumbUrl)
            })
        } catch (error) {
            console.error('❌ Ошибка загрузки:', error)
            return res.status(500).json({ message: 'Ошибка загрузки' })
        }
    }
}

export default new UploadController()
