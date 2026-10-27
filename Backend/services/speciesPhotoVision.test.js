import test from 'node:test'
import assert from 'node:assert/strict'

process.env.YANDEX_CLOUD_FOLDER = 'test-folder'
process.env.YANDEX_CLOUD_API_KEY = 'test-key'

const { suggestSpeciesFromPhoto } = await import('./aiService.js')

test('suggestSpeciesFromPhoto: битый буфер -> AI_VISION_UNSUPPORTED_IMAGE (400 у клиента)', async () => {
    await assert.rejects(
        () => suggestSpeciesFromPhoto({ imageBuffer: Buffer.from('this is not an image') }),
        error => {
            assert.equal(error.code, 'AI_VISION_UNSUPPORTED_IMAGE')
            return true
        }
    )
})

test('suggestSpeciesFromPhoto: пустой буфер -> AI_VISION_NO_IMAGE', async () => {
    await assert.rejects(
        () => suggestSpeciesFromPhoto({ imageBuffer: Buffer.alloc(0) }),
        error => {
            assert.equal(error.code, 'AI_VISION_NO_IMAGE')
            return true
        }
    )
})
