import ProductEvent from '../models/ProductEvent.js'
import { parseEventsBody } from '../utils/eventValidation.js'
import { parseReferrerHost } from '../utils/adminAnalytics.js'

class EventController {
    async track(req, res) {
        const parsed = parseEventsBody(req.body)
        if (!parsed.ok) {
            return res.status(400).json({ message: parsed.message })
        }
        if (!parsed.events.length) {
            return res.status(202).json({ accepted: 0 })
        }

        const userId = req.user?.id ?? null
        const visitorId = parsed.visitorId
        const referrerHost = parseReferrerHost(req.get('referer'))

        try {
            await ProductEvent.bulkCreate(parsed.events.map(event => ({
                user_id: userId,
                visitor_id: visitorId,
                event: event.event,
                properties: event.props,
                path: event.path,
                referrer_host: referrerHost
            })))

            return res.status(202).json({ accepted: parsed.events.length })
        } catch (error) {
            console.error('❌ Не удалось сохранить продуктовые события:', error)
            return res.status(500).json({ message: 'Не удалось сохранить события' })
        }
    }
}

export default new EventController()
