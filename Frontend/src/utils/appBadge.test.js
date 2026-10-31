import test from 'node:test'
import assert from 'node:assert/strict'
import { applyAppBadge, normalizeUnreadCount } from './appBadge.js'

test('normalizeUnreadCount: положительные числа и строки приводятся к целому', () => {
  assert.equal(normalizeUnreadCount(3), 3)
  assert.equal(normalizeUnreadCount('7'), 7)
  assert.equal(normalizeUnreadCount(2.9), 2)
})

test('normalizeUnreadCount: 0, отрицательные и мусор дают 0', () => {
  assert.equal(normalizeUnreadCount(0), 0)
  assert.equal(normalizeUnreadCount(-4), 0)
  assert.equal(normalizeUnreadCount('abc'), 0)
  assert.equal(normalizeUnreadCount(undefined), 0)
  assert.equal(normalizeUnreadCount(Number.NaN), 0)
})

test('applyAppBadge: положительный счётчик уходит в setAppBadge', () => {
  const calls = []
  const api = {
    setAppBadge: value => calls.push(['set', value]),
    clearAppBadge: () => calls.push(['clear'])
  }

  assert.equal(applyAppBadge(api, 5), true)
  assert.deepEqual(calls, [['set', 5]])
})

test('applyAppBadge: 0 и отрицательные значения снимают бейдж', () => {
  const calls = []
  const api = {
    setAppBadge: value => calls.push(['set', value]),
    clearAppBadge: () => calls.push(['clear'])
  }

  assert.equal(applyAppBadge(api, 0), true)
  assert.equal(applyAppBadge(api, -2), true)
  assert.deepEqual(calls, [['clear'], ['clear']])
})

test('applyAppBadge: неподдерживаемый API не роняет приложение', () => {
  assert.equal(applyAppBadge(null, 3), false)
  assert.equal(applyAppBadge(undefined, 3), false)
  assert.equal(applyAppBadge({}, 3), false)
  assert.equal(applyAppBadge({}, 0), false)
})

function withoutConsoleWarn (run) {
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    return run()
  } finally {
    console.warn = originalWarn
  }
}

test('applyAppBadge: синхронная ошибка API не выбрасывается наружу', () => {
  const api = {
    setAppBadge: () => {
      throw new Error('not installed')
    },
    clearAppBadge: () => {
      throw new Error('not installed')
    }
  }

  withoutConsoleWarn(() => {
    assert.equal(applyAppBadge(api, 4), false)
    assert.equal(applyAppBadge(api, 0), false)
  })
})

test('applyAppBadge: отклонённый промис API гасится', async () => {
  const api = {
    setAppBadge: () => Promise.reject(new Error('denied')),
    clearAppBadge: () => Promise.reject(new Error('denied'))
  }

  assert.equal(applyAppBadge(api, 2), true)
  assert.equal(applyAppBadge(api, 0), true)

  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
})
