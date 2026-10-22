import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isNotificationChange,
  UNREAD_POLL_MS
} from './notificationSync.js'

test('isNotificationChange: push от service worker считается изменением', () => {
  assert.equal(isNotificationChange({ data: { type: 'push-received' } }), true)
})

test('isNotificationChange: клик по уведомлению считается изменением', () => {
  assert.equal(isNotificationChange({ data: { type: 'notifications-changed' } }), true)
})

test('isNotificationChange: сообщения SW другого назначения игнорируются', () => {
  assert.equal(isNotificationChange({ data: { type: 'SW_UPDATED' } }), false)
  assert.equal(isNotificationChange({ data: { type: 'SKIP_WAITING' } }), false)
  assert.equal(isNotificationChange({ data: {} }), false)
  assert.equal(isNotificationChange({}), false)
  assert.equal(isNotificationChange(undefined), false)
})

test('UNREAD_POLL_MS: опрос не чаще раза в минуту', () => {
  assert.ok(Number.isInteger(UNREAD_POLL_MS))
  assert.ok(UNREAD_POLL_MS >= 60_000)
  assert.ok(UNREAD_POLL_MS <= 120_000)
})
