import test from 'node:test'
import assert from 'node:assert/strict'

import {
    SPECIES_SUGGESTION_MAX_ITEMS,
    parseSpeciesPhotoSuggestion
} from './aiService.js'

test('parseSpeciesPhotoSuggestion: валидный JSON с массивом подсказок', () => {
    const parsed = parseSpeciesPhotoSuggestion(JSON.stringify({
        isPlant: true,
        suggestions: [
            { name: 'Монстера', latin: 'Monstera deliciosa', species: 'Monstera deliciosa', confidence: 0.72 },
            { name: 'Филодендрон', latin: 'Philodendron hederaceum', confidence: 0.31 }
        ]
    }))

    assert.equal(parsed.isPlant, true)
    assert.equal(parsed.suggestions.length, 2)
    assert.deepEqual(parsed.suggestions[0], {
        name: 'Монстера',
        latin: 'Monstera deliciosa',
        species: 'Monstera deliciosa',
        confidence: 0.72
    })
    assert.equal(parsed.suggestions[1].species, 'Philodendron hederaceum', 'species падает на latin')
    assert.equal(parsed.suggestions[1].name, 'Филодендрон')
})

test('parseSpeciesPhotoSuggestion: markdown-обёртка, корневой массив, null-поля', () => {
    const fenced = parseSpeciesPhotoSuggestion(`\`\`\`json
{"suggestions":[{"name":"Кактус","latin":null,"species":"Echinopsis","confidence":0.5}]}
\`\`\``)
    assert.equal(fenced.suggestions[0].name, 'Кактус')
    assert.equal(fenced.suggestions[0].latin, null)

    const arrayRoot = parseSpeciesPhotoSuggestion('[{"species":"Ficus elastica","confidence":0.9}]')
    assert.equal(arrayRoot.suggestions[0].species, 'Ficus elastica')
    assert.equal(arrayRoot.suggestions[0].name, 'Ficus elastica', 'name падает на species')
})

test('parseSpeciesPhotoSuggestion: дедуп по виду, лимит подсказок, clamp confidence', () => {
    const parsed = parseSpeciesPhotoSuggestion(JSON.stringify({
        suggestions: [
            { name: 'A', latin: 'Species one', confidence: 2 },
            { name: 'B', latin: 'species one', confidence: -1 },
            { name: 'C', latin: 'Species two', confidence: 0.456 },
            { name: 'D', latin: 'Species three', confidence: 0.1 },
            { name: 'E', latin: 'Species four', confidence: 0.1 }
        ]
    }))

    assert.equal(parsed.suggestions.length, SPECIES_SUGGESTION_MAX_ITEMS)
    assert.equal(parsed.suggestions[0].confidence, 1)
    assert.equal(parsed.suggestions[1].latin, 'Species two', 'дубль вида отфильтрован')
    assert.equal(parsed.suggestions[1].confidence, 0.46)
    assert.deepEqual(parsed.suggestions.map(item => item.latin), [
        'Species one',
        'Species two',
        'Species three'
    ])
})

test('parseSpeciesPhotoSuggestion: не растение и битые ответы', () => {
    const notPlant = parseSpeciesPhotoSuggestion(JSON.stringify({ isPlant: false, suggestions: [{ name: 'Стол' }] }))
    assert.deepEqual(notPlant, { isPlant: false, suggestions: [] })

    assert.equal(parseSpeciesPhotoSuggestion('не json'), null)
    assert.equal(parseSpeciesPhotoSuggestion(''), null)
    assert.equal(parseSpeciesPhotoSuggestion(null), null)
    assert.equal(parseSpeciesPhotoSuggestion(JSON.stringify({ suggestions: [] })), null)
    assert.equal(parseSpeciesPhotoSuggestion(JSON.stringify({ suggestions: 'oops' })), null)
    assert.equal(parseSpeciesPhotoSuggestion(JSON.stringify({ suggestions: [null, 'x', {}] })), null)
})
