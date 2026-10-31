import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPlantDaySheetTitle,
  buildPlantDayTasks,
  plantDayTaskKey,
  selectPlantCareTasks
} from './plantDayTasks.js'

const ISO = '2026-10-27'

test('selectPlantCareTasks: берёт задачи растения на нужный день', () => {
  const items = [
    { date: ISO, plant_id: 11, action_code: 'fertilize', title: 'Подкормка' },
    { date: ISO, plant_id: 12, action_code: 'spray', title: 'Опрыскивание' },
    { date: '2026-10-28', plant_id: 11, action_code: 'rotate', title: 'Поворот к свету' }
  ]
  const selected = selectPlantCareTasks(items, 11, ISO)
  assert.equal(selected.length, 1)
  assert.equal(selected[0].action_code, 'fertilize')
  assert.deepEqual(selectPlantCareTasks(items, 11, ''), [])
  assert.deepEqual(selectPlantCareTasks(null, 11, ISO), [])
})

test('buildPlantDayTasks: полив и уход объединены в один список', () => {
  const result = buildPlantDayTasks({
    plant: { id: 11, name: 'Монстера' },
    iso: ISO,
    watering: { kind: 'today' },
    careItems: [
      { date: ISO, plant_id: 11, action_code: 'spray', title: 'Опрыскивание' },
      { date: ISO, plant_id: 11, action_code: 'pest_check', title: 'Осмотр на вредителей' },
      { date: ISO, plant_id: 11, action_code: 'spray', title: 'Опрыскивание' }
    ]
  })

  assert.equal(result.tasks.length, 3)
  assert.equal(result.hasWatering, true)
  assert.equal(result.hasCare, true)
  assert.deepEqual(
    result.tasks.map(task => task.actionCode),
    ['water', 'spray', 'pest_check']
  )
  assert.equal(result.tasks[0].title, 'Полив')
  assert.equal(result.tasks[1].title, 'Опрыскивание')
})

test('buildPlantDayTasks: пропущенный полив помечается датой', () => {
  const result = buildPlantDayTasks({
    plant: { id: 17, name: 'Диффенбахия' },
    iso: ISO,
    watering: {
      kind: 'missed',
      scheduledFor: '2026-10-24',
      description: 'Полив 24 октября не отмечен'
    }
  })
  assert.equal(result.tasks[0].kind, 'water')
  assert.equal(result.tasks[0].scheduledFor, '2026-10-24')
  assert.match(result.tasks[0].description, /24 октября/)
  assert.equal(result.count, 1)
})

test('buildPlantDayTasks: без задач отдаёт пустой список', () => {
  const result = buildPlantDayTasks({ plant: { id: 11 }, iso: ISO })
  assert.deepEqual(result.tasks, [])
  assert.equal(result.count, 0)
  assert.deepEqual(buildPlantDayTasks({}).tasks, [])
})

test('buildPlantDayTasks: подкормка требует средство', () => {
  const result = buildPlantDayTasks({
    plant: { id: 11, name: 'Монстера' },
    iso: ISO,
    careItems: [{ date: ISO, plant_id: 11, action_code: 'fertilize', title: 'Подкормка' }]
  })
  assert.match(result.tasks[0].description, /средство/)
})

test('plantDayTaskKey и buildPlantDaySheetTitle', () => {
  assert.equal(
    plantDayTaskKey({ kind: 'care', actionCode: 'spray', id: 'care-spray-2026-10-27' }),
    'care:spray:care-spray-2026-10-27'
  )
  assert.equal(plantDayTaskKey(null), '')
  assert.equal(buildPlantDaySheetTitle({ name: 'Орхидея' }), 'Уход: Орхидея')
  assert.equal(buildPlantDaySheetTitle(null), 'Уход: Растение')
})
