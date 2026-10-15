import { col, fn } from 'sequelize'
import MailBroadcast from '../models/MailBroadcast.js'
import User from '../models/userModels.js'
import mailBroadcastService, { readMailBroadcastSettings } from '../services/mailBroadcastService.js'
import {
    describeMailConfigProblems,
    describeMailStatus,
    isMailConfigured,
    readMailConfig,
    renderBroadcastEmail,
    sendBroadcastEmail
} from '../services/mailService.js'
import { getFirstName } from '../utils/personName.js'
import {
    isValidBroadcastId,
    validateMailBroadcastInput
} from '../utils/mailBroadcastValidation.js'

const MAX_SEARCH_LENGTH = 254
const DEFAULT_RECIPIENTS_LIMIT = 50
const MAX_RECIPIENTS_LIMIT = 200
const MAX_RECIPIENTS_OFFSET = 1_000_000
const DEFAULT_PREVIEW_NAME = 'Анна'

const OVERVIEW_ATTRIBUTES = [
    'id',
    'subject',
    'status',
    'target_mode',
    'scheduled_for',
    'sent_at',
    'sent_count',
    'failed_count',
    'skipped_count',
    'total_recipients',
    'created_at'
]

function toPlain(row) {
    if (!row) return null
    if (typeof row.get === 'function') return row.get({ plain: true })
    return { ...row }
}

function parseBoundedInteger(value, { fallback, min, max }) {
    if (value === undefined || value === null || value === '') return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return null
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return null
    return parsed
}

function parseSearch(value) {
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') return null
    if (Array.from(value).length > MAX_SEARCH_LENGTH) return null
    return value.trim()
}

function countsOf(row) {
    const output = {}
    for (const key of ['sent', 'failed', 'skipped']) {
        const value = Number(row?.[key])
        output[key] = Number.isFinite(value) ? value : 0
    }
    return output
}

function validateMessage(payload) {
    const source = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload
        : {}

    return validateMailBroadcastInput({
        subject: source.subject,
        body: source.body,
        ctaLabel: source.ctaLabel,
        ctaUrl: source.ctaUrl,
        targetMode: 'all'
    })
}

function messageFrom(value) {
    return {
        subject: value.subject,
        body: value.body,
        ctaLabel: value.ctaLabel || '',
        ctaUrl: value.ctaUrl || ''
    }
}

