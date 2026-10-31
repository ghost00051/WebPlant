import test from 'node:test'
import assert from 'node:assert/strict'
import {
  getSeasonInfo,
  readMonthNumber,
  seasonBadgeText,
  seasonForMonth,
  seasonIntervalNote,
  seasonWateringHint
} from './season.js'

const MSK = 'Europe/Moscow'

test('seasonForMonth: сезоны по номеру месяца', () => {
  assert.equal(seasonForMonth(1), 'winter')
  assert.equal(seasonForMonth(12), 'winter')
  assert.equal(seasonForMonth(3), 'spring')
  assert.equal(seasonForMonth(6), 'summer')
  assert.equal(seasonForMonth(9), 'autumn')
  assert.equal(seasonForMonth(10), 'autumn')
  assert.equal(seasonForMonth(11), 'autumn')
  assert.equal(seasonForMonth(0), null)
  assert.equal(seasonForMonth(13), null)
  assert.equal(seasonForMonth('abc'), null)
})

test('getSeasonInfo: осень для октября в Москве', () => {
  const info = getSeasonInfo('2026-10-27T14:00:00.000Z', MSK)
  assert.equal(info.season, 'autumn')
  assert.equal(info.seasonLabel, 'осень')
  assert.equal(info.month, 10)
  assert.equal(info.monthLabel, 'осенью')
  assert.equal(info.growingSeason, false)
  assert.match(info.monthName, /октябр/i)
})

test('getSeasonInfo: момент после полуночи по Москве попадает в следующий месяц', () => {
  const info = getSeasonInfo('2026-11-30T22:30:00.000Z', MSK)
  assert.equal(info.month, 12)
  assert.equal(info.season, 'winter')
})

test('getSeasonInfo: лето и весна, некорректная дата не роняет функцию', () => {
  assert.equal(getSeasonInfo('2026-07-15T10:00:00.000Z', MSK).season, 'summer')
  assert.equal(getSeasonInfo('2026-04-15T10:00:00.000Z', MSK).season, 'spring')
  assert.equal(getSeasonInfo('не дата', MSK).season, 'autumn')
  assert.equal(getSeasonInfo(null, MSK).growingSeason, false)
})

test('readMonthNumber: неизвестный часовой пояс откатывается на локальный месяц', () => {
  const month = readMonthNumber('2026-10-27T14:00:00.000Z', 'Not/AZone')
  assert.equal(month, 10)
})

test('seasonBadgeText: тексты бейджа по сезону', () => {
  assert.equal(
    seasonBadgeText('autumn'),
    'Сейчас осень: поливайте реже'
  )
  assert.equal(
    seasonBadgeText({ season: 'winter' }),
    'Сейчас зима: поливайте реже и уберите растения от батарей'
  )
  assert.match(seasonBadgeText('summer'), /поливайте чаще/i)
  assert.equal(seasonBadgeText(undefined), seasonBadgeText('autumn'))
})

test('seasonWateringHint и seasonIntervalNote: подсказки не пустые', () => {
  for (const season of ['winter', 'spring', 'summer', 'autumn']) {
    assert.ok(seasonWateringHint(season).length > 20)
    assert.ok(seasonIntervalNote(season).length > 10)
  }
  assert.match(seasonIntervalNote('autumn'), /удлиняется/)
  assert.match(seasonIntervalNote('summer'), /короткий/)
})
