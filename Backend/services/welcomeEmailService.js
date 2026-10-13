import User from '../models/userModels.js'
import { getFirstName } from '../utils/personName.js'
import { isMailConfigured, sendWelcomeEmail } from './mailService.js'

export async function sendWelcomeEmailToUser(user, { env = process.env, force = false } = {}) {
    if (!user) return { status: 'skipped', reason: 'no-user' }
    if (!isMailConfigured(env)) return { status: 'skipped', reason: 'mail-not-configured' }
    if (!force && user.welcome_email_sent_at) return { status: 'already-sent' }

    let claimed = false
    if (!force) {
        const [updated] = await User.update(
            { welcome_email_sent_at: new Date() },
            { where: { id: user.id, welcome_email_sent_at: null } }
        )
        if (!updated) return { status: 'already-sent' }
        claimed = true
    }

    try {
        await sendWelcomeEmail({
            to: user.email,
            userName: getFirstName(user.name),
            env
        })
        return { status: 'sent' }
    } catch (error) {
        if (claimed) {
            await User.update(
                { welcome_email_sent_at: null },
                { where: { id: user.id } }
            ).catch(() => {})
        }
        return { status: 'failed', error }
    }
}
