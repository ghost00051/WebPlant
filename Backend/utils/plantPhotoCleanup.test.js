import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { cleanOrphanedPlantPhotoFiles } from './plantPhotoCleanup.js'

test('plant photo cleanup removes only old unreferenced upload files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'webplant-photos-'))
    const oldOrphan = `${'a'.repeat(32)}.jpg`
    const referenced = `${'b'.repeat(32)}.png`
    const recentOrphan = `${'c'.repeat(32)}.webp`
    const unrelated = 'notes.txt'
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000)

    try {
        await Promise.all([
            writeFile(path.join(directory, oldOrphan), 'orphan'),
            writeFile(path.join(directory, referenced), 'referenced'),
            writeFile(path.join(directory, recentOrphan), 'recent'),
            writeFile(path.join(directory, unrelated), 'unrelated')
        ])
        await utimes(path.join(directory, oldOrphan), oldDate, oldDate)
        await utimes(path.join(directory, referenced), oldDate, oldDate)

        const removed = await cleanOrphanedPlantPhotoFiles({
            directory,
            referencedUrls: [`/uploads/plants/${referenced}`]
        })

        assert.equal(removed, 1)
        assert.deepEqual((await readdir(directory)).sort(), [
            recentOrphan,
            referenced,
            unrelated
        ].sort())
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('plant photo cleanup requires a successful reference lookup', async () => {
    await assert.rejects(
        cleanOrphanedPlantPhotoFiles({ referencedUrls: null }),
        /referencedUrls must be an array/
    )
})
