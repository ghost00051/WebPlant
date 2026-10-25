import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isNotificationChange,
  isWeeklyRecapChange,
  NOTIFICATIONS_REFRESH_EVENT,
  publishNotificationsRefresh,
  subscribeToNotificationsRefresh,
  UNREAD_POLL_MS
} from './notificationSync.js'

test('isNotificationChange: push от service worker считается изменением', () => {
  assert.equal(isNotificationChange({ data: { type: 'push-received' } }), true)
})

test('isNotificationChange: клик по уведомлению считается изменением', () => {
  assert.equal(isNotificationChange({ data: { type: 'notifications-changed' } }), true)
})

test('isNotificationChange: событие итогов недели тоже считается изменением', () => {
  assert.equal(isNotificationChange({ data: { type: 'weekly-recap' } }), true)
})

test('isNotificationChange: сообщения SW другого назначения игнорируются', () => {
  assert.equal(isNotificationChange({ data: { type: 'SW_UPDATED' } }), false)
  assert.equal(isNotificationChange({ data: { type: 'SKIP_WAITING' } }), false)
  assert.equal(isNotificationChange({ data: {} }), false)
  assert.equal(isNotificationChange({}), false)
  assert.equal(isNotificationChange(undefined), false)
})

test('isWeeklyRecapChange: распознаёт recap по типу, тегу и notificationType', () => {
  assert.equal(isWeeklyRecapChange({ data: { type: 'weekly-recap' } }), true)
  assert.equal(isWeeklyRecapChange({ data: { type: 'push-received', tag: 'weekly_recap' } }), true)
  assert.equal(isWeeklyRecapChange({ data: { notificationType: 'weekly_recap' } }), true)
  assert.equal(isWeeklyRecapChange({ data: { type: 'push-received', tag: 'on_day' } }), false)
  assert.equal(isWeeklyRecapChange({ data: {} }), false)
  assert.equal(isWeeklyRecapChange(undefined), false)
})

test('UNREAD_POLL_MS: опрос не чаще раза в минуту', () => {
  assert.ok(Number.isInteger(UNREAD_POLL_MS))
  assert.ok(UNREAD_POLL_MS >= 60_000)
  assert.ok(UNREAD_POLL_MS <= 120_000)
})

test('refresh-событие: в Node без window безопасно не срабатывает', () => {
  assert.equal(typeof NOTIFICATIONS_REFRESH_EVENT, 'string')
  assert.equal(publishNotificationsRefresh({ reason: 'test' }), false)
  const unsubscribe = subscribeToNotificationsRefresh(() => {})
  assert.equal(typeof unsubscribe, 'function')
  unsubscribe()
})
