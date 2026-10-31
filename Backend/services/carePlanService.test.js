import test from 'node:test'
import assert from 'node:assert/strict'

import carePlanService from './carePlanService.js'
import { CARE_KNOWLEDGE_VERSION } from '../utils/careKnowledge.js'

const NOW = new Date('2026-10-26T12:00:00+03:00')
const ALL_SEASONS = ['winter', 'spring', 'summer', 'autumn']

function planRow(overrides = {}) {
    return {
        plan: {
            leaf_clean: { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS },
            _version: CARE_KNOWLEDGE_VERSION
        },
        source: 'ai',
        season: 'autumn',
        generated_at: new Date('2026-10-20T09:00:00+03:00'),
        ...overrides
    }
}

test('isFresh: план текущей ревизии знаний и сезона актуален', () => {
    assert.equal(carePlanService.isFresh(planRow(), 'autumn', NOW), true)
})

test('isFresh: план без ревизии знаний считается устаревшим', () => {
    const row = planRow()
    delete row.plan._version

    assert.equal(carePlanService.isFresh(row, 'autumn', NOW), false)
})

test('isFresh: план другого сезона устаревает', () => {
    assert.equal(carePlanService.isFresh(planRow({ season: 'summer' }), 'autumn', NOW), false)
})

test('isFresh: план без действий устаревает даже с ревизией', () => {
    assert.equal(
        carePlanService.isFresh(planRow({ plan: { _version: CARE_KNOWLEDGE_VERSION } }), 'autumn', NOW),
        false
    )
})

test('resolvePlan: устаревший план заменяется безопасным дефолтом', () => {
    const plant = { id: 1, name: 'Монстера', species: 'Monstera deliciosa' }
    const group = { id: 'default' }
    const row = planRow({
        plan: {
            spray: { minIntervalDays: 3, maxPerMonth: 8, seasons: ALL_SEASONS },
            _version: CARE_KNOWLEDGE_VERSION - 1
        }
    })

    const plan = carePlanService.resolvePlan({ plant, group, row, season: 'autumn', now: NOW })

    assert.equal(plan.spray, undefined)
    assert.equal(plan.fertilize, undefined)
    assert.ok(plan.pest_check)
    assert.ok(plan.rotate)
})

test('resolvePlan: свежий план сохраняет разрешённые действия и теряет служебную версию', () => {
    const plant = { id: 1, name: 'Монстера', species: 'Monstera deliciosa' }
    const group = { id: 'default' }
    const row = planRow({
        plan: {
            spray: { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS },
            rotate: { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS },
            _version: CARE_KNOWLEDGE_VERSION
        }
    })

    const plan = carePlanService.resolvePlan({ plant, group, row, season: 'autumn', now: NOW })

    assert.ok(plan.spray)
    assert.ok(plan.rotate)
    assert.equal(plan._version, undefined)
})

test('resolvePlan: свежий план очищается от действий, запрещённых универсальными правилами', () => {
    const plant = { id: 1, name: 'Фиалка', species: 'Saintpaulia' }
    const group = { id: 'default' }
    const row = planRow({
        plan: {
            spray: { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS },
            rotate: { minIntervalDays: 14, maxPerMonth: 2, seasons: ALL_SEASONS },
            _version: CARE_KNOWLEDGE_VERSION
        }
    })

    const plan = carePlanService.resolvePlan({ plant, group, row, season: 'autumn', now: NOW })

    assert.equal(plan.spray, undefined)
    assert.ok(plan.rotate)
})

test('isFresh: дефолтный план живёт не больше суток', () => {
    const old = planRow({ source: 'default', generated_at: new Date('2026-10-24T09:00:00+03:00') })

    assert.equal(carePlanService.isFresh(old, 'autumn', NOW), false)
})
