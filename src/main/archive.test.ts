import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { exportZip, importZip } from './archive'
import { openLibrary } from './library'

const png = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed])

const newLibrary = async (): ReturnType<typeof openLibrary> =>
  openLibrary(await mkdtemp(join(tmpdir(), 'memez-')))

describe('zip export and import', () => {
  it('copies memes, tags, OCR text and the AI-done mark to another library', async () => {
    const source = await newLibrary()
    const { meme } = await source.add(png(1), { title: 'cat', tags: ['sad'] })
    await source.setOcrText(meme.id, 'when monday')
    await source.applyAutoTags(meme.id, { title: 'ignored', tags: [] })

    const target = await newLibrary()
    const result = await importZip(target, await exportZip(source))

    expect(result).toEqual({ added: 1, merged: 0, skipped: 0 })
    expect(target.list()).toEqual([
      expect.objectContaining({
        title: 'cat',
        tags: ['sad'],
        ocrText: 'when monday',
        autoTagged: true
      })
    ])
  })

  it('merges tags into memes that already exist', async () => {
    const source = await newLibrary()
    await source.add(png(1), { title: 'from zip', tags: ['zip'] })
    const target = await newLibrary()
    await target.add(png(1), { title: 'local', tags: ['local'] })

    const result = await importZip(target, await exportZip(source))

    expect(result).toEqual({ added: 0, merged: 1, skipped: 0 })
    expect(target.list()[0]).toMatchObject({ title: 'local', tags: ['local', 'zip'] })
  })

  it('counts entries with a missing file as skipped', async () => {
    const memes = [{ id: 'a'.repeat(16), ext: 'png', title: '', tags: [] }]
    const zip = zipSync({ 'library.json': strToU8(JSON.stringify({ version: 1, memes })) })

    expect(await importZip(await newLibrary(), zip)).toEqual({ added: 0, merged: 0, skipped: 1 })
  })

  it('rejects a zip that is not a Memez export', async () => {
    const zip = zipSync({ 'other.txt': strToU8('hi') })
    await expect(importZip(await newLibrary(), zip)).rejects.toThrow('not a Memez export')
  })
})
