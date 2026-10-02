import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import jwt from 'jsonwebtoken'
import { Op, UniqueConstraintError } from 'sequelize'
import dotenv from 'dotenv'
import sequelize from '../db.js'
import Passkey from '../models/Passkey.js'
import PasskeyChallenge from '../models/PasskeyChallenge.js'
import User from '../models/userModels.js'
import {
    revokeAuthTokens,
    setRememberedAuth,
    setSessionAuth
} from '../utils/authTokens.js'
import { getPasskeyConfig } from '../utils/passkeyConfig.js'
import { linkGuestDataToUser } from '../utils/linkGuestData.js'

dotenv.config()

const { rpId: RP_ID, frontendOrigins: FRONTEND_ORIGINS } = getPasskeyConfig()
const RP_NAME = process.env.RP_NAME || 'App'
const CHALLENGE_TTL_MS = 5 * 60 * 1000

function getUserId(req) {
    const token = req.cookies?.token
    if (!token) return null
    try {
        const decoded = jwt.verify(token, process.env.SECRET_KEY)
        return decoded.id
    } catch {
        return null
    }
}

function buildUserPayload(user) {
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        phone: user.phone,
        bio: user.bio,
        role: user.role,
        privilege_level: user.privilege_level
    }
}

async function saveChallenge({ userId, challenge, type, key }) {
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS)

    await PasskeyChallenge.destroy({ where: { expires_at: { [Op.lt]: new Date() } } })

    await PasskeyChallenge.create({
        user_id: userId ?? null,
        challenge,
        type,
        key,
        expires_at: expiresAt
    })
}

async function consumeChallenge(key, type, userId) {
    const where = {
        key,
        type,
        expires_at: { [Op.gt]: new Date() }
    }
    if (userId !== undefined) where.user_id = userId

    const row = await PasskeyChallenge.findOne({
        where
    })

    if (!row) return null

    const deletedCount = await PasskeyChallenge.destroy({
        where: {
            id: row.id,
            type,
            expires_at: { [Op.gt]: new Date() }
        }
    })
    if (!deletedCount) return null

    return row
}

function simpleDeviceName(userAgent) {
    if (!userAgent) return 'Устройство'
    const ua = userAgent.toLowerCase()

    if (ua.includes('iphone')) return 'iPhone'
    if (ua.includes('ipad')) return 'iPad'
    if (ua.includes('macintosh') || ua.includes('mac os')) return 'Mac'
    if (ua.includes('android')) {
        if (ua.includes('chrome')) return 'Android (Chrome)'
        return 'Android'
    }
    if (ua.includes('windows')) return 'Windows'
    if (ua.includes('linux')) return 'Linux'

    return 'Устройство'
}

