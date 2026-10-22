import { QueryTypes } from 'sequelize'
import sequelize from '../db.js'
import {
    TIMEZONE,
    deviceFromUserAgent,
    parseReferrerHost,
    parseVisitPath,
    parseVisitorId
} from '../utils/adminAnalytics.js'
import { hasSiteVisitUtm } from '../utils/adminSchema.js'
import { parseUtm } from '../utils/utm.js'

let utmColumnsTrackedPromise = null

function isUtmColumnsTracked() {
    utmColumnsTrackedPromise ??= hasSiteVisitUtm()
    return utmColumnsTrackedPromise
}

const LEGACY_UPSERT = `
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
`

const UTM_UPSERT = `
    INSERT INTO site_visit_days (
        visitor_id, day, user_id, views, first_path, referrer_host, device,
        utm_source, utm_medium, utm_campaign,
        created_at, updated_at
    )
    VALUES (
        $1,
        (now() AT TIME ZONE '${TIMEZONE}')::date,
        $2, 1, $3, $4, $5,
        $6, $7, $8,
        now(), now()
    )
    ON CONFLICT (visitor_id, day) DO UPDATE
    SET views = site_visit_days.views + 1,
        updated_at = now(),
        user_id = COALESCE(EXCLUDED.user_id, site_visit_days.user_id),
        device = COALESCE(site_visit_days.device, EXCLUDED.device),
        utm_source = COALESCE(EXCLUDED.utm_source, site_visit_days.utm_source),
        utm_medium = COALESCE(EXCLUDED.utm_medium, site_visit_days.utm_medium),
        utm_campaign = COALESCE(EXCLUDED.utm_campaign, site_visit_days.utm_campaign)
    RETURNING id, views
`

class VisitController {
    async track(req, res) {
        try {
            const visitorId = parseVisitorId(req.body?.visitorId)
            const path = parseVisitPath(req.body?.path)

            if (!visitorId || !path) {
                return res.status(400).json({ counted: false })
            }

            const utm = parseUtm(req.body?.utm)
            const baseBinds = [
                visitorId,
                req.user?.id ?? null,
                path,
                parseReferrerHost(req.get('referer')),
                deviceFromUserAgent(req.get('user-agent'))
            ]

            const utmTracked = await isUtmColumnsTracked()
            const sql = utmTracked ? UTM_UPSERT : LEGACY_UPSERT
            const binds = utmTracked
                ? [...baseBinds, utm.source, utm.medium, utm.campaign]
                : baseBinds

            const rows = await sequelize.query(sql, {
                bind: binds,
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
