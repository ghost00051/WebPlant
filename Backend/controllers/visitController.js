import { QueryTypes } from 'sequelize'
import sequelize from '../db.js'
import {
    TIMEZONE,
    deviceFromUserAgent,
    parseReferrerHost,
    parseVisitPath,
    parseVisitorId
} from '../utils/adminAnalytics.js'

class VisitController {
    async track(req, res) {
        try {
            const visitorId = parseVisitorId(req.body?.visitorId)
            const path = parseVisitPath(req.body?.path)

            if (!visitorId || !path) {
                return res.status(400).json({ counted: false })
            }

            const rows = await sequelize.query(`
                INSERT INTO site_visit_days (
                    visitor_id, day, user_id, views, first_path, referrer_host, device,
                    created_at, updated_at
                )
                VALUES (
                    $1,
                    (now() AT TIME ZONE '${TIMEZONE}')::date,
                    $2, 1, $3, $4, $5,
                    now(), now()
                )
                ON CONFLICT (visitor_id, day) DO UPDATE
                SET views = site_visit_days.views + 1,
                    updated_at = now(),
                    user_id = COALESCE(EXCLUDED.user_id, site_visit_days.user_id),
                    device = COALESCE(site_visit_days.device, EXCLUDED.device)
                RETURNING id, views
            `, {
                bind: [
                    visitorId,
                    req.user?.id ?? null,
                    path,
                    parseReferrerHost(req.get('referer')),
                    deviceFromUserAgent(req.get('user-agent'))
                ],
                type: QueryTypes.SELECT
            })

            return res.json({ counted: true, views: Number(rows?.[0]?.views) || 1 })
        } catch (error) {
            console.warn('⚠️ Не удалось записать посещение:', error?.message || error)
            return res.status(204).end()
        }
    }
}

export default new VisitController()
