const WATERING_TYPES = new Set([
  'watering_due',
  'watering_day_before',
  'morning_summary',
  'weekly_recap',
  'watering'
])

const CARE_TYPES = new Set(['care_reminder', 'care_tip', 'care_advice'])

export const PLANT_SECTION_PREFIX = 'plant-'
export const MISC_SECTION_KEY = 'misc'

export function isWateringNotification (item) {
  return WATERING_TYPES.has(item?.type)
}

export function isCareNotification (item) {
  return CARE_TYPES.has(item?.type)
}

export function isUnreadNotification (item) {
  return !item?.read_at
}

export function notificationPlantId (item) {
  const value = item?.plant_id
  if (value === null || value === undefined) return null
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export function resolvePlantName (item, plantNames = {}) {
  const plantId = notificationPlantId(item)
  if (plantId && plantNames[plantId]) return String(plantNames[plantId])
  if (plantId && plantNames[String(plantId)]) return String(plantNames[String(plantId)])

  const payload = item?.payload && typeof item.payload === 'object' ? item.payload : {}
  const fromPayload = payload.plant_name || payload.plantName
  if (typeof fromPayload === 'string' && fromPayload.trim()) return fromPayload.trim()

  const body = typeof item?.body === 'string' ? item.body : ''
  const known = Object.values(plantNames).find(name =>
    typeof name === 'string' && name.trim() && body.toLowerCase().includes(name.trim().toLowerCase())
  )
  if (known) return known

  return plantId ? `Растение #${plantId}` : ''
}

function createSection (key, plantId, plantName) {
  return {
    key,
    plantId,
    plantName,
    items: [],
    unreadCount: 0,
    wateringCount: 0,
    careCount: 0,
    hasUnread: false
  }
}

export function groupNotificationsByPlant (items, plantNames = {}) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  const sections = []
  const index = new Map()

  for (const item of list) {
    const plantId = notificationPlantId(item)
    const key = plantId ? `${PLANT_SECTION_PREFIX}${plantId}` : MISC_SECTION_KEY
    let section = index.get(key)

    if (!section) {
      section = createSection(
        key,
        plantId,
        plantId ? resolvePlantName(item, plantNames) : ''
      )
      index.set(key, section)
      sections.push(section)
    }

    section.items.push(item)
    if (isUnreadNotification(item)) section.unreadCount += 1
    if (isWateringNotification(item)) section.wateringCount += 1
    if (isCareNotification(item)) section.careCount += 1
  }

  for (const section of sections) section.hasUnread = section.unreadCount > 0
  return sections
}

export function buildPlantSections (items, { plantNames = {}, mode = 'digest' } = {}) {
  const grouped = groupNotificationsByPlant(items, plantNames)
  const plants = grouped.filter(section => section.plantId)
  const misc = grouped.filter(section => !section.plantId)

  return {
    mode,
    plants: plants.map(section => ({
      ...section,
      digest: mode === 'digest' && section.items.length > 1,
      actionable: Boolean(section.plantId) &&
        (section.wateringCount > 0 || section.careCount > 0),
      latestItem: section.items[0] || null
    })),
    misc
  }
}

export function digestActionsFor (section) {
  const actions = []
  if (!section) return actions
  if (section.wateringCount > 0 && section.plantId) actions.push('water')
  if (section.careCount > 0 && section.plantId) actions.push('care')
  return actions
}

export function buildDigestSummary (sections) {
  const list = Array.isArray(sections) ? sections : []
  let plantsToWater = 0
  let plantsToCare = 0

  for (const section of list) {
    if (!section?.plantId) continue
    if (section.wateringCount > 0) plantsToWater += 1
    if (section.careCount > 0) plantsToCare += 1
  }

  const parts = []
  if (plantsToWater > 0) {
    parts.push(`${plantsToWater} ${pluralPlants(plantsToWater)} ${plantsToWater === 1 ? 'ждёт' : 'ждут'} полива`)
  }
  if (plantsToCare > 0) {
    parts.push(`${plantsToCare} ${pluralPlants(plantsToCare)} ${plantsToCare === 1 ? 'ждёт' : 'ждут'} ухода`)
  }

  return {
    plantsToWater,
    plantsToCare,
    text: parts.length ? `Сегодня: ${parts.join(', ')}` : ''
  }
}

function pluralPlants (count) {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return 'растение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'растения'
  return 'растений'
}

export function describeQuietWindow (quietHours) {
  if (!quietHours?.enabled) return ''
  if (!quietHours.start || !quietHours.end) return ''
  return `${quietHours.start}–${quietHours.end}`
}

export function isQuietHoursActive (quietHours, date = new Date()) {
  if (!quietHours?.enabled) return false
  if (!quietHours.start || !quietHours.end || quietHours.start === quietHours.end) return false

  const toMinutes = value => {
    const [hours, minutes] = String(value).split(':').map(Number)
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
    return hours * 60 + minutes
  }

  const start = toMinutes(quietHours.start)
  const end = toMinutes(quietHours.end)
  if (start === null || end === null) return false

  const current = date.getHours() * 60 + date.getMinutes()
  if (start < end) return current >= start && current < end
  return current >= start || current < end
}
