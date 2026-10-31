import test from 'node:test'
import assert from 'node:assert/strict'

import {
    planBackfilledNextWatering,
    PlantController,
    serializePlantWithWateringState
} from './plantController.js'

const MSK = 'Europe/Moscow'
const NOW = new Date('2026-11-01T12:00:00Z')
const PHOTO_URL = 'https://api.example.com/uploads/plants/0123456789abcdef0123456789abcdef.jpg'
const PHOTO_PATH = '/uploads/plants/0123456789abcdef0123456789abcdef.jpg'
const DIAGNOSIS = {
    isPlant: true,
    plantName: 'Фикус',
    visibleSymptoms: ['жёлтые листья'],
    likelyProblems: [{ name: 'Перелив', confidence: 'medium', why: 'мокрый грунт' }],
    severity: 'medium',
    careAdvice: ['Проверьте дренаж'],
    photoQuality: 'fair',
    needsAnotherPhoto: false,
    summary: 'Похоже на перелив'
}

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

function createRequest(overrides = {}) {
    return {
        user: { id: 1, timezone: MSK },
        params: { id: '11' },
        body: {},
        protocol: 'https',
        get: header => (header === 'host' ? 'api.example.com' : undefined),
        ...overrides
    }
}

function createPlant({ metadata = { prediction: { intervalDays: 7 } } } = {}) {
    const updates = []
    return {
        id: 11,
        user_id: 1,
        name: 'Фикус',
        location: 'Кухня',
        metadata,
        updates,
        async update(values) {
            updates.push(values)
            Object.assign(this, values)
        }
    }
}

function createPhoto({ metadata = { taken_by: 'user' } } = {}) {
    const updates = []
    return {
        id: 5,
        plant_id: 11,
        url: PHOTO_URL,
        metadata,
        updates,
        async update(values) {
            updates.push(values)
            Object.assign(this, values)
        },
        async destroy() {
            this.destroyed = true
        }
    }
}

function createController(overrides = {}) {
    const state = {
        analyzeCalls: [],
        speciesCalls: [],
        speciesAdviceCalls: [],
        photoFindOneCalls: [],
        photoCountCalls: [],
        plantFindOneCalls: [],
        removeCalls: []
    }

    const models = {
        Plant: {
            async findOne(options) {
                state.plantFindOneCalls.push(options)
                if (typeof overrides.findOnePlant === 'function') return overrides.findOnePlant(options)
                return overrides.plant ?? createPlant()
            }
        },
        PlantPhoto: {
            async findOne(options) {
                state.photoFindOneCalls.push(options)
                if (typeof overrides.findOnePhoto === 'function') return overrides.findOnePhoto(options)
                return overrides.photo ?? null
            },
            async count(options) {
                state.photoCountCalls.push(options)
                if (typeof overrides.countPhotos === 'function') return overrides.countPhotos(options)
                return overrides.photosCount ?? 0
            },
            async findAll() {
                return overrides.remainingPhotos ?? []
            },
            async update() {
                return [1]
            },
            async bulkCreate(rows) {
                return rows
            }
        }
    }

    const services = {
        analyzePlantPhoto: async args => {
            state.analyzeCalls.push(args)
            if (typeof overrides.analyze === 'function') return overrides.analyze(args)
            return {
                text: 'Разбор здоровья',
                diagnosis: DIAGNOSIS,
                source: 'ai',
                latencyMs: 12
            }
        },
        suggestSpeciesFromPhoto: async args => {
            state.speciesCalls.push(args)
            if (typeof overrides.suggestSpecies === 'function') return overrides.suggestSpecies(args)
            return { suggestions: [{ name: 'Фикус', species: 'Ficus elastica' }], isPlant: true, source: 'ai' }
        },
        logAiAdvice: entry => {
            state.speciesAdviceCalls.push(entry)
            return null
        },
        readPlantPhotoBuffer: async photoPath => {
            state.readCalls = state.readCalls || []
            state.readCalls.push(photoPath)
            if (typeof overrides.readPhoto === 'function') return overrides.readPhoto(photoPath)
            return Buffer.from('image-bytes')
        },
        removePlantPhotoFiles: async () => 1,
        removePlantPhotoFilesIfUnreferenced: async (url, { countReferences }) => {
            const references = await countReferences(url)
            state.removeCalls.push({ url, references })
            return references > 0
                ? { removed: 0, skipped: true, references }
                : { removed: 1, skipped: false, references: 0 }
        }
    }

    return {
        controller: new PlantController({ models, services }),
        state
    }
}

