const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000

export function generateWateringOccurrences(
    nextWateringAt,
    intervalDays,
    { now = new Date(), daysAhead = 90 } = {}
) {
    const firstOccurrence = new Date(nextWateringAt)
    const start = new Date(now)
    if (
        !Number.isFinite(firstOccurrence.getTime()) ||
        !Number.isFinite(start.getTime()) ||
        !Number.isInteger(intervalDays) ||
        intervalDays < 1 ||
        !Number.isInteger(daysAhead) ||
        daysAhead < 0
    ) {
        return []
    }

    const interval = intervalDays * DAY_IN_MILLISECONDS
    const end = start.getTime() + daysAhead * DAY_IN_MILLISECONDS
    const occurrences = []

    if (firstOccurrence < start) {
        occurrences.push(new Date(firstOccurrence))
        const periodsToAdvance = Math.floor(
            (start.getTime() - firstOccurrence.getTime()) / interval
        ) + 1
        firstOccurrence.setTime(firstOccurrence.getTime() + periodsToAdvance * interval)
    }

    while (firstOccurrence.getTime() <= end) {
        occurrences.push(new Date(firstOccurrence))
        firstOccurrence.setTime(firstOccurrence.getTime() + interval)
    }

    return occurrences
}

/**
 * Первый полив после слота расписания — он закрывает просрочку.
 *
 * Последний полив растения для этого не годится: он сдвигает просрочку
 * исторических пропусков вперёд при каждом новом поливе. Полив раньше слота
 * (вне графика) пропуск не закрывает.
 */
export function findFirstWateringAfter(wateringTimes, scheduledFor) {
    const scheduled = new Date(scheduledFor).getTime()
    if (!Number.isFinite(scheduled) || !Array.isArray(wateringTimes)) {
        return null
    }

    let first = null
    for (const time of wateringTimes) {
        const at = time instanceof Date ? time.getTime() : new Date(time).getTime()
        if (!Number.isFinite(at) || at < scheduled) continue
        if (first === null || at < first) first = at
    }

    return first
}

/**
 * Насколько просрочен пропущенный полив.
 *
 * Пока растение не полили снова, просрочка растёт вместе с текущим временем:
 * автопропуск срабатывает сразу после 24 часов и фиксирует в записи «1 день»,
 * поэтому сохранённое hours_late нельзя показывать как текущую просрочку —
 * растение может стоять сухим намного дольше. Если полив всё-таки был, отсчёт
 * останавливается на первом поливе после слота (см. findFirstWateringAfter).
 */
export function resolveMissedLateness(
    scheduledFor,
    { now = new Date(), wateredAt = null } = {}
) {
    const scheduled = new Date(scheduledFor)
    const current = new Date(now)
    if (!Number.isFinite(scheduled.getTime()) || !Number.isFinite(current.getTime())) {
        return null
    }

    const watered = wateredAt ? new Date(wateredAt) : null
    const resolvedAt = watered && Number.isFinite(watered.getTime()) && watered >= scheduled
        ? watered
        : current

    const hoursLate = Math.max(
        0,
        Math.round((resolvedAt.getTime() - scheduled.getTime()) / HOUR_IN_MILLISECONDS)
    )

    return { hoursLate, daysLate: Math.floor(hoursLate / 24) }
}

export function isReminderWeekday(weekdays, date) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return true
    const scheduledDate = new Date(date)
    return Number.isFinite(scheduledDate.getTime()) &&
        weekdays.includes(scheduledDate.getDay())
}
