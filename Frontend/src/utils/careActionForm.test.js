import test from 'node:test'
import assert from 'node:assert/strict'
import {
  OTHER_CARE_ACTIONS,
  PRODUCT_SUGGESTIONS,
  buildCareActionPayload,
  buildPerformedAt,
  careActionTabs,
  careDateValue,
  formatCareDate,
  formatCareSummary,
  recentProductsFromLatest
} from './careActionForm.js'

const NOW = new Date('2026-10-25T09:30:00.000Z')

function payloadOf(overrides = {}, options = { now: NOW }) {
  return buildCareActionPayload(
    {
      actionCode: 'fertilize',
      plantId: 12,
      product: 'Покон',
      ...overrides
    },
    options
  )
}

test('careActionTabs: подкормка, опрыскивание и другой уход', () => {
  assert.deepEqual(
    careActionTabs.map(tab => tab.id),
    ['fertilize', 'spray', 'other']
  )
  assert.equal(careActionTabs[0].label, 'Подкормка')
  assert.equal(careActionTabs[1].label, 'Опрыскивание')
  assert.equal(careActionTabs[2].label, 'Другой уход')
  assert.deepEqual(
    OTHER_CARE_ACTIONS.map(action => action.code),
    ['leaf_clean', 'rotate', 'pest_check', 'humidity_support']
  )
  assert.deepEqual(
    OTHER_CARE_ACTIONS.map(action => action.label),
    ['Протирание листьев', 'Поворот к свету', 'Осмотр на вредителей', 'Влажность воздуха']
  )
  assert.deepEqual(PRODUCT_SUGGESTIONS, ['Покон', 'Фаско', 'Агрикола', 'Bona Forte'])
})

test('buildCareActionPayload: валидная подкормка', () => {
  const result = payloadOf({
    dose: ' 1 колпачок на 1 л ',
    note: ' После полива ',
    performedAt: '2026-10-24'
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.value, {
    action_code: 'fertilize',
    plant_id: 12,
    product_name: 'Покон',
    dose: '1 колпачок на 1 л',
    method: null,
    note: 'После полива',
    performed_at: buildPerformedAt('2026-10-24'),
    notification_id: null
  })
})

test('buildCareActionPayload: опрыскивание с методом и без продукта', () => {
  const result = payloadOf({
    actionCode: 'spray',
    product: '',
    method: 'spray_bottle'
  })

  assert.equal(result.ok, true)
  assert.equal(result.value.product_name, null)
  assert.equal(result.value.method, 'spray_bottle')
})

test('buildCareActionPayload: метод игнорируется для не-опрыскивания', () => {
  const result = payloadOf({ actionCode: 'leaf_clean', method: 'spray_bottle' })

  assert.equal(result.ok, true)
  assert.equal(result.value.method, null)
  assert.equal(result.value.product_name, null)
})

test('buildCareActionPayload: уведомление привязывается к отметке', () => {
  const result = payloadOf({ actionCode: 'spray', notificationId: 77 })

  assert.equal(result.ok, true)
  assert.equal(result.value.notification_id, 77)
})

test('buildCareActionPayload: performed_at по умолчанию — переданный now', () => {
  const result = payloadOf({ performedAt: undefined })

  assert.equal(result.ok, true)
  assert.equal(result.value.performed_at, NOW.toISOString())
})

test('buildCareActionPayload: ошибки обязательных полей', () => {
  assert.deepEqual(
    buildCareActionPayload({ actionCode: 'fertilize', product: 'Покон' }, { now: NOW }),
    { ok: false, error: 'Выберите растение.' }
  )
  assert.deepEqual(
    payloadOf({ plantId: 0 }),
    { ok: false, error: 'Выберите растение.' }
  )
  assert.deepEqual(
    payloadOf({ plantId: 'abc' }),
    { ok: false, error: 'Выберите растение.' }
  )
  assert.deepEqual(
    payloadOf({ actionCode: 'water' }),
    { ok: false, error: 'Выберите тип ухода.' }
  )
  assert.deepEqual(
    payloadOf({ product: '   ' }),
    { ok: false, error: 'Укажите, чем подкармливали.' }
  )
})

test('buildCareActionPayload: ограничения длины и метода', () => {
  assert.equal(payloadOf({ product: 'я'.repeat(160) }).ok, true)
  assert.equal(payloadOf({ product: 'я'.repeat(161) }).ok, false)
  assert.equal(payloadOf({ dose: 'д'.repeat(121) }).ok, false)
  assert.equal(payloadOf({ note: 'н'.repeat(501) }).ok, false)
  assert.deepEqual(
    payloadOf({ actionCode: 'spray', method: 'bucket' }),
    { ok: false, error: 'Неизвестный способ опрыскивания.' }
  )
  assert.deepEqual(
    payloadOf({ performedAt: 'не дата' }),
    { ok: false, error: 'Укажите корректную дату ухода.' }
  )
  assert.deepEqual(
    payloadOf({ notificationId: -5 }),
    { ok: false, error: 'Некорректная ссылка на уведомление.' }
  )
})

test('careDateValue: локальная дата YYYY-MM-DD', () => {
  assert.equal(careDateValue(new Date(2026, 9, 5)), '2026-10-05')
  assert.equal(careDateValue(new Date(2026, 0, 31)), '2026-01-31')
  assert.match(careDateValue(), /^\d{4}-\d{2}-\d{2}$/)
})

test('buildPerformedAt: полдень локальной зоны и проверка даты', () => {
  const iso = buildPerformedAt('2026-10-24')
  const date = new Date(iso)

  assert.equal(date.getFullYear(), 2026)
  assert.equal(date.getMonth(), 9)
  assert.equal(date.getDate(), 24)
  assert.equal(date.getHours(), 12)
  assert.equal(date.getMinutes(), 0)
  assert.equal(buildPerformedAt('2026-02-30'), null)
  assert.equal(buildPerformedAt('24.10.2026'), null)
  assert.equal(buildPerformedAt(null), null)
})

test('formatCareSummary и formatCareDate', () => {
  assert.equal(
    formatCareSummary({
      action_code: 'fertilize',
      product_name: 'Покон',
      performed_at: new Date(2026, 9, 24, 12).toISOString()
    }),
    'Подкормка · Покон · 24 октября'
  )
  assert.equal(formatCareSummary({ action_code: 'rotate' }), 'Поворот к свету')
  assert.equal(formatCareSummary(null), '')
  assert.equal(formatCareDate('2026-01-02'), '2 января')
  assert.equal(formatCareDate(new Date(2026, 0, 2, 12)), '2 января')
  assert.equal(formatCareDate(''), '')
})

test('recentProductsFromLatest: уникальные средства без повторов', () => {
  const products = recentProductsFromLatest([
    { plant_id: 1, product_name: 'Покон' },
    { plant_id: 2, product_name: ' покон ' },
    { plant_id: 3, product_name: 'Bona Forte' },
    { plant_id: 4, product_name: '   ' },
    { plant_id: 5 },
    null,
    { plant_id: 6, product_name: 'Агрикола' }
  ])

  assert.deepEqual(products, ['Покон', 'Bona Forte', 'Агрикола'])
  assert.deepEqual(recentProductsFromLatest(null), [])
})
