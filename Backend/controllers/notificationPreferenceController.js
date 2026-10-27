import NotificationPreference from '../models/NotificationPreference.js'
import { resolveTimeZone } from '../utils/timeZone.js'
import {
    DEFAULT_QUIET_HOURS_END,
    DEFAULT_QUIET_HOURS_START,
    isValidClockTime,
    isValidDeliveryMode,
    parseClockMinutes,
    resolveDeliveryMode
} from '../utils/quietHours.js'

export const DEFAULT_MODELS = Object.freeze({
    NotificationPreference
})

const BOOLEAN_KEYS = [
    'morning_summary_enabled',
    'care_advice_enabled',
    'weekly_recap_enabled',
    'dark_theme_enabled',
    'quiet_hours_enabled'
]

const READ_ONLY_KEYS = ['quiet_hours_timezone']

function readClockTime(value, fallback) {
    return isValidClockTime(value) ? value.trim() : fallback
}

export function serializeNotificationPreferences(preference, { timeZone } = {}) {
    const source = preference && typeof preference.toJSON === 'function'
        ? preference.toJSON()
        : (preference || {})

    return {
        morning_summary_enabled: source.morning_summary_enabled === true,
        care_advice_enabled: source.care_advice_enabled !== false,
        weekly_recap_enabled: source.weekly_recap_enabled !== false,
        dark_theme_enabled: source.dark_theme_enabled === true,
        theme_mode: ['system', 'light', 'dark'].includes(source.theme_mode)
            ? source.theme_mode
            : (source.dark_theme_enabled ? 'dark' : 'system'),
        delivery_mode: resolveDeliveryMode(source.delivery_mode),
        quiet_hours_enabled: source.quiet_hours_enabled === true,
        quiet_hours_start: readClockTime(source.quiet_hours_start, DEFAULT_QUIET_HOURS_START),
        quiet_hours_end: readClockTime(source.quiet_hours_end, DEFAULT_QUIET_HOURS_END),
        quiet_hours_timezone: resolveTimeZone(timeZone)
    }
}

export class NotificationPreferenceController {
    constructor(deps = {}) {
        this.models = { ...DEFAULT_MODELS, ...(deps.models || {}) }
        this.get = this.get.bind(this)
        this.update = this.update.bind(this)
    }

    async get(req, res) {
        const userId = Number(req.user?.id)
        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(401).json({ message: 'Не авторизован' })
        }

        try {
            const preference = await this.models.NotificationPreference.findOne({
                where: { user_id: userId }
            })

            return res.json(serializeNotificationPreferences(preference, {
                timeZone: req.user?.timezone
            }))
        } catch (error) {
            console.error('❌ Ошибка получения настроек уведомлений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async update(req, res) {
        const userId = Number(req.user?.id)
        if (!Number.isInteger(userId) || userId < 1) {
            return res.status(401).json({ message: 'Не авторизован' })
        }

        try {
            const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
                ? req.body
                : {}
            const updates = {}

            for (const key of READ_ONLY_KEYS) {
                if (Object.hasOwn(body, key)) {
                    return res.status(400).json({
                        message: `${key} вычисляется по часовому поясу пользователя и не изменяется`
                    })
                }
            }

            for (const key of BOOLEAN_KEYS) {
                if (!Object.hasOwn(body, key)) continue
                if (typeof body[key] !== 'boolean') {
                    return res.status(400).json({
                        message: `${key} должно быть логическим значением`
                    })
                }
                updates[key] = body[key]
            }

            if (Object.hasOwn(body, 'delivery_mode')) {
                if (!isValidDeliveryMode(body.delivery_mode)) {
                    return res.status(400).json({
                        message: 'delivery_mode должен быть digest или per_plant'
                    })
                }
                updates.delivery_mode = body.delivery_mode
            }

            for (const key of ['quiet_hours_start', 'quiet_hours_end']) {
                if (!Object.hasOwn(body, key)) continue
                if (!isValidClockTime(body[key])) {
                    return res.status(400).json({
                        message: `${key} должен быть временем в формате HH:MM`
                    })
                }
                updates[key] = body[key].trim()
            }

            if (
                Object.hasOwn(updates, 'dark_theme_enabled') &&
                !Object.hasOwn(body, 'theme_mode')
            ) {
                updates.theme_mode = updates.dark_theme_enabled ? 'dark' : 'light'
            }
            if (Object.hasOwn(body, 'theme_mode')) {
                if (!['system', 'light', 'dark'].includes(body.theme_mode)) {
                    return res.status(400).json({
                        message: 'theme_mode должен быть system, light или dark'
                    })
                }
                updates.theme_mode = body.theme_mode
                updates.dark_theme_enabled = body.theme_mode === 'dark'
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    message: 'Необходимо передать настройку уведомлений'
                })
            }

            const [preference] = await this.models.NotificationPreference.findOrCreate({
                where: { user_id: userId },
                defaults: updates
            })

            const nextStart = Object.hasOwn(updates, 'quiet_hours_start')
                ? updates.quiet_hours_start
                : readClockTime(preference.quiet_hours_start, DEFAULT_QUIET_HOURS_START)
            const nextEnd = Object.hasOwn(updates, 'quiet_hours_end')
                ? updates.quiet_hours_end
                : readClockTime(preference.quiet_hours_end, DEFAULT_QUIET_HOURS_END)
            if (parseClockMinutes(nextStart) === parseClockMinutes(nextEnd)) {
                return res.status(400).json({
                    message: 'Начало и конец тихих часов не должны совпадать'
                })
            }

            const changed = Object.entries(updates).some(
                ([key, value]) => preference[key] !== value
            )
            if (changed && typeof preference.update === 'function') {
                await preference.update(updates)
            }

            return res.json(serializeNotificationPreferences(preference, {
                timeZone: req.user?.timezone
            }))
        } catch (error) {
            console.error('❌ Ошибка сохранения настроек уведомлений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new NotificationPreferenceController()
