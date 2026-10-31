import test from 'node:test'
import assert from 'node:assert/strict'

import {
    InactivityEmailService,
    buildInactivityCandidatesSql,
    buildInactivityClaimSql,
    formatRussianDate,
    formatSilenceDays,
    inactivityCutoffDay,
    isWithinSendWindow,
    readInactivityEmailConfig,
    renderInactivityEmail
} from './inactivityEmailService.js'

const MSK = 'Europe/Moscow'
const NOW_MSK_NOON = new Date('2026-10-25T09:00:00Z')

const BASE_ENV = {
    INACTIVITY_EMAIL_ENABLED: 'true',
    INACTIVITY_EMAIL_DAYS: '7',
    INACTIVITY_EMAIL_REQUIRE_MARKETING_CONSENT: 'true',
    INACTIVITY_EMAIL_REPEAT_DAYS: '0',
    INACTIVITY_EMAIL_WINDOW_START: '10',
    INACTIVITY_EMAIL_WINDOW_END: '20',
    INACTIVITY_EMAIL_MAX_PER_TICK: '200',
    INACTIVITY_EMAIL_BATCH_SIZE: '100',
    INACTIVITY_EMAIL_DELAY_MS: '0',
    INACTIVITY_EMAIL_DRY_RUN: 'false',
    FRONTEND_URL: 'https://example.test',
    SECRET_KEY: 'test-secret-key',
    UNSUBSCRIBE_URL_BASE: ''
}

function candidate(overrides = {}) {
    return {
        id: 1,
        email: 'user@example.test',
        name: 'Иван Петров',
        timezone: MSK,
        inactivity_email_sent_at: null,
        last_visit_day: '2026-10-17',
        last_visit_at: '2026-10-17T12:00:00Z',
        ...overrides
    }
}

function createTestContext({
    rows = [candidate()],
    env = BASE_ENV,
    mailReady = true,
    claimRows = undefined,
    mailError = false
} = {}) {
    const calls = { queries: [], mail: [], lockCalls: [] }

    const sequelize = {
        async query(sql, options = {}) {
            const text = String(sql)
            calls.queries.push({ sql: text, replacements: options.replacements ?? null })
            if (text.includes('SET inactivity_email_sent_at = now()')) {
                const userId = options.replacements?.userId
                return claimRows === undefined ? [{ id: userId }] : claimRows
            }
            if (text.includes('CAST(:previousSentAt AS timestamptz)')) {
                return [[], 1]
            }
            const afterId = Number(options.replacements?.afterId) || 0
            const batchSize = Number(options.replacements?.batchSize) || 100
            return rows.filter(row => Number(row.id) > afterId).slice(0, batchSize)
        }
    }

    const mail = {
        isMailConfigured: () => mailReady,
        async sendMail(payload) {
            if (mailError) throw new Error('SMTP недоступен')
            calls.mail.push(payload)
            return { accepted: [payload.to] }
        }
    }

    const service = new InactivityEmailService({
        sequelize,
        mail,
        env,
        withDistributedLock: async (name, options, task) => {
            calls.lockCalls.push({ name, options })
            return { ran: true, result: await task() }
        }
    })

    return { service, calls }
}

