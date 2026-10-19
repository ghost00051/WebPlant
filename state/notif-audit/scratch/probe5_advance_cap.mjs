import {
    advanceZonedWatering,
    splitMissedWaterings,
    nextWateringInstant
} from '../../../Backend/utils/wateringSchedule.js'

const MSK = 'Europe/Moscow'
const iso = d => (d === null ? null : new Date(d).toISOString())
const local = (d, tz) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).format(d)

const base = new Date('1900-01-01T00:00:00Z')
const now = new Date('2026-10-19T09:00:00Z')
let t0 = performance.now()
const firstNext = nextWateringInstant(base, 1, 'morning', { timeZone: MSK })
const resolvedNext = advanceZonedWatering(firstNext, 1, 9, MSK, now)
let t1 = performance.now()
console.log('update() with last_watered_at=1900, interval=1:')
console.log('  resolved next_watering_at =', iso(resolvedNext), local(resolvedNext, MSK), `(in the past? ${resolvedNext < now})`)
console.log(`  advanceZonedWatering took ${(t1 - t0).toFixed(1)} ms (MAX_ADVANCE_STEPS loop)`)

t0 = performance.now()
const { missed, next } = splitMissedWaterings(resolvedNext, 1, 9, MSK, now)
t1 = performance.now()
console.log('  autoSkip splitMissedWaterings -> missed count =', missed.length,
    'first=', local(missed[0], MSK), 'next=', local(next, MSK), `took ${(t1 - t0).toFixed(1)} ms`)
console.log('  WateringLog rows actually written (slice(-100)) =', Math.min(missed.length, 100))
console.log('  push body says "пропущено", missed.length =', missed.length)

const ancient = new Date('0001-01-01T00:00:00Z')
t0 = performance.now()
const capped = advanceZonedWatering(nextWateringInstant(ancient, 1, 'morning', { timeZone: MSK }), 1, 9, MSK, now)
t1 = performance.now()
console.log('\nlast_watered_at=0001-01-01: capped next =', iso(capped), local(capped, MSK),
    `(still in the past: ${capped < now})`, `took ${(t1 - t0).toFixed(1)} ms`)
