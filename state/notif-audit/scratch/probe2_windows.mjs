const TICK_MS = 10 * 60 * 1000

function ticksInWindow(openMs, closeMs, gridPhaseMs = 0) {
    const first = Math.ceil((openMs - gridPhaseMs) / TICK_MS) * TICK_MS + gridPhaseMs
    const out = []
    for (let t = first; t <= closeMs; t += TICK_MS) out.push(t)
    return out
}

console.log('=== on-day window: ticks per slot, all minute phases, both grid phases')
let min = Infinity
for (let phase = 0; phase < TICK_MS; phase += TICK_MS / 120) { // every 5 s phase
    for (let slotOffset = 0; slotOffset < 60 * 60 * 1000; slotOffset += 1000) {
        const slot = 1_700_000_000_000 + slotOffset
        const n = ticksInWindow(slot - 5 * 60_000, slot + 15 * 60_000, phase).length
        if (n < min) min = n
    }
}
console.log('min ticks covering an on-day slot =', min, '(window = [slot-5min, slot+15min], width 20min)')

console.log('\n=== day-before: ticks with local hour in [9,21] (window 13h, grid 10min)')
console.log('ticks =', ticksInWindow(9 * 3600_000, 21 * 3600_000 + 59 * 60_000 + 59_999, 0).length)

console.log('\n=== morning summary: ticks with local hour == 9')
for (const offsetMin of [0, 15, 30, 45]) {
    const phase = offsetMin * 60_000
    const n = ticksInWindow(9 * 3600_000, 9 * 3600_000 + 59 * 60_000 + 59_999, phase).length
    console.log(`tz offset ${offsetMin}min: ${n} ticks`)
}

console.log('\n=== care advice: ticks with local hour in [10,12)')
console.log('ticks =', ticksInWindow(10 * 3600_000, 11 * 3600_000 + 59 * 60_000 + 59_999, 0).length)


console.log('\n=== robustness: consecutive skipped ticks before a slot is definitely missed')
console.log('- on-day: window [slot-5min, slot+15min] contains 2-3 grid ticks; losing both consecutive ticks (>=10-20 min outage/lockoverrun) loses the slot forever;')
console.log('- morning summary/day-before/care advice windows are wide (1h/13h/2h) and tolerate many lost ticks.')
