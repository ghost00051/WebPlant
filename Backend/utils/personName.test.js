import assert from 'node:assert/strict'
import test from 'node:test'
import { getFirstName } from './personName.js'

test('getFirstName берёт первое слово из имени', () => {
    assert.equal(getFirstName('Иван Никитин'), 'Иван')
    assert.equal(getFirstName('  Анна   Соколова '), 'Анна')
    assert.equal(getFirstName('Пётр'), 'Пётр')
})

test('getFirstName терпит пустые значения', () => {
    assert.equal(getFirstName(''), '')
    assert.equal(getFirstName('   '), '')
    assert.equal(getFirstName(null), '')
    assert.equal(getFirstName(undefined), '')
    assert.equal(getFirstName(42), '')
})

test('getFirstName чистит разметку и обрезает слишком длинное имя', () => {
    assert.equal(getFirstName('<Иван> Никитин'), 'Иван')
    assert.equal(getFirstName('a'.repeat(60)).length, 40)
})
