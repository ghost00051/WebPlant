import test from 'node:test'
import assert from 'node:assert/strict'

import { detectImageExtension, validateOptionalChatPhoto } from './upload.js'

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        }
    }
}

function jpegBuffer() {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
}

test('detectImageExtension: JPEG/PNG/WebP/HEIC и мусор', () => {
    assert.equal(detectImageExtension(jpegBuffer()), '.jpg')
    assert.equal(
        detectImageExtension(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
        '.png'
    )
    assert.equal(
        detectImageExtension(Buffer.from('RIFF0000WEBP', 'ascii')),
        '.webp'
    )
    assert.equal(detectImageExtension(Buffer.from('не картинка')), null)
    assert.equal(detectImageExtension(Buffer.alloc(0)), null)
})

test('validateOptionalChatPhoto: JSON-запрос пропускается (health-check photoUrl)', () => {
    const req = { is: () => false, body: { photoUrl: '/uploads/plants/x.jpg' } }
    const res = createResponse()
    let nextCalled = 0

    validateOptionalChatPhoto(req, res, () => {
        nextCalled += 1
    })

    assert.equal(nextCalled, 1)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body, null)
})

test('validateOptionalChatPhoto: multipart с валидным фото пропускается', () => {
    const file = { buffer: jpegBuffer() }
    const req = { is: () => 'multipart/form-data', files: [file] }
    const res = createResponse()
    let nextCalled = 0

    validateOptionalChatPhoto(req, res, () => {
        nextCalled += 1
    })

    assert.equal(nextCalled, 1)
    assert.equal(req.files[0].detectedExtension, '.jpg')
})

test('validateOptionalChatPhoto: multipart без файла и с битым файлом -> 400', () => {
    const emptyReq = { is: () => 'multipart/form-data', files: [] }
    const emptyRes = createResponse()
    let emptyNext = 0
    validateOptionalChatPhoto(emptyReq, emptyRes, () => {
        emptyNext += 1
    })
    assert.equal(emptyNext, 0)
    assert.equal(emptyRes.statusCode, 400)
    assert.match(emptyRes.body.message, /Фото не загружено/)

    const brokenReq = { is: () => 'multipart/form-data', files: [{ buffer: Buffer.from('oops') }] }
    const brokenRes = createResponse()
    let brokenNext = 0
    validateOptionalChatPhoto(brokenReq, brokenRes, () => {
        brokenNext += 1
    })
    assert.equal(brokenNext, 0)
    assert.equal(brokenRes.statusCode, 400)
    assert.match(brokenRes.body.message, /JPEG, PNG, WebP и HEIC/)
})