test('healthCheck (JSON photoUrl): 200, сохраняет health_check и diagnosis в metadata фото', async () => {
    const plant = createPlant()
    const photo = createPhoto()
    const { controller, state } = createController({ plant, photo })

    const res = createResponse()
    await controller.healthCheck(
        createRequest({ body: { photoUrl: PHOTO_URL, question: '  Что с ним?  ' } }),
        res
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(Object.keys(res.body).sort(), [
        'createdAt',
        'diagnosis',
        'photoUrl',
        'saved',
        'text'
    ])
    assert.equal(res.body.saved, true)
    assert.equal(res.body.photoUrl, PHOTO_URL)
    assert.equal(res.body.text, 'Разбор здоровья')
    assert.equal(res.body.diagnosis.plantName, 'Фикус')

    assert.equal(state.analyzeCalls.length, 1)
    assert.deepEqual(state.analyzeCalls[0].imageBuffers, [Buffer.from('image-bytes')])
    assert.equal(state.analyzeCalls[0].question, 'Что с ним?')
    assert.equal(state.analyzeCalls[0].plantName, 'Фикус')
    assert.equal(state.analyzeCalls[0].timeZone, MSK)
    assert.equal(state.readCalls[0], PHOTO_PATH)

    assert.equal(plant.updates.length, 1)
    const metadata = plant.updates[0].metadata
    assert.deepEqual(metadata.prediction, { intervalDays: 7 }, 'остальные metadata не затёрты')
    assert.deepEqual(
        Object.keys(metadata.health_check).sort(),
        ['createdAt', 'diagnosis', 'photoUrl', 'text']
    )
    assert.equal(metadata.health_check.photoUrl, PHOTO_URL)
    assert.equal(metadata.health_check.createdAt, res.body.createdAt)

    assert.equal(state.photoFindOneCalls.length, 1)
    assert.deepEqual(state.photoFindOneCalls[0].where, { plant_id: 11, url: PHOTO_URL })
    assert.equal(photo.updates.length, 1)
    assert.equal(photo.updates[0].metadata.taken_by, 'user', 'metadata фото смёржена, а не затёрта')
    assert.equal(photo.updates[0].metadata.diagnosis.plantName, 'Фикус')
    assert.equal(photo.updates[0].metadata.diagnosis_text, 'Разбор здоровья')
})

test('healthCheck (multipart): 200, анализ по buffer, photoUrl пустой и фото не ищется', async () => {
    const plant = createPlant()
    const { controller, state } = createController({ plant })

    const res = createResponse()
    await controller.healthCheck(
        createRequest({ files: [{ buffer: Buffer.from('uploaded') }], body: { question: 'Проверь' } }),
        res
    )

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.saved, true)
    assert.equal(res.body.photoUrl, '')
    assert.deepEqual(state.analyzeCalls[0].imageBuffers, [Buffer.from('uploaded')])
    assert.equal(state.photoFindOneCalls.length, 0)
    assert.equal(plant.updates.length, 1)
})

test('healthCheck: «на фото не растение» — 200 и isPlant:false в сохранённом диагнозе', async () => {
    const plant = createPlant()
    const { controller } = createController({
        plant,
        analyze: () => ({
            text: 'На фото не удалось разглядеть растение',
            diagnosis: { isPlant: false, plantName: null, visibleSymptoms: [], likelyProblems: [], severity: 'unknown', careAdvice: [], photoQuality: 'bad', needsAnotherPhoto: true, summary: 'Это не растение' },
            source: 'ai'
        })
    })

    const res = createResponse()
    await controller.healthCheck(createRequest({ body: { photoUrl: PHOTO_URL } }), res)

    assert.equal(res.statusCode, 200)
    assert.equal(res.body.diagnosis.isPlant, false)
    assert.equal(plant.updates[0].metadata.health_check.diagnosis.isPlant, false)
})