test('readInactivityEmailConfig: значения по умолчанию и парсинг env', () => {
    assert.deepEqual(readInactivityEmailConfig({}), {
        enabled: false,
        days: 7,
        requireMarketingConsent: true,
        repeatDays: 0,
        windowStart: 10,
        windowEnd: 20,
        maxPerTick: 200,
        batchSize: 100,
        delayMs: 200,
        dryRun: false
    })

    assert.deepEqual(readInactivityEmailConfig({
        INACTIVITY_EMAIL_ENABLED: 'true',
        INACTIVITY_EMAIL_DAYS: '10',
        INACTIVITY_EMAIL_REQUIRE_MARKETING_CONSENT: 'false',
        INACTIVITY_EMAIL_REPEAT_DAYS: '14',
        INACTIVITY_EMAIL_WINDOW_START: '8',
        INACTIVITY_EMAIL_WINDOW_END: '22',
        INACTIVITY_EMAIL_MAX_PER_TICK: '50',
        INACTIVITY_EMAIL_BATCH_SIZE: '25',
        INACTIVITY_EMAIL_DELAY_MS: '0',
        INACTIVITY_EMAIL_DRY_RUN: 'true'
    }), {
        enabled: true,
        days: 10,
        requireMarketingConsent: false,
        repeatDays: 14,
        windowStart: 8,
        windowEnd: 22,
        maxPerTick: 50,
        batchSize: 25,
        delayMs: 0,
        dryRun: true
    })

    assert.deepEqual(readInactivityEmailConfig({
        INACTIVITY_EMAIL_ENABLED: 'maybe',
        INACTIVITY_EMAIL_DAYS: '0',
        INACTIVITY_EMAIL_REPEAT_DAYS: '-2',
        INACTIVITY_EMAIL_WINDOW_START: '25',
        INACTIVITY_EMAIL_WINDOW_END: '0',
        INACTIVITY_EMAIL_MAX_PER_TICK: '0',
        INACTIVITY_EMAIL_BATCH_SIZE: '-1',
        INACTIVITY_EMAIL_DELAY_MS: 'мусор'
    }), {
        enabled: false,
        days: 7,
        requireMarketingConsent: true,
        repeatDays: 0,
        windowStart: 10,
        windowEnd: 20,
        maxPerTick: 200,
        batchSize: 100,
        delayMs: 200,
        dryRun: false
    })
})

test('inactivityCutoffDay: строго больше days дней и день считается в Europe/Moscow', () => {
    assert.equal(inactivityCutoffDay({ now: NOW_MSK_NOON, days: 7 }), '2026-10-17')
    assert.equal(inactivityCutoffDay({ now: NOW_MSK_NOON, days: 8 }), '2026-10-16')

    const lateEveningUtc = new Date('2026-10-25T22:00:00Z')
    assert.equal(inactivityCutoffDay({ now: lateEveningUtc, days: 7 }), '2026-10-18')
})

test('isWithinSendWindow: локальное окно пользователя, start включительно / end исключительно', () => {
    const config = readInactivityEmailConfig(BASE_ENV)
    const at = iso => new Date(iso)

    assert.equal(isWithinSendWindow({
        now: at('2026-10-25T07:00:00Z'),
        timeZone: MSK,
        windowStart: config.windowStart,
        windowEnd: config.windowEnd
    }), true)
    assert.equal(isWithinSendWindow({
        now: at('2026-10-25T06:59:00Z'),
        timeZone: MSK,
        windowStart: config.windowStart,
        windowEnd: config.windowEnd
    }), false)
    assert.equal(isWithinSendWindow({
        now: at('2026-10-25T16:59:00Z'),
        timeZone: MSK,
        windowStart: config.windowStart,
        windowEnd: config.windowEnd
    }), true)
    assert.equal(isWithinSendWindow({
        now: at('2026-10-25T17:00:00Z'),
        timeZone: MSK,
        windowStart: config.windowStart,
        windowEnd: config.windowEnd
    }), false)

    assert.equal(isWithinSendWindow({
        now: NOW_MSK_NOON,
        timeZone: 'America/New_York',
        windowStart: 10,
        windowEnd: 20
    }), false)

    assert.equal(isWithinSendWindow({
        now: NOW_MSK_NOON,
        timeZone: 'Not/AZone',
        windowStart: 10,
        windowEnd: 20
    }), true)
})

