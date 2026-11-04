import { describe, expect, it } from 'vitest'
import type { Meme } from '../../../shared/types'
import { byRecentUse, createSearch } from './search'

const meme = (id: string, fields: Partial<Meme>): Meme => ({
  id,
  ext: 'png',
  title: '',
  tags: [],
  addedAt: '2026-01-01T00:00:00.000Z',
  ...fields
})

const memes = [
  meme('drake', { title: 'Drake no yes', tags: ['drake', 'choice'] }),
  meme('cat', { title: 'Crying cat', tags: ['sad', 'cat'] }),
  meme('monday', { title: 'Office', ocrText: 'me on monday morning' })
]
const search = createSearch(memes)
const ids = (query: string): string[] => search(query).map((m) => m.id)

describe('createSearch', () => {
  it('returns every meme for an empty query', () => {
    expect(ids('  ')).toEqual(['drake', 'cat', 'monday'])
  })

  it('allows typos', () => {
    expect(ids('drkae')[0]).toBe('drake')
  })

  it('finds text read by OCR', () => {
    expect(ids('monday')).toEqual(['monday'])
  })

  it('ranks memes that match more words first', () => {
    expect(ids('sad cat drake')[0]).toBe('cat')
  })

  it('returns nothing when no word matches', () => {
    expect(ids('zzzz')).toEqual([])
  })
})

describe('byRecentUse', () => {
  it('puts the last used or added meme first', () => {
    const recent = byRecentUse([
      meme('old', { addedAt: '2026-01-01T00:00:00.000Z' }),
      meme('used', { addedAt: '2026-01-01T00:00:00.000Z', usedAt: '2026-03-01T00:00:00.000Z' }),
      meme('new', { addedAt: '2026-02-01T00:00:00.000Z' })
    ])
    expect(recent.map((m) => m.id)).toEqual(['used', 'new', 'old'])
  })
})
