import {
    createOrGetShare,
    getPublicGarden,
    getShareStatus,
    revokeShare,
    PUBLIC_GARDEN_NOT_FOUND
} from '../services/gardenShareService.js'

const NO_STORE = 'no-store'

function noStore(res) {
    res.set('Cache-Control', NO_STORE)
}

class GardenShareController {
    async create(req, res) {
        try {
            const share = await createOrGetShare(req.user.id)
            noStore(res)
            return res.json({ share })
        } catch (error) {
            console.error('❌ Не удалось создать ссылку на сад:', error)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }

    async status(req, res) {
        try {
            const share = await getShareStatus(req.user.id)
            noStore(res)
            return res.json({ share })
        } catch (error) {
            console.error('❌ Не удалось получить ссылку на сад:', error)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }

    async revoke(req, res) {
        try {
            await revokeShare(req.user.id)
            noStore(res)
            return res.json({ share: null, revoked: true })
        } catch (error) {
            console.error('❌ Не удалось отозвать ссылку на сад:', error)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }

    async getPublic(req, res) {
        try {
            const garden = await getPublicGarden(req.params?.token, {
                viewerUserId: req.user?.id ?? null,
                ip: req.ip,
                userAgent: req.headers?.['user-agent'] || null
            })
            noStore(res)
            if (!garden) {
                return res.status(404).json({ message: PUBLIC_GARDEN_NOT_FOUND })
            }
            return res.json({ garden })
        } catch (error) {
            console.error('❌ Не удалось показать публичный сад:', error)
            return res.status(500).json({ message: 'Внутренняя ошибка сервера' })
        }
    }
}

export default new GardenShareController()