test('SQL выборки: site_visit_days JOIN, keyset, consent и repeat-условия', () => {
    const withConsent = buildInactivityCandidatesSql({ requireMarketingConsent: true, repeatDays: 0 })
    assert.match(withConsent, /FROM site_visit_days svd/)
    assert.match(withConsent, /MAX\(svd\.day\) AS last_visit_day/)
    assert.match(withConsent, /svd\.user_id IS NOT NULL/)
    assert.match(withConsent, /GROUP BY svd\.user_id/)
    assert.match(withConsent, /u\.id > :afterId/)
    assert.match(withConsent, /ORDER BY u\.id ASC/)
    assert.match(withConsent, /LIMIT :batchSize/)
    assert.match(withConsent, /role = 'USER'/)
    assert.match(withConsent, /TRIM\(u\.email\) <> ''/)
    assert.match(withConsent, /marketing_email_opt_in = TRUE/)
    assert.match(withConsent, /marketing_email_opt_out_at IS NULL/)
    assert.match(withConsent, /inactivity_email_sent_at IS NULL/)
    assert.match(withConsent, /inactivity_email_sent_at::date <= v\.last_visit_day/)
    assert.match(withConsent, /CAST\(:cutoffDay AS date\)/)
    assert.doesNotMatch(withConsent, /INTERVAL/)

    const withoutConsent = buildInactivityCandidatesSql({
        requireMarketingConsent: false,
        repeatDays: 14
    })
    assert.doesNotMatch(withoutConsent, /marketing_email_opt_in/)
    assert.match(withoutConsent, /marketing_email_opt_out_at IS NULL/)
    assert.match(withoutConsent, /\(CAST\(:repeatDays AS int\) \* INTERVAL '1 day'\)/)
    assert.match(
        withoutConsent,
        /OR u\.inactivity_email_sent_at < now\(\) - \(CAST\(:repeatDays AS int\) \* INTERVAL '1 day'\)/
    )

    const claim = buildInactivityClaimSql({ requireMarketingConsent: true, repeatDays: 14 })
    assert.match(claim, /UPDATE users AS u/)
    assert.match(claim, /SET inactivity_email_sent_at = now\(\)/)
    assert.match(claim, /WHERE u\.id = :userId/)
    assert.match(claim, /RETURNING u\.id/)
    assert.match(claim, /marketing_email_opt_in = TRUE/)
    assert.match(claim, /marketing_email_opt_out_at IS NULL/)
    assert.match(claim, /inactivity_email_sent_at::date <= CAST\(:lastVisitDay AS date\)/)
    assert.match(claim, /\(CAST\(:repeatDays AS int\) \* INTERVAL '1 day'\)/)
})

