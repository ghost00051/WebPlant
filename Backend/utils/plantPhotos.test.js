import test from 'node:test'
import assert from 'node:assert/strict'

import {
    PLANT_PHOTO_NOTE_MAX_LENGTH,
    buildPlantPhotoRow,
    isValidPhotoInput,
    isValidPhotoNote,
    isValidPhotoTakenAt,
    photoNoteOf,
    photoTakenAtOf,
    pickNextMainPhoto,
    serializePlantPhoto,
    sortPlantPhotosForGallery
} from './plantPhotos.js'

const URL = '/uploads/plants/0123456789abcdef0123456789abcdef.jpg'

test('isValidPhotoInput: старый контракт (строка и объект url)', () => {
    assert.equal(isValidPhotoInput(URL), true)
    assert.equal(isValidPhotoInput({ url: URL }), true)
    assert.equal(isValidPhotoInput({ url: URL, sort_order: 2, is_main: true }), true)
    assert.equal(isValidPhotoInput({ url: URL, metadata: { any: 1 } }), true)

    assert.equal(isValidPhotoInput(''), false)
    assert.equal(isValidPhotoInput(null), false)
    assert.equal(isValidPhotoInput({}), false)
    assert.equal(isValidPhotoInput({ url: URL, sort_order: -1 }), false)
    assert.equal(isValidPhotoInput({ url: URL, is_main: 'yes' }), false)
    assert.equal(isValidPhotoInput({ url: URL, metadata: [] }), false)
})

test('isValidPhotoInput: F30 taken_at и note', () => {
    assert.equal(isValidPhotoInput({ url: URL, taken_at: '2026-10-20T09:00:00Z' }), true)
    assert.equal(isValidPhotoInput({ url: URL, taken_at: null }), true)
    assert.equal(isValidPhotoInput({ url: URL, note: 'Пересадила' }), true)
    assert.equal(isValidPhotoInput({ url: URL, note: null }), true)

    assert.equal(isValidPhotoInput({ url: URL, taken_at: 'не дата' }), false)
    assert.equal(isValidPhotoInput({ url: URL, taken_at: 123 }), false)
    assert.equal(isValidPhotoInput({ url: URL, note: 'я'.repeat(PLANT_PHOTO_NOTE_MAX_LENGTH + 1) }), false)
    assert.equal(isValidPhotoInput({ url: URL, note: 42 }), false)
})

test('isValidPhotoTakenAt / isValidPhotoNote: границы', () => {
    assert.equal(isValidPhotoTakenAt(undefined), true)
    assert.equal(isValidPhotoTakenAt(''), true)
    assert.equal(isValidPhotoTakenAt('2101-01-01T00:00:00Z'), false)
    assert.equal(isValidPhotoTakenAt('1999-12-31T00:00:00Z'), false)
    assert.equal(isValidPhotoNote('я'.repeat(PLANT_PHOTO_NOTE_MAX_LENGTH)), true)
    assert.equal(isValidPhotoNote(undefined), true)
})

test('photoTakenAtOf / photoNoteOf: нормализация', () => {
    const date = photoTakenAtOf({ taken_at: '2026-10-20T09:00:00Z' })
    assert.ok(date instanceof Date)
    assert.equal(date.toISOString(), '2026-10-20T09:00:00.000Z')
    assert.equal(photoTakenAtOf({ taken_at: '' }), null)
    assert.equal(photoTakenAtOf({}), null)
    assert.equal(photoTakenAtOf('строка'), null)

    assert.equal(photoNoteOf({ note: '  Пересадила  ' }), 'Пересадила')
    assert.equal(photoNoteOf({ note: '   ' }), null)
    assert.equal(photoNoteOf({}), null)
})

test('buildPlantPhotoRow: строка и объект с новыми полями', () => {
    const fromString = buildPlantPhotoRow(URL, { plantId: 5, index: 0, url: URL })
    assert.deepEqual(fromString, {
        plant_id: 5,
        url: URL,
        sort_order: 0,
        is_main: true,
        metadata: {},
        taken_at: null,
        note: null
    })

    const fromObject = buildPlantPhotoRow({
        url: URL,
        sort_order: 3,
        is_main: true,
        metadata: { source: 'gallery' },
        taken_at: '2026-10-20T09:00:00Z',
        note: 'Новый лист'
    }, { plantId: 7, index: 1, url: URL })

    assert.equal(fromObject.plant_id, 7)
    assert.equal(fromObject.sort_order, 3)
    assert.equal(fromObject.is_main, true)
    assert.deepEqual(fromObject.metadata, { source: 'gallery' })
    assert.equal(fromObject.taken_at.toISOString(), '2026-10-20T09:00:00.000Z')
    assert.equal(fromObject.note, 'Новый лист')

    const second = buildPlantPhotoRow({ url: URL }, { plantId: 7, index: 1, url: URL })
    assert.equal(second.is_main, false)
    assert.equal(second.sort_order, 1)
})

test('serializePlantPhoto: добавляет thumb_url, сохраняя существующие поля', () => {
    const serialized = serializePlantPhoto({
        id: 12,
        plant_id: 5,
        url: URL,
        is_main: true,
        created_at: '2026-10-20T09:00:00Z'
    }, { thumbUrl: 'https://example.test/uploads/thumbs/0123456789abcdef0123456789abcdef.thumb.jpg' })

    assert.equal(serialized.id, 12)
    assert.equal(serialized.url, URL)
    assert.equal(serialized.is_main, true)
    assert.equal(serialized.created_at, '2026-10-20T09:00:00Z')
    assert.match(serialized.thumb_url, /\.thumb\.jpg$/)
})

test('sortPlantPhotosForGallery: главное, затем дата съёмки (новые выше), затем sort_order/id', () => {
    const photos = [
        { id: 1, is_main: false, sort_order: 0, taken_at: '2026-09-01T09:00:00Z' },
        { id: 2, is_main: true, sort_order: 5, taken_at: null },
        { id: 3, is_main: false, sort_order: 1, taken_at: '2026-10-20T09:00:00Z' },
        { id: 4, is_main: false, sort_order: 2, taken_at: null }
    ]

    const sorted = sortPlantPhotosForGallery(photos)
    assert.deepEqual(sorted.map(photo => photo.id), [2, 3, 1, 4])
    assert.deepEqual(photos.map(photo => photo.id), [1, 2, 3, 4], 'входной массив не мутируется')
    assert.deepEqual(sortPlantPhotosForGallery([]), [])
})

test('pickNextMainPhoto: первое фото галереи или null', () => {
    assert.equal(pickNextMainPhoto([]), null)
    assert.equal(pickNextMainPhoto([{ id: 1, sort_order: 0 }])?.id, 1)
    assert.equal(pickNextMainPhoto([
        { id: 5, taken_at: '2026-09-01T09:00:00Z' },
        { id: 6, taken_at: '2026-10-01T09:00:00Z' }
    ])?.id, 6)
})
