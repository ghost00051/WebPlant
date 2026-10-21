import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    collectChatPhotoUrls,
    removeChatPhotoFiles
} from './chatPhoto.js'

const CHAT_PHOTO = 'a'.repeat(32) + '.jpg'
const CHAT_PHOTO_URL = `https://server.checktheplants.ru/uploads/chat/${CHAT_PHOTO}`
const SECOND_PHOTO_URL = `https://server.checktheplants.ru/uploads/chat/${'b'.repeat(32)}.jpg`

test('collectChatPhotoUrls: берёт только uploads/chat из metadata, без дублей и мусора', () => {
    const urls = collectChatPhotoUrls([
        {
            metadata: {
                photoUrl: CHAT_PHOTO_URL,
                photoUrls: [CHAT_PHOTO_URL, SECOND_PHOTO_URL]
            }
        },
        { metadata: { photoUrl: SECOND_PHOTO_URL } },
        { metadata: { photoUrl: `https://server.checktheplants.ru/uploads/plants/${CHAT_PHOTO}` } },
        { metadata: { photoUrl: 'https://server.checktheplants.ru/uploads/chat/../../secret.jpg' } },
        { metadata: { photoUrl: 'not a url' } },
        { metadata: null },
        {}
    ])

    assert.deepEqual(urls, [CHAT_PHOTO_URL, SECOND_PHOTO_URL])
})

test('collectChatPhotoUrls: пустой вход не ломает сбор', () => {
    assert.deepEqual(collectChatPhotoUrls([]), [])
    assert.deepEqual(collectChatPhotoUrls(null), [])
    assert.deepEqual(collectChatPhotoUrls(undefined), [])
})

test('removeChatPhotoFiles: удаляет только allowlist-файлы в uploads/chat', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webplant-chat-photo-'))
    try {
        await writeFile(path.join(directory, CHAT_PHOTO), 'photo')
        await writeFile(path.join(directory, 'keep.txt'), 'keep')

        const removed = await removeChatPhotoFiles([
            CHAT_PHOTO_URL,
            'https://server.checktheplants.ru/uploads/chat/../../keep.txt',
            `https://server.checktheplants.ru/uploads/plants/${CHAT_PHOTO}`
        ], { directory })

        assert.equal(removed, 1, 'удалён только файл из uploads/chat')
        assert.deepEqual(await readdir(directory), ['keep.txt'], 'чужие файлы не тронуты')
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('removeChatPhotoFiles: отсутствующий файл не считается ошибкой', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webplant-chat-photo-'))
    try {
        assert.equal(await removeChatPhotoFiles([CHAT_PHOTO_URL], { directory }), 0)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