test('claim SQL: перепроверяет, что после last_visit_day не появился свежий заход', () => {
    const claim = buildInactivityClaimSql({ requireMarketingConsent: true, repeatDays: 0 })

    assert.match(claim, /UPDATE users AS u/)
    assert.match(claim, /AND NOT EXISTS \(/)
    assert.match(claim, /FROM site_visit_days fresh/)
    assert.match(claim, /fresh\.user_id = u\.id/)
    assert.match(claim, /fresh\.day > CAST\(:lastVisitDay AS date\)/)
    assert.match(claim, /RETURNING u\.id/)
    assert.doesNotMatch(claim, /INTERVAL/)

    const withoutConsent = buildInactivityClaimSql({ requireMarketingConsent: false, repeatDays: 0 })
    assert.doesNotMatch(withoutConsent, /marketing_email_opt_in/)
    assert.match(withoutConsent, /marketing_email_opt_out_at IS NULL/)
    assert.match(withoutConsent, /NOT EXISTS/)
})

test('formatRussianDate: русская дата, Date и безопасный null', () => {
    assert.equal(formatRussianDate('2026-10-12'), '12 октября')
    assert.equal(formatRussianDate(new Date(2026, 9, 12)), '12 октября')
    assert.equal(formatRussianDate('2026-01-05T10:00:00Z'), '5 января')
    assert.equal(formatRussianDate(null), '')
    assert.equal(formatRussianDate(undefined), '')
    assert.equal(formatRussianDate('мусор'), '')
})

test('formatSilenceDays: «больше недели» при days<=7, дальше — дни с русским склонением', () => {
    assert.equal(formatSilenceDays(7), 'больше недели')
    assert.equal(formatSilenceDays(3), 'больше недели')
    assert.equal(formatSilenceDays(8), 'больше 8 дней')
    assert.equal(formatSilenceDays(14), 'больше 14 дней')
    assert.equal(formatSilenceDays(21), 'больше 21 дня')
    assert.equal(formatSilenceDays(22), 'больше 22 дней')
    assert.equal(formatSilenceDays(25), 'больше 25 дней')
    assert.equal(formatSilenceDays(111), 'больше 111 дней')
    assert.equal(formatSilenceDays(undefined), 'больше недели')
})

test('renderInactivityEmail: subject, текст, HTML, отписка и экранирование', () => {
    const message = renderInactivityEmail({
        userName: 'Иван Петров',
        lastVisitDate: '2026-10-12',
        unsubscribeUrl: 'https://example.test/unsubscribe?uid=1&token=abc"<x>',
        homeUrl: 'https://example.test/home'
    })

    assert.equal(message.subject, '«Лейка»: всё в порядке?')
    assert.match(message.text, /^Здравствуйте, Иван!/)
    assert.match(message.text, /не заходили в «Лейку» уже больше недели/)
    assert.match(message.text, /последний раз это было 12 октября/)
    assert.match(message.text, /просто ответьте на это письмо и расскажите, что случилось/)
    assert.match(message.text, /растения вас ждут: расписание полива и напоминания на месте/)
    assert.match(message.text, /Открыть свой сад: https:\/\/example\.test\/home/)
    assert.match(message.text, /— Иван Никитин, разработчик «Лейки», checktheplants\.ru/)
    assert.match(message.text, /Вы получили это письмо, потому что зарегистрированы в «Лейке»/)
    assert.match(message.text, /отпишитесь в один клик/)
    assert.match(message.text, /https:\/\/example\.test\/unsubscribe\?uid=1&token=/)

    assert.match(message.html, /<html lang="ru">/)
    assert.match(message.html, /Открыть свой сад/)
    assert.match(message.html, /background-color:#2f8f4e/)
    assert.match(message.html, /https:\/\/example\.test\/home/)
    assert.match(message.html, /12 октября/)
    assert.match(message.html, /Вы получили это письмо, потому что зарегистрированы в «Лейке»/)
    assert.match(message.html, /&amp;/)
    assert.match(message.html, /&quot;/)
    assert.match(message.html, /&lt;x&gt;/)

    const fallback = renderInactivityEmail({})
    assert.match(fallback.text, /^Здравствуйте!/)
    assert.match(fallback.text, /уже больше недели\. Решил написать/)
    assert.doesNotMatch(fallback.text, /последний раз это было/)
    assert.match(fallback.text, /checktheplants\.ru\/unsubscribe/)
    assert.doesNotMatch(fallback.html, /undefined/)

    const fortnight = renderInactivityEmail({
        userName: 'Иван Петров',
        lastVisitDate: '2026-09-01',
        silenceDays: 14,
        unsubscribeUrl: 'https://example.test/unsubscribe?uid=1&token=abc',
        homeUrl: 'https://example.test/home'
    })
    assert.match(fortnight.text, /не заходили в «Лейку» уже больше 14 дней/)
    assert.match(fortnight.html, /не заходили в «Лейку» уже больше 14 дней/)
    assert.doesNotMatch(fortnight.text, /больше недели/)
})

test('tick: отправляет письмо кандидату, claim до отправки, List-Unsubscribe и отписка', async () => {
    const { service, calls } = createTestContext()

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.skipped, false)
    assert.equal(result.batches, 1)
    assert.equal(result.candidates, 1)
    assert.equal(result.scanned, 1)
    assert.equal(result.sent, 1)
    assert.equal(result.errors, 0)
    assert.equal(result.dryRun, false)
    assert.equal(result.cutoffDay, '2026-10-17')

    assert.equal(calls.lockCalls.length, 1)
    assert.equal(calls.lockCalls[0].name, 'job:inactivity-email-tick')
    assert.equal(calls.lockCalls[0].options.ttlMs, 10 * 60 * 1000)

    const select = calls.queries.find(entry => entry.sql.includes('FROM site_visit_days svd'))
    assert.equal(select.replacements.cutoffDay, '2026-10-17')
    assert.equal(select.replacements.afterId, 0)
    assert.equal(select.replacements.batchSize, 100)
    assert.equal(select.replacements.repeatDays, 0)

    const claim = calls.queries.find(entry => entry.sql.includes('SET inactivity_email_sent_at = now()'))
    assert.equal(claim.replacements.userId, 1)
    assert.equal(claim.replacements.lastVisitDay, '2026-10-17')

    assert.equal(calls.mail.length, 1)
    const mail = calls.mail[0]
    assert.equal(mail.to, 'user@example.test')
    assert.match(mail.subject, /^«Лейка»: всё в порядке\?$/)
    assert.match(mail.text, /Здравствуйте, Иван!/)
    assert.match(mail.text, /последний раз это было 17 октября/)
    assert.match(mail.html, /Открыть свой сад/)
    assert.match(mail.html, /https:\/\/example\.test\/home/)
    assert.match(mail.html, /https:\/\/example\.test\/unsubscribe\?uid=1&amp;token=/)
    assert.match(mail.headers['List-Unsubscribe'], /^<https:\/\/example\.test\/unsubscribe\?uid=1&token=/)
    assert.equal(mail.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
})

test('tick: без зафиксированного захода (нет строк site_visit_days) ничего не делает', async () => {
    const { service, calls } = createTestContext({ rows: [] })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.candidates, 0)
    assert.equal(result.scanned, 0)
    assert.equal(result.sent, 0)
    assert.equal(result.errors, 0)
    assert.equal(calls.queries.filter(entry => entry.sql.includes('FROM site_visit_days svd')).length, 1)
    assert.equal(calls.queries.filter(entry => entry.sql.includes('SET inactivity_email_sent_at = now()')).length, 0)
    assert.equal(calls.mail.length, 0)
})

test('tick: пропускает кандидата вне локального окна', async () => {
    const { service, calls } = createTestContext({
        rows: [candidate({ timezone: 'America/New_York' })]
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.skippedWindow, 1)
    assert.equal(result.sent, 0)
    assert.equal(calls.queries.filter(entry => entry.sql.includes('SET inactivity_email_sent_at = now()')).length, 0)
    assert.equal(calls.mail.length, 0)
})

test('tick: дедуп — claim не обновил строку, письмо повторно не уходит', async () => {
    const { service, calls } = createTestContext({ claimRows: [] })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.skippedDuplicate, 1)
    assert.equal(result.sent, 0)
    assert.equal(result.errors, 0)
    assert.equal(calls.mail.length, 0)
})

test('tick: ошибка SMTP → errors и откат inactivity_email_sent_at к прежнему значению', async () => {
    const previous = '2026-09-01T10:00:00.000Z'
    const { service, calls } = createTestContext({
        rows: [candidate({ inactivity_email_sent_at: previous })],
        mailError: true
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.errors, 1)
    assert.equal(result.sent, 0)
    assert.equal(calls.mail.length, 0)
    assert.match(result.cutoffDay, /^\d{4}-\d{2}-\d{2}$/)

    const rollback = calls.queries.find(entry => entry.sql.includes('CAST(:previousSentAt AS timestamptz)'))
    assert.ok(rollback, 'должен быть UPDATE-откат sent_at')
    assert.equal(rollback.replacements.userId, 1)
    assert.equal(rollback.replacements.previousSentAt, previous)
})

test('tick: dry-run работает и без SMTP — planned без писем и без claim', async () => {
    const { service, calls } = createTestContext({
        env: { ...BASE_ENV, INACTIVITY_EMAIL_DRY_RUN: 'true' },
        mailReady: false
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.dryRun, true)
    assert.equal(result.mailReady, false)
    assert.equal(result.skippedReason, null)
    assert.equal(result.planned, 1)
    assert.equal(result.sent, 0)
    assert.equal(calls.queries.filter(entry => entry.sql.includes('FROM site_visit_days svd')).length, 1)
    assert.equal(calls.queries.filter(entry => entry.sql.includes('SET inactivity_email_sent_at = now()')).length, 0)
    assert.equal(calls.mail.length, 0)
})

test('tick: выключенная фича не берёт лок и не ходит в БД', async () => {
    const { service, calls } = createTestContext({
        env: { ...BASE_ENV, INACTIVITY_EMAIL_ENABLED: 'false' }
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.deepEqual(result, { skipped: true, reason: 'disabled' })
    assert.equal(calls.lockCalls.length, 0)
    assert.equal(calls.queries.length, 0)
    assert.equal(calls.mail.length, 0)
})

test('tick: SMTP не настроен и не dry-run → ранний выход без сканирования БД', async () => {
    const { service, calls } = createTestContext({ mailReady: false })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.mailReady, false)
    assert.equal(result.skippedReason, 'mail-not-configured')
    assert.equal(result.dryRun, false)
    assert.equal(result.candidates, 0)
    assert.equal(result.scanned, 0)
    assert.equal(result.batches, 0)
    assert.equal(result.skippedNoMail, 0)
    assert.equal(result.sent, 0)
    assert.equal(result.truncated, false)
    assert.equal(result.cutoffDay, '2026-10-17')
    assert.equal(calls.queries.length, 0, 'при не настроенном SMTP SQL-выборки быть не должно')
    assert.equal(calls.mail.length, 0)
})

test('tick: батчи идут keyset по u.id, ограничение maxPerTick останавливает тик', async () => {
    const rows = [1, 2, 3, 4, 5].map(id => candidate({ id, email: `u${id}@example.test` }))
    const { service, calls } = createTestContext({
        rows,
        env: {
            ...BASE_ENV,
            INACTIVITY_EMAIL_BATCH_SIZE: '2',
            INACTIVITY_EMAIL_MAX_PER_TICK: '3'
        }
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    const selects = calls.queries.filter(entry => entry.sql.includes('FROM site_visit_days svd'))
    assert.deepEqual(selects.map(entry => entry.replacements.afterId), [0, 2])
    assert.equal(result.sent, 3)
    assert.equal(result.truncated, true)
    assert.deepEqual(calls.mail.map(mail => mail.to), [
        'u1@example.test',
        'u2@example.test',
        'u3@example.test'
    ])
})

test('tick: repeatDays прокидывается в SQL выборки и claim', async () => {
    const { service, calls } = createTestContext({
        rows: [],
        env: { ...BASE_ENV, INACTIVITY_EMAIL_REPEAT_DAYS: '30' }
    })

    await service.runInactivityEmailTick(NOW_MSK_NOON)

    const select = calls.queries.find(entry => entry.sql.includes('FROM site_visit_days svd'))
    assert.match(select.sql, /\(CAST\(:repeatDays AS int\) \* INTERVAL '1 day'\)/)
    assert.equal(select.replacements.repeatDays, 30)
})

test('tick: порог INACTIVITY_EMAIL_DAYS уходит в текст письма', async () => {
    const { service, calls } = createTestContext({
        env: { ...BASE_ENV, INACTIVITY_EMAIL_DAYS: '14' }
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.sent, 1)
    assert.equal(result.cutoffDay, '2026-10-10')
    assert.match(calls.mail[0].text, /не заходили в «Лейку» уже больше 14 дней/)
    assert.match(calls.mail[0].html, /не заходили в «Лейку» уже больше 14 дней/)
})

test('tick: INACTIVITY_EMAIL_REQUIRE_MARKETING_CONSENT=false убирает фильтр согласия', async () => {
    const { service, calls } = createTestContext({
        env: { ...BASE_ENV, INACTIVITY_EMAIL_REQUIRE_MARKETING_CONSENT: 'false' }
    })

    await service.runInactivityEmailTick(NOW_MSK_NOON)

    const select = calls.queries.find(entry => entry.sql.includes('FROM site_visit_days svd'))
    const claim = calls.queries.find(entry => entry.sql.includes('SET inactivity_email_sent_at = now()'))
    assert.doesNotMatch(select.sql, /marketing_email_opt_in/)
    assert.doesNotMatch(claim.sql, /marketing_email_opt_in/)
    assert.match(select.sql, /marketing_email_opt_out_at IS NULL/)
    assert.match(claim.sql, /marketing_email_opt_out_at IS NULL/)
})

test('tick: без SECRET_KEY письмо всё равно уходит, отписка — фолбэк без List-Unsubscribe', async () => {
    const { service, calls } = createTestContext({ env: { ...BASE_ENV, SECRET_KEY: '' } })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)

    assert.equal(result.sent, 1)
    assert.equal(result.errors, 0)
    assert.match(calls.mail[0].html, /https:\/\/checktheplants\.ru\/unsubscribe/)
    assert.equal(calls.mail[0].headers, undefined)
})

test('tick: лок занят другим инстансом → skipped locked, БД не трогаем', async () => {
    const service = new InactivityEmailService({
        sequelize: {
            async query() {
                throw new Error('БД не должна вызываться')
            }
        },
        mail: {
            isMailConfigured: () => true,
            async sendMail() {
                throw new Error('письма быть не должно')
            }
        },
        env: BASE_ENV,
        withDistributedLock: async () => ({ ran: false, reason: 'locked' })
    })

    const result = await service.runInactivityEmailTick(NOW_MSK_NOON)
    assert.deepEqual(result, { skipped: true, reason: 'locked' })
})
