import { zonedDateTimeToUtc, zonedDayHourAfter, zonedDayKey } from '../../../Backend/utils/wateringSchedule.js'

const iso = d => (d === null ? null : new Date(d).toISOString())
const local = (d, tz) => new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
}).format(d)

const zones = ['America/Santiago', 'Africa/Cairo', 'Asia/Beirut', 'America/Havana', 'Europe/Berlin']
for (const tz of zones) {
    for (let d = new Date('2026-01-01T00:00:00Z'); d < new Date('2027-01-01T00:00:00Z'); d = new Date(d.getTime() + 86400_000)) {
        const key = zonedDayKey(d, tz)
        const utc = zonedDateTimeToUtc({ year: +key.slice(0, 4), month: +key.slice(5, 7), day: +key.slice(8, 10), hour: 0 }, tz)
        const l = local(utc, tz)
        if (!l.startsWith(key)) {
            console.log(`${tz}: local midnight ${key} does not exist -> converter gives ${iso(utc)} = ${l}`)
        }
    }
}

console.log('\nSantiago DST-start day slots:')
for (const h of [0, 9, 14, 19]) {
    for (const key of ['2026-09-06', '2026-04-05']) {
        const utc = zonedDateTimeToUtc({ year: +key.slice(0, 4), month: +key.slice(5, 7), day: +key.slice(8, 10), hour: h }, 'America/Santiago')
        console.log(`  ${key} ${h}:00 -> ${iso(utc)} = ${local(utc, 'America/Santiago')}`)
    }
}

function getDateParts(date, tz) {
    return Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]))
}
console.log('\nmidnight via h23 formatter check (Europe/Moscow 21:00Z):', getDateParts(new Date('2026-10-18T21:00:00Z'), 'Europe/Moscow'))