test('healthCheck: 400 на отсутствующий photoUrl, чужой формат, несуществующий файл и вопрос-не-строку', async () => {
    const { controller } = createController({})

    for (const body of [
        {},
        { photoUrl: '' },
        { photoUrl: 'https://evil.example.com/uploads/plants/not-a-hash.jpg' },
        { photoUrl: PHOTO_URL, question: 42 }
    ]) {
        const res = createResponse()
        await controller.healthCheck(createRequest({ body }), res)
        assert.equal(res.statusCode, 400, JSON.stringify(body))
    }

    const missing = createController({
        readPhoto: () => {
            const error = new Error('not found')
            error.code = 'ENOENT'
            throw error
        }
    })
    const missingRes = createResponse()
    await missing.controller.healthCheck(createRequest({ body: { photoUrl: PHOTO_URL } }), missingRes)
    assert.equal(missingRes.statusCode, 400)
    assert.match(missingRes.body.message, /предварительно загружена/)
})

test('healthCheck: 404 для чужого растения, 401 без пользователя', async () => {
    const foreign = createController({ findOnePlant: () => null })
    const foreignRes = createResponse()
    await foreign.controller.healthCheck(createRequest({ body: { photoUrl: PHOTO_URL } }), foreignRes)
    assert.equal(foreignRes.statusCode, 404)
    assert.match(foreignRes.body.message, /не найдено/)

    const anonymous = createResponse()
    await foreign.controller.healthCheck(createRequest({ user: null, body: { photoUrl: PHOTO_URL } }), anonymous)
    assert.equal(anonymous.statusCode, 401)
})

test('healthCheck: битое изображение -> 400, недоступность ИИ -> 503, прочее -> 500', async () => {
    const cases = [
        { code: 'AI_VISION_UNSUPPORTED_IMAGE', status: 400 },
        { code: 'AI_VISION_NO_IMAGE', status: 400 },
        { code: 'AI_VISION_NOT_CONFIGURED', status: 503 },
        { code: 'AI_VISION_UNAVAILABLE', status: 503 },
        { code: 'AI_VISION_FAILED', status: 503 },
        { code: 'AI_BUDGET_EXCEEDED', status: 503 },
        { code: 'UNEXPECTED', status: 500 }
    ]

    for (const item of cases) {
        const { controller } = createController({
            analyze: () => {
                const error = new Error('ai error')
                error.code = item.code
                throw error
            }
        })
        const res = createResponse()
        await controller.healthCheck(createRequest({ body: { photoUrl: PHOTO_URL } }), res)
        assert.equal(res.statusCode, item.status, item.code)
        assert.equal(typeof res.body.message, 'string')
    }
})

test('healthCheck: ошибка сохранения растения -> 500', async () => {
    const plant = createPlant()
    plant.update = async () => {
        throw new Error('db down')
    }
    const { controller } = createController({ plant })

    const res = createResponse()
    await controller.healthCheck(createRequest({ body: { photoUrl: PHOTO_URL } }), res)
    assert.equal(res.statusCode, 500)
})

