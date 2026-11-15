import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// The plugin's search runs in the Omarchy shell's JS engine, so it is a plain script that exports
// with `module.exports` only when a CommonJS loader is there.
const search = createRequire(import.meta.url)('./MemezSearch.js')

const meme = (id: string, fields: Record<string, unknown> = {}) => ({
  id: id.padStart(16, '0'),
  ext: 'png',
  title: '',
  tags: [],
  addedAt: '2026-01-01T00:00:00.000Z',
  ...fields
})
const library = (...memes: unknown[]) => JSON.stringify({ version: 1, memes })
const ids = (memes: { id: string }[]) => memes.map((m) => m.id.replace(/^0+/, ''))

describe('parseLibrary', () => {
  it('keeps valid memes and drops bad entries', () => {
    const raw = library(
      meme('a1', { title: 'Sad cat', tags: ['Cat', ' sad ', 3] }),
      meme('../../etc/passwd'),
      { ...meme('b2'), ext: 'exe' },
      null
    )
    const memes = search.parseLibrary(raw)
    expect(ids(memes)).toEqual(['a1'])
    expect(memes[0].tags).toEqual(['cat', 'sad'])
  })

  it('bounds long strings', () => {
    const [parsed] = search.parseLibrary(library(meme('a1', { title: 'x'.repeat(5000) })))
    expect(parsed.title).toHaveLength(200)
  })

  it('throws on a file that is not a library, so the overlay can say so', () => {
    expect(() => search.parseLibrary('{"nope":1}')).toThrow()
    expect(() => search.parseLibrary('not json')).toThrow()
  })
})

describe('recent memes', () => {
  it('reads only valid ids and times', () => {
    const recent = search.parseRecent(
      JSON.stringify({
        '00000000000000a1': '2026-02-01T00:00:00.000Z',
        bad: 'x',
        '00000000000000b2': 7
      })
    )
    expect(recent).toEqual({ '00000000000000a1': '2026-02-01T00:00:00.000Z' })
    expect(search.parseRecent('garbage')).toEqual({})
  })

  it('puts the last pasted meme first, before newer additions', () => {
    const memes = search.parseLibrary(
      library(
        meme('a1', { addedAt: '2026-01-01T00:00:00.000Z' }),
        meme('b2', { addedAt: '2026-03-01T00:00:00.000Z' })
      )
    )
    const recent = search.recordUse({}, '00000000000000a1', '2026-04-01T00:00:00.000Z')
    expect(ids(search.search(memes, '', recent))).toEqual(['a1', 'b2'])
    expect(ids(search.search(memes, '', {}))).toEqual(['b2', 'a1'])
  })
})

describe('search', () => {
  const memes = search.parseLibrary(
    library(
      meme('a1', { title: 'Crying cat', tags: ['cat', 'sad'] }),
      meme('b2', { title: 'Money printer', tags: ['money'] }),
      meme('c3', { title: 'Stonks', tags: ['money', 'stocks'], ocrText: 'number go up' }),
      meme('d4', { title: 'This is fine', tags: ['fire'] })
    )
  )

  it('matches tags, titles and text in the image', () => {
    expect(ids(search.search(memes, 'fire', {}))).toEqual(['d4'])
    expect(ids(search.search(memes, 'printer', {}))).toEqual(['b2'])
    expect(ids(search.search(memes, 'number', {}))).toEqual(['c3'])
  })

  it('ranks memes that match more words first', () => {
    expect(ids(search.search(memes, 'money stonks', {}))[0]).toBe('c3')
  })

  it('forgives small typos and matches prefixes', () => {
    expect(ids(search.search(memes, 'mony', {}))).toContain('b2')
    expect(ids(search.search(memes, 'cryng', {}))).toEqual(['a1'])
    expect(ids(search.search(memes, 'pri', {}))).toEqual(['b2'])
  })

  it('finds nothing for unrelated words', () => {
    expect(search.search(memes, 'zebra', {})).toEqual([])
  })
})

describe('parseConfigRoot', () => {
  it('accepts an absolute library folder', () => {
    expect(search.parseConfigRoot('{"libraryRoot":"/home/me/Memes/"}')).toBe('/home/me/Memes')
  })

  it('ignores anything else', () => {
    expect(search.parseConfigRoot('{"libraryRoot":"relative"}')).toBe('')
    expect(search.parseConfigRoot('{"libraryRoot":"/a\\nb"}')).toBe('')
    expect(search.parseConfigRoot('{}')).toBe('')
    expect(search.parseConfigRoot('nope')).toBe('')
  })
})
