const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000

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

export function isReminderWeekday(weekdays, date) {
    if (!Array.isArray(weekdays) || weekdays.length === 0) return true
    const scheduledDate = new Date(date)
    return Number.isFinite(scheduledDate.getTime()) &&
        weekdays.includes(scheduledDate.getDay())
}