test('BE-06 deletePhoto: файл удаляется только при 0 ссылок на url', async () => {
    const referenced = createController({ photo: createPhoto(), photosCount: 1 })
    const referencedPhoto = await referenced.controller.models.PlantPhoto.findOne()
    const referencedRes = createResponse()
    await referenced.controller.deletePhoto(
        createRequest({ params: { id: '11', photoId: '5' } }),
        referencedRes
    )
    assert.equal(referencedRes.statusCode, 200)
    assert.equal(referencedPhoto.destroyed, true)
    assert.equal(referenced.state.photoCountCalls.length, 1)
    assert.deepEqual(referenced.state.photoCountCalls[0].where, { url: PHOTO_URL })
    assert.deepEqual(referenced.state.removeCalls, [{ url: PHOTO_URL, references: 1 }])

    const unreferenced = createController({ photo: createPhoto(), photosCount: 0 })
    const unreferencedRes = createResponse()
    await unreferenced.controller.deletePhoto(
        createRequest({ params: { id: '11', photoId: '5' } }),
        unreferencedRes
    )
    assert.equal(unreferencedRes.statusCode, 200)
    assert.deepEqual(unreferenced.state.removeCalls, [{ url: PHOTO_URL, references: 0 }])
})

test('BE-06 deletePhoto: при удалении главного назначается следующее фото, 404 без фото', async () => {
    const photo = createPhoto()
    photo.is_main = true
    const next = { is_main: false, async update(values) { this.updated = values } }
    const { controller } = createController({
        photo,
        remainingPhotos: [next],
        countPhotos: () => 0
    })

    const res = createResponse()
    await controller.deletePhoto(createRequest({ params: { id: '11', photoId: '5' } }), res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(next.updated, { is_main: true })

    const missing = createController({ photo: null })
    const missingRes = createResponse()
    await missing.controller.deletePhoto(createRequest({ params: { id: '11', photoId: '5' } }), missingRes)
    assert.equal(missingRes.statusCode, 404)
    assert.match(missingRes.body.message, /Фотография не найдена/)
})

test('BE-13 addPhotos: 400 при превышении PLANT_PHOTO_GALLERY_MAX', async () => {
    const { controller, state } = createController({ photosCount: 200 })
    const res = createResponse()
    await controller.addPhotos(
        createRequest({ body: { photos: [PHOTO_URL] } }),
        res
    )

    assert.equal(res.statusCode, 400)
    assert.match(res.body.message, /200/)
    assert.deepEqual(state.photoCountCalls[0].where, { plant_id: 11 })
})

test('BE-13 addPhotos: 404 для чужого растения', async () => {
    const { controller } = createController({ findOnePlant: () => null })
    const res = createResponse()
    await controller.addPhotos(createRequest({ body: { photos: [PHOTO_URL] } }), res)
    assert.equal(res.statusCode, 404)
})

test('BE-11 suggestSpeciesFromPhoto: 400 для битого изображения, 503 для недоступности ИИ', async () => {
    const cases = [
        { code: 'AI_VISION_UNSUPPORTED_IMAGE', status: 400 },
        { code: 'AI_VISION_FAILED', status: 503 },
        { code: 'AI_VISION_NOT_CONFIGURED', status: 503 },
        { code: 'UNEXPECTED', status: 500 }
    ]

    for (const item of cases) {
        const { controller } = createController({
            suggestSpecies: () => {
                const error = new Error('vision error')
                error.code = item.code
                throw error
            }
        })
        const res = createResponse()
        await controller.suggestSpeciesFromPhoto(
            createRequest({ files: [{ buffer: Buffer.from('img') }], body: {} }),
            res
        )
        assert.equal(res.statusCode, item.status, item.code)
    }
})

test('suggestSpeciesFromPhoto: успех возвращает suggestions и пишет журнал ИИ', async () => {
    const { controller, state } = createController({})
    const res = createResponse()
    await controller.suggestSpeciesFromPhoto(
        createRequest({ files: [{ buffer: Buffer.from('img') }], body: {} }),
        res
    )

    assert.equal(res.statusCode, 200)
    assert.deepEqual(res.body.suggestions, [{ name: 'Фикус', species: 'Ficus elastica' }])
    assert.equal(state.speciesAdviceCalls.length, 1)
    assert.equal(state.speciesAdviceCalls[0].kind, 'species')
})

test('serializePlantWithWateringState: GET /plants и /plants/:id отдают metadata.health_check', () => {
    const check = {
        text: 'Разбор',
        diagnosis: DIAGNOSIS,
        photoUrl: PHOTO_URL,
        createdAt: '2026-11-01T09:00:00.000Z'
    }
    const serialized = serializePlantWithWateringState({
        id: 11,
        name: 'Фикус',
        watering_interval_days: 7,
        watering_time_of_day: 'morning',
        next_watering_at: '2026-11-05T06:00:00Z',
        metadata: { health_check: check, prediction: { intervalDays: 7 } },
        photos: [{ url: PHOTO_URL, toJSON: () => ({ url: PHOTO_URL }) }]
    }, { now: NOW, timeZone: MSK, policy: 'preserve' })

    assert.deepEqual(serialized.metadata.health_check, check)
    assert.deepEqual(serialized.metadata.prediction, { intervalDays: 7 })
    assert.equal(serialized.watering_state.status, 'scheduled')
    assert.ok(serialized.photos[0].thumb_url !== undefined)
})

test('serializePlantWithWateringState: BE-07 overdue проставляется в watering_state', () => {
    const serialized = serializePlantWithWateringState({
        id: 12,
        name: 'Кактус',
        watering_interval_days: 7,
        watering_time_of_day: 'morning',
        next_watering_at: '2026-11-01T06:00:00Z',
        metadata: {}
    }, {
        now: new Date('2026-11-02T05:00:00Z'),
        timeZone: MSK,
        policy: 'preserve'
    })

    assert.equal(serialized.watering_state.overdue, true)
    assert.equal(serialized.watering_state.status, 'missed')
    assert.equal(serialized.watering_state.missed, true)
})

test('water slotInput: поздняя отметка доводит next_watering_at до будущего слота', () => {
    const now = new Date('2026-10-30T17:26:00.000Z') // 30 октября, 20:26 MSK
    const slot = new Date('2026-10-29T11:00:00.000Z') // 29 октября, 14:00 MSK — пропущенный слот

    const next = planBackfilledNextWatering({
        actionAt: slot,
        previousNext: slot,
        intervalDays: 1,
        timeOfDay: 'day',
        timeZone: MSK,
        now
    })

    assert.equal(next.toISOString(), '2026-10-31T11:00:00.000Z')
    assert.ok(next.getTime() > now.getTime())
})

test('water slotInput: будущий план сохраняется, прошлый сдвигается по интервалу', () => {
    const now = new Date('2026-10-30T17:26:00.000Z')

    const future = planBackfilledNextWatering({
        actionAt: new Date('2026-10-28T11:00:00.000Z'),
        previousNext: new Date('2026-10-28T11:00:00.000Z'),
        intervalDays: 7,
        timeOfDay: 'day',
        timeZone: MSK,
        now
    })
    assert.equal(future.toISOString(), '2026-11-04T11:00:00.000Z')

    const kept = planBackfilledNextWatering({
        actionAt: new Date('2026-10-28T11:00:00.000Z'),
        previousNext: new Date('2026-11-10T11:00:00.000Z'),
        intervalDays: 7,
        timeOfDay: 'day',
        timeZone: MSK,
        now
    })
    assert.equal(kept.toISOString(), '2026-11-10T11:00:00.000Z')

    const daily = planBackfilledNextWatering({
        actionAt: new Date('2026-10-30T11:00:00.000Z'),
        previousNext: new Date('2026-10-29T11:00:00.000Z'),
        intervalDays: 1,
        timeOfDay: 'day',
        timeZone: MSK,
        now
    })
    assert.equal(daily.toISOString(), '2026-10-31T11:00:00.000Z')
})

test('water slotInput: некорректные данные не создают план', () => {
    assert.equal(planBackfilledNextWatering({ actionAt: null, intervalDays: 1 }), null)
    assert.equal(planBackfilledNextWatering({ actionAt: 'не дата', intervalDays: 1 }), null)
    assert.equal(planBackfilledNextWatering({ actionAt: new Date('2026-10-29T11:00:00Z'), intervalDays: 0 }), null)
    assert.equal(planBackfilledNextWatering({}), null)
})
