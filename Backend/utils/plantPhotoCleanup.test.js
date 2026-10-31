import test from 'node:test'
import assert from 'node:assert/strict'

import { removePlantPhotoFilesIfUnreferenced } from './plantPhotoCleanup.js'

const URL = 'https://api.example.com/uploads/plants/0123456789abcdef0123456789abcdef.jpg'

test('removePlantPhotoFilesIfUnreferenced: при 0 ссылок удаляет файл через removeFiles', async () => {
    const removedUrls = []
    const result = await removePlantPhotoFilesIfUnreferenced(URL, {
        countReferences: async () => 0,
        removeFiles: async urls => {
            removedUrls.push(...urls)
            return 0
        }
    })

    assert.deepEqual(result, { removed: 0, skipped: false, references: 0 })
    assert.deepEqual(removedUrls, [URL], 'фильтрация имени файла — внутри removePlantPhotoFiles')
})

test('removePlantPhotoFilesIfUnreferenced: пока есть другие ссылки, файл не удаляется (BE-06)', async () => {
    const removedUrls = []
    const result = await removePlantPhotoFilesIfUnreferenced(URL, {
        countReferences: async url => {
            assert.equal(url, URL)
            return 2
        },
        removeFiles: async urls => {
            removedUrls.push(...urls)
            return urls.length
        }
    })

    assert.deepEqual(result, { removed: 0, skipped: true, references: 2 })
    assert.deepEqual(removedUrls, [])
})

test('removePlantPhotoFilesIfUnreferenced: ноль ссылок — файл удаляется', async () => {
    const removedUrls = []
    const result = await removePlantPhotoFilesIfUnreferenced(URL, {
        countReferences: async () => 0,
        removeFiles: async urls => {
            removedUrls.push(...urls)
            return 1
        }
    })

    assert.deepEqual(result, { removed: 1, skipped: false, references: 0 })
    assert.deepEqual(removedUrls, [URL])
})

test('removePlantPhotoFilesIfUnreferenced: без countReferences — TypeError', async () => {
    await assert.rejects(
        () => removePlantPhotoFilesIfUnreferenced(URL),
        /countReferences must be a function/
    )
})