class PasskeyController {
    async startRegistration(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const user = await User.findByPk(userId)
            if (!user) return res.status(404).json({ message: 'Пользователь не найден' })

            const existing = await Passkey.findAll({
                where: { user_id: userId },
                attributes: ['credential_id', 'transports']
            })

            const options = await generateRegistrationOptions({
                rpName: RP_NAME,
                rpID: RP_ID,
                userID: Buffer.from(String(user.id)),
                userName: user.email,
                userDisplayName: user.name || user.username || user.email,
                attestationType: 'none',
                excludeCredentials: existing.map(pk => ({
                    id: pk.credential_id,
                    transports: pk.transports || []
                })),
                authenticatorSelection: {
                    residentKey: 'preferred',
                    userVerification: 'preferred',
                    authenticatorAttachment: 'platform'
                },
                supportedAlgorithmIDs: [-7, -257]
            })

            const key = `reg:${userId}:${options.challenge.slice(0, 16)}`

            await saveChallenge({
                userId,
                challenge: options.challenge,
                type: 'registration',
                key
            })

            return res.json({ ...options, _key: key })
        } catch (error) {
            console.error('❌ startRegistration:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async finishRegistration(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const { _key, deviceName, ...attestation } = req.body || {}
            if (typeof _key !== 'string' || !_key || _key.length > 120) {
                return res.status(400).json({ message: 'Некорректный ключ челленджа' })
            }
            if (
                deviceName !== undefined &&
                (typeof deviceName !== 'string' || deviceName.length > 120)
            ) {
                return res.status(400).json({ message: 'Некорректное имя устройства' })
            }

            const challengeRow = await consumeChallenge(
                _key,
                'registration',
                userId
            )
            if (!challengeRow) {
                return res.status(400).json({ message: 'Челлендж истёк, попробуйте снова' })
            }

            let verification
            try {
                verification = await verifyRegistrationResponse({
                    response: attestation,
                    expectedChallenge: challengeRow.challenge,
                    expectedOrigin: FRONTEND_ORIGINS,
                    expectedRPID: RP_ID,
                    requireUserVerification: false
                })
            } catch (error) {
                console.warn('Не удалось проверить регистрацию passkey:', error)
                return res.status(400).json({ message: 'Не удалось проверить подпись' })
            }

            if (!verification.verified) {
                return res.status(400).json({ message: 'Не удалось проверить подпись' })
            }

            const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

            const existing = await Passkey.findOne({
                where: { credential_id: credential.id }
            })

            if (existing) {
                return res.status(409).json({
                    message: 'Этот ключ уже зарегистрирован'
                })
            }

            const userAgent = req.headers['user-agent'] || null

            const passkey = await Passkey.create({
                user_id: userId,
                credential_id: credential.id,
                public_key: Buffer.from(credential.publicKey).toString('base64url'),
                counter: credential.counter,
                transports: attestation.response?.transports || [],
                device_name: deviceName?.trim() || simpleDeviceName(userAgent),
                user_agent: userAgent
            })

            return res.json({
                ok: true,
                passkey: {
                    id: passkey.id,
                    device_name: passkey.device_name,
                    created_at: passkey.created_at
                },
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp
            })
        } catch (error) {
            console.error('❌ finishRegistration:', error)
            if (error instanceof UniqueConstraintError) {
                return res.status(409).json({ message: 'Этот ключ уже зарегистрирован' })
            }
            return res.status(500).json({ message: 'Ошибка регистрации passkey' })
        }
    }

