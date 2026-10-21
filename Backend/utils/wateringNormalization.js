import {
    advanceZonedWatering,
    WATERING_TIME_OF_DAY_HOURS,
    zonedDayHourAfter
} from './wateringSchedule.js'
import { DEFAULT_TIME_ZONE, resolveTimeZone } from './timeZone.js'

export function planWateringHourFixes({
    plants,
    timeZonesByUser = new Map(),
    hours = WATERING_TIME_OF_DAY_HOURS,
    defaultTimeZone = DEFAULT_TIME_ZONE,
    now = new Date()
} = {}) {
    return (Array.isArray(plants) ? plants : []).map(plant => {
        const timeZone = resolveTimeZone(timeZonesByUser.get(plant?.user_id) ?? defaultTimeZone)
        const hour = hours?.[plant?.watering_time_of_day]
        const current = plant?.next_watering_at ? new Date(plant.next_watering_at) : null

        const base = {
            id: plant?.id ?? null,
            userId: plant?.user_id ?? null,
            name: plant?.name ?? '',
            timeOfDay: plant?.watering_time_of_day ?? null,
            timeZone,
            current,
            fixed: null,
            changed: false,
            reason: ''
        }

        if (!Number.isInteger(hour)) {
            return { ...base, reason: 'неизвестное время полива' }
        }
        if (!current || !Number.isFinite(current.getTime())) {
            return { ...base, reason: 'нет даты полива' }
        }

        const intervalDays = Number.isInteger(plant?.watering_interval_days) &&
            plant.watering_interval_days > 0
            ? plant.watering_interval_days
            : 7
        let fixed = zonedDayHourAfter(current, 0, hour, timeZone)
        if (fixed && fixed.getTime() <= now.getTime()) {
            fixed = advanceZonedWatering(fixed, intervalDays, hour, timeZone, now)
        }
        const changed = Boolean(fixed) && fixed.getTime() !== current.getTime()

        return {
            ...base,
            fixed,
            changed,
            reason: changed ? 'время суток не совпадает' : 'уже верно'
        }
    })
}
