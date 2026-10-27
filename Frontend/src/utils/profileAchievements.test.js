import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MONTH_WITH_LEYKA_DAYS,
  PLANTS_ACHIEVEMENT_TARGET,
  WATERINGS_ACHIEVEMENT_TARGET,
  achievementsSummaryText,
  achievementsUnlockedCount,
  buildProfileAchievements,
  daysWithLeyka,
  monthsWithLeyka
} from './profileAchievements.js'

const NOW = new Date('2026-10-27T12:00:00.000Z')

function byId (achievements, id) {
  return achievements.find(item => item.id === id)
}

test('monthsWithLeyka: считает полные месяцы с даты регистрации', () => {
  assert.equal(monthsWithLeyka('2026-10-01T00:00:00.000Z', NOW), 0)
  assert.equal(monthsWithLeyka('2026-09-27T00:00:00.000Z', NOW), 1)
  assert.equal(monthsWithLeyka('2026-03-12T09:00:00.000Z', NOW), 7)
  assert.equal(monthsWithLeyka('2026-10-31T00:00:00.000Z', NOW), 0)
})

test('monthsWithLeyka: пустые и испорченные даты дают null', () => {
  assert.equal(monthsWithLeyka(null, NOW), null)
  assert.equal(monthsWithLeyka(undefined, NOW), null)
  assert.equal(monthsWithLeyka('не дата', NOW), null)
  assert.equal(monthsWithLeyka('2026-10-01', new Date('не дата')), null)
})

test('daysWithLeyka: считает прошедшие дни, а будущее — как 0', () => {
  assert.equal(daysWithLeyka('2026-10-20T12:00:00.000Z', NOW), 7)
  assert.equal(daysWithLeyka('2026-10-27T12:00:00.000Z', NOW), 0)
  assert.equal(daysWithLeyka('2026-12-01T00:00:00.000Z', NOW), 0)
  assert.equal(daysWithLeyka('', NOW), null)
})

test('buildProfileAchievements: три достижения и разблокировка по данным', () => {
  const achievements = buildProfileAchievements(
    {
      createdAt: '2026-03-12T09:00:00.000Z',
      plantCount: 5,
      wateringCount: 12
    },
    NOW
  )

  assert.equal(achievements.length, 3)
  assert.equal(byId(achievements, 'month').unlocked, true)
  assert.equal(byId(achievements, 'plants').unlocked, true)
  assert.equal(byId(achievements, 'waterings').unlocked, true)
  assert.equal(byId(achievements, 'plants').progressPercent, 100)
  assert.equal(byId(achievements, 'waterings').progressPercent, 100)
})

test('buildProfileAchievements: прогресс не переполняется и не уходит в минус', () => {
  const achievements = buildProfileAchievements(
    { createdAt: '2026-10-20T12:00:00.000Z', plantCount: 2, wateringCount: 4 },
    NOW
  )

  const month = byId(achievements, 'month')
  assert.equal(month.unlocked, false)
  assert.equal(month.available, true)
  assert.ok(month.progressPercent > 0 && month.progressPercent < 100)

  const plants = byId(achievements, 'plants')
  assert.equal(plants.id, 'plants')
  assert.equal(plants.value, 2)
  assert.equal(plants.target, PLANTS_ACHIEVEMENT_TARGET)
  assert.equal(plants.progressPercent, 40)

  const waterings = byId(achievements, 'waterings')
  assert.equal(waterings.value, 4)
  assert.equal(waterings.target, WATERINGS_ACHIEVEMENT_TARGET)
  assert.equal(waterings.progressPercent, 40)

  const overflow = buildProfileAchievements(
    { createdAt: '2026-01-01T00:00:00.000Z', plantCount: 40, wateringCount: 400 },
    NOW
  )
  assert.equal(byId(overflow, 'plants').progressPercent, 100)
  assert.equal(byId(overflow, 'waterings').progressPercent, 100)
})

test('buildProfileAchievements: без данных деградирует, а не падает', () => {
  const achievements = buildProfileAchievements({}, NOW)

  assert.equal(achievements.length, 3)
  assert.equal(byId(achievements, 'month').available, false)
  assert.equal(byId(achievements, 'month').unlocked, false)
  assert.equal(byId(achievements, 'month').progressPercent, 0)
  assert.equal(byId(achievements, 'month').progressText, 'Дата регистрации недоступна')
  assert.equal(byId(achievements, 'plants').progressPercent, 0)
  assert.equal(byId(achievements, 'waterings').progressPercent, 0)

  assert.equal(buildProfileAchievements(null, NOW).length, 3)
})

test('buildProfileAchievements: отрицательные и нечисловые значения считаются нулём', () => {
  const achievements = buildProfileAchievements(
    { createdAt: '2026-03-12T09:00:00.000Z', plantCount: -3, wateringCount: 'много' },
    NOW
  )

  assert.equal(byId(achievements, 'plants').value, 0)
  assert.equal(byId(achievements, 'waterings').value, 0)
  assert.equal(byId(achievements, 'plants').unlocked, false)
})

test('buildProfileAchievements: прогресс месяца упирается в цель', () => {
  const old = buildProfileAchievements(
    { createdAt: '2025-03-12T09:00:00.000Z', plantCount: 1, wateringCount: 1 },
    NOW
  )
  assert.equal(byId(old, 'month').progressPercent, 100)
  assert.equal(byId(old, 'month').value, 1)

  const fresh = buildProfileAchievements(
    { createdAt: '2026-10-26T12:00:00.000Z', plantCount: 1, wateringCount: 1 },
    NOW
  )
  const percent = byId(fresh, 'month').progressPercent
  assert.equal(percent, Math.round((1 / MONTH_WITH_LEYKA_DAYS) * 100))
})

test('achievementsUnlockedCount и achievementsSummaryText: считают открытые', () => {
  const achievements = buildProfileAchievements(
    { createdAt: '2026-03-12T09:00:00.000Z', plantCount: 5, wateringCount: 3 },
    NOW
  )

  assert.equal(achievementsUnlockedCount(achievements), 2)
  assert.equal(achievementsSummaryText(achievements), 'Открыто 2 из 3 достижений')
  assert.equal(achievementsUnlockedCount(null), 0)
  assert.equal(achievementsSummaryText(null), 'Открыто 0 из 0 достижений')
})
