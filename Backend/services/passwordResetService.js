import bcrypt from 'bcrypt'
import { Op } from 'sequelize'
import sequelize from '../db.js'
import User from '../models/userModels.js'
import AuthSession from '../models/AuthSession.js'
import PasswordResetToken from '../models/PasswordResetToken.js'
import { normalizeEmail } from '../utils/validation.js'
import {
    RESET_MAX_REQUESTS_PER_HOUR,
    RESET_TOKEN_TTL_MS,
    buildResetUrl,
    generateResetToken,
    hashResetToken,
    isResetRequestTooSoon,
    isResetTokenUsable,
    isValidResetPassword,
    isValidResetTokenFormat
} from '../utils/passwordReset.js'
import { sendPasswordResetEmail } from './mailService.js'

const BCRYPT_ROUNDS = 10
const REQUEST_WINDOW_MS = 60 * 60 * 1000
const USER_AGENT_MAX_LENGTH = 500

export async function findUserByEmail(email, { transaction } = {}) {
    return User.findOne({
        where: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('email')),
            normalizeEmail(email)
        ),
        transaction
    })
}

async function countRecentRequests(userId, since) {
    const [count, lastCreatedAt] = await Promise.all([
        PasswordResetToken.count({
            where: { user_id: userId, created_at: { [Op.gte]: since } }
        }),
        PasswordResetToken.max('created_at', { where: { user_id: userId } })
    ])
    return { count, lastCreatedAt: lastCreatedAt || null }
}

async function invalidateUserTokens(userId, { transaction } = {}) {
    return PasswordResetToken.update(
        { used_at: new Date() },
        { where: { user_id: userId, used_at: null }, transaction }
    )
}

export async function requestPasswordReset({
    email,
    ip = null,
    userAgent = '',
    frontendUrl = process.env.FRONTEND_URL,
    env = process.env
}) {
    const user = await findUserByEmail(email)
    if (!user) return { status: 'unknown' }

    const since = new Date(Date.now() - REQUEST_WINDOW_MS)
    const { count, lastCreatedAt } = await countRecentRequests(user.id, since)
    if (count >= RESET_MAX_REQUESTS_PER_HOUR || isResetRequestTooSoon(lastCreatedAt)) {
        return { status: 'throttled', user }
    }

    const token = generateResetToken()
    const tokenHash = hashResetToken(token)
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS)

    await sequelize.transaction(async transaction => {
        await invalidateUserTokens(user.id, { transaction })
        await PasswordResetToken.create({
            user_id: user.id,
            token_hash: tokenHash,
            expires_at: expiresAt,
            requested_ip: ip ? String(ip).slice(0, 64) : null,
            user_agent: userAgent ? String(userAgent).slice(0, USER_AGENT_MAX_LENGTH) : null
        }, { transaction })
    })

    const resetUrl = buildResetUrl(token, frontendUrl)
    const recipientName = typeof user.name === 'string' ? user.name.trim().split(/\s+/)[0] : ''

    try {
        await sendPasswordResetEmail({
            to: user.email,
            resetUrl,
            userName: recipientName,
            env
        })
        return { status: 'sent', user }
    } catch (error) {
        await PasswordResetToken.update(
            { used_at: new Date() },
            { where: { token_hash: tokenHash, used_at: null } }
        ).catch(() => {})
        return { status: 'failed', user, error }
    }
}

export async function inspectPasswordResetToken(token) {
    if (!isValidResetTokenFormat(token)) return null

    const record = await PasswordResetToken.findOne({
        where: { token_hash: hashResetToken(token) },
        include: [{ model: User, as: 'user', attributes: ['id', 'email', 'name'] }]
    })
    if (!isResetTokenUsable(record)) return null

    return {
        userId: record.user_id,
        email: record.user?.email || '',
        name: record.user?.name || ''
    }
}

export async function confirmPasswordReset({ token, password }) {
    if (!isValidResetTokenFormat(token) || !isValidResetPassword(password)) {
        return { status: 'invalid' }
    }

    const tokenHash = hashResetToken(token)

    return sequelize.transaction(async transaction => {
        const record = await PasswordResetToken.findOne({
            where: {
                token_hash: tokenHash,
                used_at: null,
                expires_at: { [Op.gt]: new Date() }
            },
            transaction,
            lock: transaction.LOCK.UPDATE
        })
        if (!record) return { status: 'invalid' }

        const user = await User.findByPk(record.user_id, { transaction })
        if (!user) return { status: 'invalid' }

        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
        const now = new Date()

        await record.update({ used_at: now }, { transaction })
        await user.update({ password: passwordHash }, { transaction })
        await AuthSession.update(
            { revoked_at: now },
            { where: { user_id: user.id, revoked_at: null }, transaction }
        )
        await invalidateUserTokens(user.id, { transaction })

        return { status: 'updated', user }
    })
}
