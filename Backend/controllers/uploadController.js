class UploadController {
    async uploadPlantPhotos(req, res) {
        try {
            if (!req.files || !req.files.length) {
                return res.status(400).json({ message: 'Файлы не загружены' })
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`

            const urls = req.files.map(file => {
                const relative = '/uploads/plants/' + file.filename
                return baseUrl + relative
            })

            return res.status(201).json({ urls })
        } catch (error) {
            console.error('❌ Ошибка загрузки:', error)
            return res.status(500).json({ message: 'Ошибка загрузки' })
        }
    }
}

export default new UploadController()