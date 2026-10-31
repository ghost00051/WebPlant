import test from 'node:test'
import assert from 'node:assert/strict'
import { Op } from 'sequelize'
import {
    DEFAULT_NOTIFICATION_CATEGORY,
    buildUnreadByCategory,
    categoryWhere,
    emptyNotificationCategoryTotals,
    parseNotificationCategory,
    typeToNotificationCategory
} from './notificationCategories.js'

test('parseNotificationCategory: дефолт, валидные значения и мусор', () => {
    assert.equal(parseNotificationCategory(undefined), DEFAULT_NOTIFICATION_CATEGORY)
    assert.equal(parseNotificationCategory('all'), 'all')
    assert.equal(parseNotificationCategory('watering'), 'watering')
    assert.equal(parseNotificationCategory('care'), 'care')
    assert.equal(parseNotificationCategory(''), null)
    assert.equal(parseNotificationCategory('advice'), null)
    assert.equal(parseNotificationCategory('CARE'), null)
    assert.equal(parseNotificationCategory(null), null)
    assert.equal(parseNotificationCategory(42), null)
})

test('categoryWhere: all не фильтрует, категории фильтруют по своим типам', () => {
    assert.deepEqual(categoryWhere('all'), {})
    assert.deepEqual(categoryWhere('watering'), {
        type: { [Op.in]: ['watering_due', 'watering_day_before', 'morning_summary', 'weekly_recap'] }
    })
    assert.deepEqual(categoryWhere('care'), {
        type: { [Op.in]: ['care_reminder', 'care_tip'] }
    })
})

test('typeToNotificationCategory: сопоставление типов и неизвестные значения', () => {
    assert.equal(typeToNotificationCategory('watering_due'), 'watering')
    assert.equal(typeToNotificationCategory('morning_summary'), 'watering')
    assert.equal(typeToNotificationCategory('weekly_recap'), 'watering')
    assert.equal(typeToNotificationCategory('care_reminder'), 'care')
    assert.equal(typeToNotificationCategory('care_tip'), 'care')
    assert.equal(typeToNotificationCategory('unknown'), null)
    assert.equal(typeToNotificationCategory(undefined), null)
})

test('buildUnreadByCategory: суммирует по категориям, care включает оба типа, garden — просмотры сада', () => {
    const result = buildUnreadByCategory([
        { type: 'watering_due', count: '2' },
        { type: 'morning_summary', count: 1 },
        { type: 'care_reminder', count: 1 },
        { type: 'care_tip', count: 3 },
        { type: 'garden_view', count: 2 },
        { type: 'unknown', count: 10 },
        { type: 'care_tip', count: 0 },
        { type: 'care_tip', count: 'abc' }
    ])

    assert.deepEqual(result, { all: 9, watering: 3, care: 4, garden: 2 })
})

test('buildUnreadByCategory: пустые и битые данные', () => {
    assert.deepEqual(buildUnreadByCategory(undefined), emptyNotificationCategoryTotals())
    assert.deepEqual(buildUnreadByCategory([]), { all: 0, watering: 0, care: 0, garden: 0 })
    assert.deepEqual(buildUnreadByCategory([null, 'oops']), { all: 0, watering: 0, care: 0, garden: 0 })
})

test('parseNotificationCategory/categoryWhere: категория garden доступна для F50', () => {
    assert.equal(parseNotificationCategory('garden'), 'garden')
    assert.deepEqual(categoryWhere('garden'), { type: { [Op.in]: ['garden_view'] } })
    assert.equal(typeToNotificationCategory('garden_view'), 'garden')
})
