import test from 'node:test'
import assert from 'node:assert/strict'
import { integerParam, integerParamMiddleware } from './validateParam.js'

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

test('integerParam: корректные id пропускаются', () => {
    for (const value of ['1', '42', '999999999']) {
        let called = false
        integerParam({}, createRes(), () => { called = true }, value)
        assert.equal(called, true, `id ${value} должен проходить`)
    }
})

test('integerParam: строка, ноль, отрицательные и дробные отклоняются', () => {
    for (const value of ['abc', '0', '-1', '1.5', '01', '1e3', '', undefined, null, '1 2']) {
        const res = createRes()
        let called = false
        integerParam({}, res, () => { called = true }, value)
        assert.equal(called, false, `id ${String(value)} не должен проходить`)
        assert.equal(res.statusCode, 400)
        assert.deepEqual(res.body, { message: 'Некорректный идентификатор' })
    }
})

test('integerParamMiddleware: отсутствующий параметр → 400', () => {
    const req = { params: {} }
    const res = createRes()
    let called = false
    integerParamMiddleware('id')(req, res, () => { called = true })
    assert.equal(called, false)
    assert.equal(res.statusCode, 400)
})

test('integerParamMiddleware: корректный параметр → next()', () => {
    const req = { params: { id: '15' } }
    const res = createRes()
    let called = false
    integerParamMiddleware('id')(req, res, () => { called = true })
    assert.equal(called, true)
})
