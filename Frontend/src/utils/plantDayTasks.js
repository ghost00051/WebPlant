import { careTitleFor } from './careEvents.js'

function isSamePlant(item, plantId) {
  if (plantId === null || plantId === undefined) return false
  return String(item?.plant_id ?? item?.plantId) === String(plantId)
}

export function selectPlantCareTasks(careItems, plantId, iso) {
  if (!Array.isArray(careItems) || !plantId || !iso) return []
  return careItems.filter(item => {
    if (!item || typeof item !== 'object') return false
    const date = typeof item.date === 'string' ? item.date : ''
    if (date !== iso) return false
    return isSamePlant(item, plantId)
  })
}

export function buildPlantDayTasks({
  plant,
  iso,
  watering = null,
  careItems = []
} = {}) {
  if (!plant || !iso) return { iso, tasks: [], hasWatering: false }

  const tasks = []

  if (watering && watering.kind === 'today') {
    tasks.push({
      id: `water-${iso}`,
      kind: 'water',
      actionCode: 'water',
      title: 'Полив',
      description: 'Растение ждёт полива сегодня'
    })
  } else if (watering && watering.kind === 'missed') {
    tasks.push({
      id: `water-missed-${iso}`,
      kind: 'water',
      actionCode: 'water',
      title: 'Полив',
      description: watering.description || 'Полив не был отмечен',
      scheduledFor: watering.scheduledFor ?? null
    })
  }

  const seen = new Set()
  for (const item of selectPlantCareTasks(careItems, plant.id, iso)) {
    const actionCode =
      typeof item.action_code === 'string' && item.action_code
        ? item.action_code
        : typeof item.actionCode === 'string'
          ? item.actionCode
          : ''
    if (!actionCode || seen.has(actionCode)) continue
    seen.add(actionCode)
    tasks.push({
      id: `care-${actionCode}-${iso}`,
      kind: 'care',
      actionCode,
      title: typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : careTitleFor(actionCode),
      description:
        actionCode === 'fertilize'
          ? 'Нужно указать средство и дозировку'
          : 'Отметьте, когда выполните'
    })
  }

  return {
    iso,
    tasks,
    hasWatering: tasks.some(task => task.kind === 'water'),
    hasCare: tasks.some(task => task.kind === 'care'),
    count: tasks.length
  }
}

export function plantDayTaskKey(task) {
  if (!task || typeof task !== 'object') return ''
  return `${task.kind}:${task.actionCode}:${task.id}`
}

export function buildPlantDaySheetTitle(plant) {
  const name = typeof plant?.name === 'string' && plant.name.trim() ? plant.name.trim() : 'Растение'
  return `Уход: ${name}`
}
