import {
    splitMissedWaterings,
    zonedDayKey,
    zonedDayHourAfter,
    zonedDateTimeToUtc,
    nextWateringInstant,
    addZonedDays,
    wateringMissDeadline
} from '../../../Backend/utils/wateringSchedule.js'

const iso = d => (d === null ? null : new Date(d).toISOString())
const local = (d, tz) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(d)

const localTomorrowKey = (now, tz) => zonedDayKey(zonedDayHourAfter(now, 1, 12, tz), tz)

const BERLIN = 'Europe/Berlin'

console.log('=== 1. Spring forward Berlin 2026-03-29 02:00->03:00')
for (const s of ['2026-03-28T08:00:00Z', '2026-03-29T07:00:00Z']) {
    const d = new Date(s)
    console.log(iso(d), '=> Berlin', local(d, BERLIN))
}
const before = new Date('2026-03-28T08:00:00Z')
const after = zonedDayHourAfter(before, 1, 9, BERLIN)
console.log('09:00 CET 28.03 -> next day occurrence:', iso(after), 'Berlin', local(after, BERLIN))
console.log('nextWateringInstant(7d):', iso(nextWateringInstant(before, 7, 'morning', { timeZone: BERLIN })),
    local(nextWateringInstant(before, 7, 'morning', { timeZone: BERLIN }), BERLIN))
console.log('addZonedDays(+1):', iso(addZonedDays(before, 1, BERLIN)), local(addZonedDays(before, 1, BERLIN), BERLIN))

console.log('\n--- daily plant across spring-forward: when does autoSkip trigger?')
{
    const slot = new Date('2026-03-28T08:00:00Z')
    for (const t of ['2026-03-29T07:00:00Z', '2026-03-29T07:10:00Z', '2026-03-29T08:00:00Z', '2026-03-29T08:10:00Z']) {
        const now = new Date(t)
        const cutoff = now.getTime() - 24 * 3600_000
        const trigger = slot.getTime() < cutoff
        const onDay = slot.getTime() >= now.getTime() - 15 * 60_000 && slot.getTime() <= now.getTime() + 5 * 60_000
        const { missed, next } = splitMissedWaterings(slot, 1, 9, BERLIN, now)
        console.log(local(now, BERLIN), 'Berlin tick: trigger=', trigger, 'onDayWindow=', onDay,
            'missed=', missed.map(m => local(m, BERLIN)), 'next=', next ? local(next, BERLIN) : null)
    }
}

console.log('\n=== 2. Fall back Berlin 2026-10-25 03:00->02:00')
{
    const slot = new Date('2026-10-24T07:00:00Z')
    const now = new Date('2026-10-25T08:10:00Z') 
    const cutoff = now.getTime() - 24 * 3600_000
    console.log('slot Berlin', local(slot, BERLIN), 'now Berlin', local(now, BERLIN),
        '24h-trigger=', slot.getTime() < cutoff)
    const { missed, next } = splitMissedWaterings(slot, 1, 9, BERLIN, now)
    console.log('missed=', missed.map(m => local(m, BERLIN)), 'next=', local(next, BERLIN))
}

console.log('\n=== 3. day-before "tomorrow" key across spring forward')
{
    const now = new Date('2026-03-28T19:00:00Z') 
    const next = new Date('2026-03-29T07:00:00Z')
    console.log('now', local(now, BERLIN), 'next', local(next, BERLIN),
        'zonedDayKey(next)=', zonedDayKey(next, BERLIN),
        'localTomorrowKey(now)=', localTomorrowKey(now, BERLIN),
        'delta h=', (next - now) / 3600_000)
}

console.log('\n=== 4. DST-gap local time conversion (hour in the gap)')
for (const [y, m, d, h] of [[2026, 3, 29, 2], [2026, 3, 29, 3], [2026, 10, 25, 2], [2026, 10, 25, 3]]) {
    const utc = zonedDateTimeToUtc({ year: y, month: m, day: d, hour: h }, BERLIN)
    console.log(`Berlin ${y}-${m}-${d} ${h}:00 -> ${iso(utc)} = Berlin ${local(utc, BERLIN)}`)
}

console.log('\n=== 5. reminderService.getDayBounds equivalent (local date + tomorrow midnight), DST days')
function getDateParts(date, tz) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
}
function getDayBounds(now, tz) {
    const today = getDateParts(now, tz)
    const todayUtc = Date.UTC(today.year, today.month - 1, today.day)
    const tomorrow = new Date(todayUtc + 24 * 3600_000)
    const tp = { year: tomorrow.getUTCFullYear(), month: tomorrow.getUTCMonth() + 1, day: tomorrow.getUTCDate() }
    // zonedMidnightToUtc copy
    const utcGuess = Date.UTC(tp.year, tp.month - 1, tp.day)
    const z = getDateParts(new Date(utcGuess), tz)
    const zonedAsUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second)
    return { date: `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`, end: new Date(utcGuess - (zonedAsUtc - utcGuess)) }
}
for (const s of ['2026-03-28T22:00:00Z', '2026-03-29T10:00:00Z', '2026-10-24T22:00:00Z', '2026-10-25T10:00:00Z']) {
    const b = getDayBounds(new Date(s), BERLIN)
    console.log('now', local(new Date(s), BERLIN), '=> date', b.date, 'end(tomorrow 00:00 local)=', iso(b.end), local(b.end, BERLIN))
}

console.log('\n=== 6. timezone change reinterpretation (userController.js:500) moves next into the past')
function reinterpret(instant, hour, tz) {
    return zonedDayHourAfter(instant, 0, hour, tz)
}
{
    const next = new Date('2026-10-19T23:00:00Z')
    const moved = reinterpret(next, 9, 'Europe/Moscow')
    console.log('old next', local(next, 'Asia/Vladivostok'), 'Vladivostok =', iso(next))
    console.log('after tz change -> Moscow', local(moved, 'Europe/Moscow'), '=', iso(moved))
    for (const nowS of ['2026-10-20T05:00:00Z', '2026-10-20T10:00:00Z', '2026-10-20T18:00:00Z']) {
        const now = new Date(nowS)
        const past = moved.getTime() <= now.getTime() - 24 * 3600_000
        const overdue = moved.getTime() < now.getTime()
        const inOnDay = moved.getTime() >= now.getTime() - 15 * 60_000 && moved.getTime() <= now.getTime() + 5 * 60_000
        console.log('  now', local(now, 'Europe/Moscow'), 'MSK: next past=', overdue,
            'in on-day window=', inOnDay, '"older than 24h -> autoskip branch"=', past)
    }
}

console.log('\n=== 7. wateringMissDeadline vs autoSkip grace (two different "missed" definitions)')
{
    const s = new Date('2026-10-19T06:00:00Z') // 09:00 MSK
    console.log('slot', local(s, 'Europe/Moscow'), 'missed-deadline (next local midnight)=',
        local(wateringMissDeadline(s, { timeZone: 'Europe/Moscow' }), 'Europe/Moscow'))
    console.log('autoSkip threshold (slot+24h) =', local(new Date(s.getTime() + 24 * 3600_000), 'Europe/Moscow'))
}
