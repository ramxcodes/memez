import { describe, expect, it } from 'vitest'
import type { Meme } from '../../../shared/types'
import { byIds, inScope, kindCounts, matchesKind, scopeTitle } from './filter'

const meme = (id: string, fields: Partial<Meme> = {}): Meme => ({
  id,
  ext: 'png',
  title: '',
  tags: [],
  addedAt: '2026-01-01T00:00:00.000Z',
  ...fields
})

const memes = [
  meme('cat', { tags: ['cat'], usedAt: '2026-02-01T00:00:00.000Z' }),
  meme('loop', { ext: 'gif', tags: ['cat', 'dance'] }),
  meme('clip', { ext: 'mp4', tags: ['cat'], usedAt: '2026-03-01T00:00:00.000Z' }),
  meme('dog', { ext: 'webp', tags: ['dog'] })
]
const ids = (list: Meme[]): string[] => list.map((m) => m.id)

describe('inScope', () => {
  it('keeps only used memes for "Recently used", last used first', () => {
    expect(ids(inScope(memes, { by: 'recent' }))).toEqual(['clip', 'cat'])
  })

  it('keeps the memes with the tag', () => {
    expect(ids(inScope(memes, { by: 'tag', tag: 'cat' }))).toEqual(['cat', 'loop', 'clip'])
  })
})

describe('kind filter with a scope', () => {
  it('applies both: a tag and one kind', () => {
    const shown = inScope(memes, { by: 'tag', tag: 'cat' }).filter((m) => matchesKind(m, 'gif'))
    expect(ids(shown)).toEqual(['loop'])
  })

  it('counts each kind within the scope, so the capsules match the grid', () => {
    expect(kindCounts(inScope(memes, { by: 'tag', tag: 'cat' }))).toEqual({
      all: 3,
      image: 1,
      gif: 1,
      video: 1
    })
  })
})

describe('byIds', () => {
  it('keeps the order of the ids and drops ids that are not in the list', () => {
    expect(ids(byIds(memes, ['dog', 'gone', 'cat']))).toEqual(['dog', 'cat'])
  })
})

describe('scopeTitle', () => {
  it('capitalizes only the first letter of a tag', () => {
    expect(scopeTitle({ by: 'tag', tag: 'this is fine' })).toBe('This is fine')
  })
})
