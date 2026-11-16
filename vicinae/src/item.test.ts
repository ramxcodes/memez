import { describe, expect, it } from 'vitest'
import { kindSubtitle, memeCount, sectionTitle } from './item'

describe('grid item text', () => {
  it('names the kind in words, and nothing for still images', () => {
    expect(kindSubtitle({ ext: 'png' })).toBeUndefined()
    expect(kindSubtitle({ ext: 'gif' })).toBe('Animated')
    expect(kindSubtitle({ ext: 'webm' })).toBe('Video')
  })

  it('shows recent memes before the user types', () => {
    expect(sectionTitle('  ')).toBe('Recently used')
    expect(sectionTitle('cat')).toBe('Results')
  })

  it('counts memes', () => {
    expect([memeCount(1), memeCount(128)]).toEqual(['1 meme', '128 memes'])
  })
})