class AdminMailController {
    async getOverview(req, res) {
        try {
            const config = readMailConfig()
            const [audience, statusRows, totalsRow, recentRows] = await Promise.all([
                mailBroadcastService.countAudience(),
                MailBroadcast.findAll({
                    attributes: ['status', [fn('COUNT', '*'), 'count']],
                    group: ['status'],
                    raw: true
                }),
                MailBroadcast.findOne({
                    attributes: [
                        [fn('COALESCE', fn('SUM', col('sent_count')), 0), 'sent'],
                        [fn('COALESCE', fn('SUM', col('failed_count')), 0), 'failed'],
                        [fn('COALESCE', fn('SUM', col('skipped_count')), 0), 'skipped']
                    ],
                    raw: true
                }),
                MailBroadcast.findAll({
                    attributes: OVERVIEW_ATTRIBUTES,
                    order: [['created_at', 'DESC'], ['id', 'DESC']],
                    limit: 5
                })
            ])

            const broadcasts = {
                total: 0,
                pending: 0,
                sending: 0,
                sent: 0,
                failed: 0,
                canceled: 0
            }
            for (const row of statusRows) {
                const value = Number(row.count)
                if (!Number.isFinite(value)) continue
                broadcasts.total += value
                if (row.status in broadcasts) broadcasts[row.status] += value
            }

            const totals = countsOf(totalsRow)

            return res.json({
                mailConfigured: isMailConfigured(),
                mailStatus: describeMailStatus(),
                mailProblems: describeMailConfigProblems(),
                from: config.fromName && config.fromAddress
                    ? `${config.fromName} <${config.fromAddress}>`
                    : config.fromAddress || '',
                users: audience,
                broadcasts,
                totals,
                recent: recentRows.map(toPlain)
            })
        } catch (error) {
            console.error('❌ Ошибка обзора рассылок писем:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async listRecipients(req, res) {
        try {
            const search = parseSearch(req.query.search)
            const limit = parseBoundedInteger(req.query.limit, {
                fallback: DEFAULT_RECIPIENTS_LIMIT,
                min: 1,
                max: MAX_RECIPIENTS_LIMIT
            })
            const offset = parseBoundedInteger(req.query.offset, {
                fallback: 0,
                min: 0,
                max: MAX_RECIPIENTS_OFFSET
            })

            if (search === null || limit === null || offset === null) {
                return res.status(400).json({ message: 'Параметры поиска некорректны' })
            }

            const { items, total } = await mailBroadcastService.listRecipients(search, {
                limit,
                offset
            })

            return res.json({ items, total })
        } catch (error) {
            console.error('❌ Ошибка списка получателей писем:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async preview(req, res) {
        try {
            const validation = validateMessage(req.body)
            if (!validation.ok) {
                return res.status(400).json({ message: validation.message })
            }

            const sampleName = await resolveSampleName(req.body)
            const rendered = renderBroadcastEmail({
                ...messageFrom(validation.value),
                userName: sampleName || DEFAULT_PREVIEW_NAME
            })

            return res.json({ ...rendered, sampleName: sampleName || DEFAULT_PREVIEW_NAME })
        } catch (error) {
            console.error('❌ Ошибка предпросмотра письма:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async sendTest(req, res) {
        try {
            if (!isMailConfigured()) {
                return res.status(503).json({ message: 'Почта не настроена на сервере' })
            }

            const to = typeof req.user?.email === 'string' ? req.user.email.trim() : ''
            if (!to) {
                return res.status(400).json({ message: 'У вашей учётной записи не задан email' })
            }

            const validation = validateMessage(req.body)
            if (!validation.ok) {
                return res.status(400).json({ message: validation.message })
            }

            await sendBroadcastEmail({
                to,
                userName: getFirstName(req.user?.name),
                ...messageFrom(validation.value)
            })

            return res.json({ sent: true, to })
        } catch (error) {
            console.error('❌ Ошибка тестового письма:', error)
            return res.status(502).json({
                message: 'Не удалось отправить тестовое письмо. Проверьте настройки SMTP на сервере.'
            })
        }
    }

    async createBroadcast(req, res) {
        try {
            const payload = req.body || {}
            const validation = validateMailBroadcastInput(payload)
            if (!validation.ok) {
                return res.status(400).json({ message: validation.message })
            }

            if (!validation.value.scheduledFor && !isMailConfigured()) {
                return res.status(503).json({ message: 'Почта не настроена на сервере' })
            }

            const { broadcast, recipients } = await mailBroadcastService.createBroadcast({
                adminId: req.user?.id ?? null,
                payload
            })

            if (broadcast.status !== 'sending') {
                return res.status(201).json({
                    broadcast: toPlain(broadcast),
                    recipientsCount: recipients.length,
                    sentResult: null,
                    queued: false
                })
            }

            const delivery = await mailBroadcastService.deliverBroadcast(broadcast.id, {
                batchSize: readMailBroadcastSettings().syncBatchSize
            })

            return res.status(201).json({
                broadcast: toPlain(delivery.broadcast) || toPlain(broadcast),
                recipientsCount: recipients.length,
                sentResult: delivery.result,
                queued: delivery.queued
            })
        } catch (error) {
            if (error?.statusCode === 400) {
                return res.status(400).json({ message: error.message })
            }
            console.error('❌ Ошибка создания рассылки писем:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }

    async cancelBroadcast(req, res) {
        try {
            const { id } = req.params
            if (!isValidBroadcastId(id)) {
                return res.status(400).json({ message: 'Некорректный идентификатор рассылки' })
            }

            const broadcastId = Number(id)
            const broadcast = await MailBroadcast.findByPk(broadcastId)
            if (!broadcast) {
                return res.status(404).json({ message: 'Рассылка не найдена' })
            }
            if (broadcast.status !== 'pending') {
                return res.status(409).json({ message: 'Эту рассылку нельзя отменить' })
            }

            const { canceled } = await mailBroadcastService.cancelBroadcast(broadcastId)
            if (!canceled) {
                return res.status(409).json({ message: 'Эту рассылку нельзя отменить' })
            }

            return res.json({ canceled: true })
        } catch (error) {
            console.error('❌ Ошибка отмены рассылки писем:', error)
            return res.status(500).json({ message: 'Ошибка сервера' })
        }
    }
}

async function resolveSampleName(payload) {
    if (!payload || payload.targetMode !== 'users') return ''
    const ids = Array.isArray(payload.userIds) ? payload.userIds : []
    const parsed = typeof ids[0] === 'number' ? ids[0] : Number.parseInt(ids[0], 10)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return ''

    const user = await User.findByPk(parsed, { attributes: ['name'] })
    return getFirstName(user?.name)
}

export default new AdminMailController()
