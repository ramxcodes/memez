import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openLibrary } from './library'
import { sniffExt } from './media'

const png = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed])
const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'memez-'))

describe('sniffExt', () => {
  it('detects each supported type from its bytes', () => {
    const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0))
    expect(sniffExt(png(1))).toBe('png')
    expect(sniffExt(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(sniffExt(new Uint8Array(ascii('GIF89a')))).toBe('gif')
    expect(sniffExt(new Uint8Array(ascii('RIFF\0\0\0\0WEBPVP8 ')))).toBe('webp')
    expect(sniffExt(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm')
    expect(sniffExt(new Uint8Array([0, 0, 0, 0x20, ...ascii('ftypisom')]))).toBe('mp4')
    expect(sniffExt(new Uint8Array(ascii('<html>')))).toBeNull()
  })
})

describe('openLibrary', () => {
  it('stores a meme and reloads it from disk', async () => {
    const root = await tempDir()
    const library = await openLibrary(root)
    const { meme } = await library.add(png(1), { title: ' Drake ', tags: ['#No', 'yes', 'no'] })

    expect(meme).toMatchObject({ ext: 'png', title: 'Drake', tags: ['no', 'yes'] })
    expect(await readdir(join(root, 'media'))).toEqual([`${meme.id}.png`])
    expect((await openLibrary(root)).list()).toEqual([meme])
  })

  it('merges a duplicate file instead of storing it twice', async () => {
    const library = await openLibrary(await tempDir())
    await library.add(png(1), { title: 'first', tags: ['a'] })
    const result = await library.add(png(1), { title: 'second', tags: ['b'] })

    expect(result.duplicate).toBe(true)
    expect(result.meme).toMatchObject({ title: 'first', tags: ['a', 'b'] })
    expect(library.list()).toHaveLength(1)
  })

  it('rejects unsupported files', async () => {
    const library = await openLibrary(await tempDir())
    await expect(library.add(new TextEncoder().encode('hello'))).rejects.toThrow('Unsupported')
  })

  it('throws on a corrupt library.json instead of starting empty', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'library.json'), '{ broken')
    await expect(openLibrary(root)).rejects.toThrow()
    expect(await readFile(join(root, 'library.json'), 'utf8')).toBe('{ broken')
  })

  it('adds AI tags without changing a title the user typed', async () => {
    const library = await openLibrary(await tempDir())
    const { meme } = await library.add(png(1), { title: 'mine', tags: ['typed'] })
    await library.applyAutoTags(meme.id, { title: 'Cat on a table', tags: ['cat', 'typed'] })

    expect(library.get(meme.id)).toMatchObject({
      title: 'mine',
      tags: ['typed', 'cat'],
      autoTagged: true
    })
  })

  it('fills an empty title from the AI', async () => {
    const library = await openLibrary(await tempDir())
    const { meme } = await library.add(png(1))
    await library.applyAutoTags(meme.id, { title: 'Cat on a table', tags: [] })

    expect(library.get(meme.id).title).toBe('Cat on a table')
  })

  it('ignores AI tags for a meme deleted while the model ran', async () => {
    const library = await openLibrary(await tempDir())
    const { meme } = await library.add(png(1))
    await library.remove(meme.id)

    await expect(library.applyAutoTags(meme.id, { title: 'x', tags: [] })).resolves.toBeUndefined()
    expect(library.list()).toEqual([])
  })

  it('removes the meme and its file', async () => {
    const root = await tempDir()
    const library = await openLibrary(root)
    const { meme } = await library.add(png(1))
    await library.remove(meme.id)

    expect(library.list()).toEqual([])
    expect(await readdir(join(root, 'media'))).toEqual([])
  })
})
