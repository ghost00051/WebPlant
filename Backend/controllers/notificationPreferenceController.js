import NotificationPreference from '../models/NotificationPreference.js'

class NotificationPreferenceController {
    async get(req, res) {
        try {
            const preference = await NotificationPreference.findOne({
                where: { user_id: req.user.id }
            })

            return res.json({
                morning_summary_enabled: preference?.morning_summary_enabled ?? false,
                dark_theme_enabled: preference?.dark_theme_enabled ?? false,
                theme_mode: preference?.theme_mode ??
                    (preference ? (preference.dark_theme_enabled ? 'dark' : 'light') : 'system')
            })
        } catch (error) {
            console.error('❌ Ошибка получения настроек уведомлений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async update(req, res) {
        try {
            const updates = {}
            for (const key of ['morning_summary_enabled', 'dark_theme_enabled']) {
                if (Object.hasOwn(req.body || {}, key)) {
                    if (typeof req.body[key] !== 'boolean') {
                        return res.status(400).json({
                            message: `${key} должно быть логическим значением`
                        })
                    }
                    updates[key] = req.body[key]
                }
            }
            if (
                Object.hasOwn(updates, 'dark_theme_enabled') &&
                !Object.hasOwn(req.body || {}, 'theme_mode')
            ) {
                updates.theme_mode = updates.dark_theme_enabled ? 'dark' : 'light'
            }
            if (Object.hasOwn(req.body || {}, 'theme_mode')) {
                if (!['system', 'light', 'dark'].includes(req.body.theme_mode)) {
                    return res.status(400).json({
                        message: 'theme_mode должен быть system, light или dark'
                    })
                }
                updates.theme_mode = req.body.theme_mode
                updates.dark_theme_enabled = req.body.theme_mode === 'dark'
            }
            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    message: 'Необходимо передать настройку уведомлений'
                })
            }

            const [preference] = await NotificationPreference.findOrCreate({
                where: { user_id: req.user.id },
                defaults: updates
            })
            const changed = Object.entries(updates).some(
                ([key, value]) => preference[key] !== value
            )
            if (changed) {
                await preference.update(updates)
            }

            return res.json({
                morning_summary_enabled: preference.morning_summary_enabled,
                dark_theme_enabled: preference.dark_theme_enabled,
                theme_mode: preference.theme_mode ??
                    (preference.dark_theme_enabled ? 'dark' : 'light')
            })
        } catch (error) {
            console.error('❌ Ошибка сохранения настроек уведомлений:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new NotificationPreferenceController()
