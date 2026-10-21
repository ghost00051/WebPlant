import test from 'node:test'
import assert from 'node:assert/strict'
import { findProblem, validateJsonShape } from './validateJsonShape.js'

function createRes() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(payload) {
            this.body = payload
            return this
        }
    }
}

test('findProblem: обычный объект и массив проходят', () => {
    assert.equal(findProblem({ name: 'Монстера', tags: ['a', 'b'], nested: { ok: true } }), null)
    assert.equal(findProblem({}), null)
    assert.equal(findProblem(null), null)
})

test('findProblem: __proto__ на верхнем уровне отклоняется', () => {
    const payload = JSON.parse('{"__proto__":{"admin":true}}')
    assert.equal(findProblem(payload), 'forbidden_key')
})

test('findProblem: constructor внутри вложенного объекта отклоняется', () => {
    const payload = JSON.parse('{"plant":{"constructor":{"prototype":{"x":1}}}}')
    assert.equal(findProblem(payload), 'forbidden_key')
})

test('findProblem: слишком глубокая вложенность отклоняется', () => {
    let payload = { value: 1 }
    for (let index = 0; index < 25; index++) payload = { nested: payload }
    assert.equal(findProblem(payload), 'depth')
})

test('validateJsonShape: forbidden key → 400 без деталей', () => {
    const req = { body: JSON.parse('{"__proto__":{"polluted":true}}') }
    const res = createRes()
    let called = false
    validateJsonShape(req, res, () => { called = true })

    assert.equal(called, false)
    assert.equal(res.statusCode, 400)
    assert.deepEqual(res.body, { message: 'Некорректные данные запроса' })
})

test('validateJsonShape: валидное тело → next()', () => {
    const req = { body: { name: 'Фикус' } }
    const res = createRes()
    let called = false
    validateJsonShape(req, res, () => { called = true })

    assert.equal(called, true)
    assert.equal(res.statusCode, 200)
})
