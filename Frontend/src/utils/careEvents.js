export const CARE_ACTION_CODES = Object.freeze([
  'fertilize',
  'spray',
  'leaf_clean',
  'rotate',
  'pest_check',
  'humidity_support'
])

export const CARE_ACTION_TITLES = Object.freeze({
  fertilize: 'Подкормка',
  spray: 'Опрыскивание',
  leaf_clean: 'Протирание листьев',
  rotate: 'Поворот к свету',
  pest_check: 'Осмотр на вредителей',
  humidity_support: 'Влажность воздуха'
})

export const CARE_ACTION_GROUPS = Object.freeze({
  fertilize: 'feed',
  spray: 'spray',
  leaf_clean: 'other',
  rotate: 'other',
  pest_check: 'other',
  humidity_support: 'other'
})

export const CARE_GROUP_ORDER = Object.freeze(['feed', 'spray', 'other'])

export const CARE_METHOD_LABELS = Object.freeze({
  spray_bottle: 'пульверизатор',
  humidifier: 'увлажнитель'
})

export function careGroupFor(actionCode) {
  if (typeof actionCode !== 'string') return null
  return CARE_ACTION_GROUPS[actionCode] ?? null
}

export function careTitleFor(actionCode) {
  if (typeof actionCode !== 'string') return ''
  return CARE_ACTION_TITLES[actionCode] ?? actionCode
}

export function careMethodLabel(method) {
  if (typeof method !== 'string') return ''
  return CARE_METHOD_LABELS[method] ?? method
}

export function careEventSummary(event) {
  if (!event || typeof event !== 'object') return ''
  const parts = []
  if (typeof event.product_name === 'string' && event.product_name.trim()) {
    parts.push(event.product_name.trim())
  }
  if (typeof event.dose === 'string' && event.dose.trim()) {
    parts.push(event.dose.trim())
  }
  const method = careMethodLabel(event.method)
  if (method) parts.push(method)
  return parts.join(' · ')
}

export function careMarkerTypesFromEvents(events) {
  const types = new Set()
  for (const event of Array.isArray(events) ? events : []) {
    const group = careGroupFor(event?.action_code ?? event?.actionCode)
    if (group) types.add(group)
  }
  return types
}

function pushType(map, iso, group) {
  if (!iso || !group) return
  if (!map.has(iso)) map.set(iso, new Set())
  map.get(iso).add(group)
}

export function carePastMarkersFromTimeline(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const iso = typeof item?.date === 'string' ? item.date : null
    if (!iso) continue
    for (const event of Array.isArray(item?.events) ? item.events : []) {
      if (event?.kind !== 'care') continue
      pushType(map, iso, careGroupFor(event?.action_code ?? event?.actionCode))
    }
  }
  return map
}

export function careFutureMarkersFromSchedule(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const iso = typeof item?.date === 'string' ? item.date : null
    if (!iso) continue
    pushType(map, iso, careGroupFor(item?.action_code ?? item?.actionCode))
  }
  return map
}

export function carePlannedEventsByDate(items) {
  const map = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue
    const iso = typeof item.date === 'string' && item.date ? item.date : null
    const actionCode =
      typeof item.action_code === 'string' && item.action_code
        ? item.action_code
        : null
    if (!iso || !actionCode) continue
    const title =
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : careTitleFor(actionCode)
    const plantName =
      typeof item.plant_name === 'string' ? item.plant_name.trim() : ''
    if (!map.has(iso)) map.set(iso, [])
    map.get(iso).push({
      action_code: actionCode,
      title,
      plant_id: item.plant_id ?? null,
      plant_name: plantName
    })
  }
  return map
}

export function hasCareMarkers(...maps) {
  return maps.some(map => map instanceof Map && map.size > 0)
}

export function sortedCareGroups(types) {
  if (!(types instanceof Set)) return []
  return CARE_GROUP_ORDER.filter(group => types.has(group))
}
