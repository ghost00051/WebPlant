import {
    splitMissedWaterings,
    MISSED_GRACE_MS,
    zonedDayKey,
    generateWateringOccurrences
} from '../../../Backend/utils/wateringSchedule.js'

const MSK = 'Europe/Moscow'
const iso = d => (d === null ? null : new Date(d).toISOString())
const local = (d, tz) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(d)

const slot = new Date('2026-10-19T06:00:00Z')
console.log('=== A. interval=1, scheduled', iso(slot), `(${local(slot, MSK)} MSK)`)
for (const t of [
    '2026-10-20T05:50:00Z',
    '2026-10-20T06:00:00Z', 
    '2026-10-20T06:05:00Z', 
    '2026-10-20T06:10:00Z', 
    '2026-10-20T06:20:00Z', 
]) {
    const now = new Date(t)
    const pointer = slot 
    const overdue = pointer.getTime() < now.getTime() - MISSED_GRACE_MS
    const onDayWindow = pointer.getTime() >= now.getTime() - 15 * 60_000 &&
        pointer.getTime() <= now.getTime() + 5 * 60_000
    const { missed, next } = splitMissedWaterings(pointer, 1, 9, MSK, now)
    console.log(`${local(now, MSK)} MSK tick: pointer=${local(pointer, MSK)}`,
        'overdue>24h=', overdue, 'onDayWindow=', onDayWindow,
        '=> missed=', missed.map(m => local(m, MSK)),
        'next=', next ? local(next, MSK) : null)
}

console.log('\n=== B. interval=7, scheduled Mon 2026-10-12 09:00 MSK, first tick Mon 2026-10-19 09:10 MSK')
{
    const s = new Date('2026-10-12T06:00:00Z')
    const now = new Date('2026-10-19T06:10:00Z')
    const { missed, next } = splitMissedWaterings(s, 7, 9, MSK, now)
    console.log('missed=', missed.map(m => local(m, MSK)), 'next=', local(next, MSK))
}

console.log('\n=== C. interval=1, scheduled 2026-09-19 09:00 MSK, now 2026-10-20 09:10 MSK')
{
    const s = new Date('2026-09-19T06:00:00Z')
    const now = new Date('2026-10-20T06:10:00Z')
    const { missed, next } = splitMissedWaterings(s, 1, 9, MSK, now)
    console.log('missed count=', missed.length, 'first=', local(missed[0], MSK),
        'last=', local(missed[missed.length - 1], MSK), 'next=', local(next, MSK))
}

console.log('\n=== D. next_watering_at = 09:30 local (API allows arbitrary datetime)')
{
    const s = new Date('2026-10-20T06:30:00Z') 
    const now = new Date('2026-10-21T06:10:00Z') 
    const { missed, next } = splitMissedWaterings(s, 1, 9, MSK, now)
    console.log('scheduled=', local(s, MSK), 'missed=', missed.map(m => local(m, MSK)), 'next=', local(next, MSK))
    const occ = generateWateringOccurrences(s, 1, { now, daysAhead: 2, timeZone: MSK })
    console.log('schedule occurrences=', occ.map(o => local(o, MSK)))
}
