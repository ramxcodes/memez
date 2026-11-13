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

  it('marks who wrote the title, and re-tag replaces only AI titles', async () => {
    const library = await openLibrary(await tempDir())
    const ai = (await library.add(png(1))).meme
    const typed = (await library.add(png(2))).meme
    await library.applyAutoTags(ai.id, { title: 'Cat on a table', tags: [] })
    await library.update(typed.id, { title: 'mine' })
    expect(library.get(ai.id).titleSource).toBe('ai')
    expect(library.get(typed.id).titleSource).toBe('user')

    const retag = { title: 'Cat on a chair', tags: [] }
    await library.applyAutoTags(ai.id, retag, 'retag')
    await library.applyAutoTags(typed.id, retag, 'retag')
    expect(library.get(ai.id)).toMatchObject({ title: 'Cat on a chair', titleSource: 'ai' })
    expect(library.get(typed.id)).toMatchObject({ title: 'mine', titleSource: 'user' })

    // Clearing the title clears its source, so the AI may fill it again.
    await library.update(typed.id, { title: ' ' })
    expect(library.get(typed.id).titleSource).toBeUndefined()
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

describe('tag rename and delete', () => {
  const tagged = async (...tagLists: string[][]): ReturnType<typeof openLibrary> => {
    const library = await openLibrary(await tempDir())
    for (const [seed, tags] of tagLists.entries()) await library.add(png(seed), { tags })
    return library
  }
  const allTags = (library: Awaited<ReturnType<typeof openLibrary>>): string[][] =>
    library.list().map((meme) => meme.tags)

  it('renames a tag on every meme and saves it', async () => {
    const root = await tempDir()
    const library = await openLibrary(root)
    await library.add(png(1), { tags: ['sad', 'cat'] })
    await library.add(png(2), { tags: ['sad'] })
    await library.renameTag('Sad', ' #Crying ')

    expect(allTags(library)).toEqual([['crying'], ['crying', 'cat']])
    expect(allTags(await openLibrary(root))).toEqual(allTags(library))
  })

  it('merges into an existing tag without duplicates', async () => {
    const library = await tagged(['sad', 'cat', 'crying'])
    await library.renameTag('sad', 'crying')

    expect(allTags(library)).toEqual([['crying', 'cat']])
  })

  it('does nothing and does not save for an unknown tag', async () => {
    const root = await tempDir()
    const library = await openLibrary(root)
    await library.renameTag('nope', 'other')
    await library.deleteTag('nope')

    await expect(readFile(join(root, 'library.json'))).rejects.toThrow('ENOENT')
  })

  it('refuses an empty new name', async () => {
    const library = await tagged(['sad'])
    await expect(library.renameTag('sad', ' # ')).rejects.toThrow('A tag needs a name.')
    expect(allTags(library)).toEqual([['sad']])
  })

  it('deletes a tag from every meme', async () => {
    const library = await tagged(['sad', 'cat'], ['sad'])
    await library.deleteTag('#SAD')

    expect(allTags(library)).toEqual([[], ['cat']])
  })
})