    async startAuthentication(req, res) {
        try {
            const { email } = req.body || {}
            let allowCredentials = []
            let userId = null

            if (email && typeof email === 'string') {
                const user = await User.findOne({
                    where: sequelize.where(
                        sequelize.fn('LOWER', sequelize.col('email')),
                        email.trim().toLowerCase()
                    )
                })

                if (user) {
                    userId = user.id
                    const pks = await Passkey.findAll({
                        where: { user_id: user.id },
                        attributes: ['credential_id', 'transports']
                    })
                    allowCredentials = pks.map(pk => ({
                        id: pk.credential_id,
                        transports: pk.transports || []
                    }))
                }
            }

            const options = await generateAuthenticationOptions({
                rpID: RP_ID,
                userVerification: 'preferred',
                allowCredentials
            })

            const key = userId
                ? `auth:${userId}:${options.challenge.slice(0, 16)}`
                : `auth:anon:${options.challenge.slice(0, 16)}`

            await saveChallenge({
                userId,
                challenge: options.challenge,
                type: 'authentication',
                key
            })

            return res.json({ ...options, _key: key })
        } catch (error) {
            console.error('❌ startAuthentication:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async finishAuthentication(req, res) {
        try {
            const { _key, rememberMe, ...assertion } = req.body || {}
            if (typeof _key !== 'string' || !_key || _key.length > 120) {
                return res.status(400).json({ message: 'Некорректный ключ челленджа' })
            }
            if (rememberMe !== undefined && typeof rememberMe !== 'boolean') {
                return res.status(400).json({ message: 'Некорректный срок сессии' })
            }

            const challengeRow = await consumeChallenge(_key, 'authentication')
            if (!challengeRow) {
                return res.status(400).json({ message: 'Челлендж истёк' })
            }

            const passkey = await Passkey.findOne({
                where: { credential_id: assertion.id },
                include: [{
                    model: User,
                    as: 'user',
                    attributes: ['id', 'email', 'name', 'username', 'phone', 'bio', 'role', 'privilege_level']
                }]
            })

            if (!passkey) {
                return res.status(404).json({ message: 'Ключ не найден' })
            }
            if (
                challengeRow.user_id !== null &&
                challengeRow.user_id !== passkey.user_id
            ) {
                return res.status(400).json({ message: 'Ключ не соответствует аккаунту' })
            }

            let verification
            try {
                verification = await verifyAuthenticationResponse({
                    response: assertion,
                    expectedChallenge: challengeRow.challenge,
                    expectedOrigin: FRONTEND_ORIGINS,
                    expectedRPID: RP_ID,
                    credential: {
                        id: passkey.credential_id,
                        publicKey: Buffer.from(passkey.public_key, 'base64url'),
                        counter: passkey.counter,
                        transports: passkey.transports || []
                    },
                    requireUserVerification: false
                })
            } catch (error) {
                console.warn('Не удалось проверить вход passkey:', error)
                return res.status(400).json({ message: 'Не удалось проверить подпись' })
            }

            if (!verification.verified) {
                return res.status(400).json({ message: 'Не удалось проверить подпись' })
            }

            const user = passkey.user
            const guestToken = req.cookies?.guest_token
            await sequelize.transaction(async transaction => {
                await passkey.update({
                    counter: verification.authenticationInfo.newCounter,
                    last_used_at: new Date()
                }, { transaction })
                await linkGuestDataToUser(
                    user.id,
                    guestToken,
                    'login_linked',
                    transaction
                )
            })

            await revokeAuthTokens(req.cookies)
            if (rememberMe === true) {
                await setRememberedAuth(res, user)
            } else {
                await setSessionAuth(res, user)
            }

            return res.json({
                ok: true,
                user: buildUserPayload(user)
            })
        } catch (error) {
            console.error('❌ finishAuthentication:', error)
            return res.status(500).json({ message: 'Ошибка входа' })
        }
    }

    async listPasskeys(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const list = await Passkey.findAll({
                where: { user_id: userId },
                attributes: ['id', 'device_name', 'transports', 'created_at', 'last_used_at'],
                order: [['created_at', 'DESC']]
            })

            return res.json(list)
        } catch (error) {
            console.error('❌ listPasskeys:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async renamePasskey(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const { device_name } = req.body || {}
            if (!device_name || typeof device_name !== 'string' || device_name.length > 120) {
                return res.status(400).json({ message: 'Некорректное имя' })
            }

            const passkey = await Passkey.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!passkey) return res.status(404).json({ message: 'Не найдено' })

            await passkey.update({ device_name: device_name.trim() })

            return res.json({
                id: passkey.id,
                device_name: passkey.device_name
            })
        } catch (error) {
            console.error('❌ renamePasskey:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async deletePasskey(req, res) {
        try {
            const userId = getUserId(req)
            if (!userId) return res.status(401).json({ message: 'Не авторизован' })

            const passkey = await Passkey.findOne({
                where: { id: req.params.id, user_id: userId }
            })

            if (!passkey) return res.status(404).json({ message: 'Не найдено' })

            await passkey.destroy()
            return res.json({ ok: true })
        } catch (error) {
            console.error('❌ deletePasskey:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async hasAnyPasskey(req, res) {
        try {
            const { email } = req.query
            if (!email || typeof email !== 'string') {
                return res.json({ hasPasskey: false })
            }

            const user = await User.findOne({
                where: sequelize.where(
                    sequelize.fn('LOWER', sequelize.col('email')),
                    email.trim().toLowerCase()
                ),
                attributes: ['id']
            })

            if (!user) return res.json({ hasPasskey: false })

            const count = await Passkey.count({ where: { user_id: user.id } })

            return res.json({ hasPasskey: count > 0 })
        } catch (error) {
            console.error('❌ hasAnyPasskey:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

export default new PasskeyController()