import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveMultiAddSelection } from './multiAddSelection.js'

const PLANTS = [
    { slug: 'monstera', name: 'Монстера' },
    { slug: 'ficus', name: 'Фикус' },
    { slug: 'begonia', name: 'Бегония' }
]

test('resolveMultiAddSelection: ручной выбор без хендоффа создаёт все отмеченные растения', () => {
    const { chosen, matchedBySlug } = resolveMultiAddSelection({
        plants: PLANTS,
        matched: [],
        selected: ['monstera', 'begonia']
    })

    assert.deepEqual(chosen.map(plant => plant.slug), ['monstera', 'begonia'])
    assert.equal(matchedBySlug.size, 0)
})

test('resolveMultiAddSelection: смешанный выбор — создаются все, хендофф только для очистки', () => {
    const wantedEntry = {
        plant: PLANTS[0],
        wanted: { name: 'Монстера', species: 'Monstera deliciosa', intervalDays: 7 }
    }
    const { chosen, matchedBySlug } = resolveMultiAddSelection({
        plants: PLANTS,
        matched: [wantedEntry],
        selected: ['monstera', 'ficus']
    })

    assert.deepEqual(chosen.map(plant => plant.slug), ['monstera', 'ficus'])
    assert.equal(matchedBySlug.size, 1)
    assert.equal(matchedBySlug.get('monstera'), wantedEntry)
    assert.equal(matchedBySlug.has('ficus'), false)
})

test('resolveMultiAddSelection: пустой выбор и мусор не ломают функцию', () => {
    assert.deepEqual(resolveMultiAddSelection({}).chosen, [])
    assert.deepEqual(
        resolveMultiAddSelection({ plants: null, matched: null, selected: null }).chosen,
        []
    )
    assert.deepEqual(
        resolveMultiAddSelection({ plants: [{ slug: 'x' }], selected: ['y'] }).chosen,
        []
    )
})
