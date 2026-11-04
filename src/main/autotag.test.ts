import { describe, expect, it } from 'vitest'
import { pickTags, TAG_WORDS, titleFromCaption } from './autotag'

/** Scores with `word: score` set and every other word at 0. */
const scores = (set: Record<string, number>): number[] => TAG_WORDS.map((word) => set[word] ?? 0)

describe('titleFromCaption', () => {
  it('drops the leading article and the final period', () => {
    expect(titleFromCaption('A cartoon of a dog with a caption.')).toBe(
      'Cartoon of a dog with a caption'
    )
    expect(titleFromCaption('  an old man waving  ')).toBe('Old man waving')
  })
})

describe('pickTags', () => {
  it('keeps model words above the cut-off, best first, at most four', () => {
    const tags = pickTags(
      scores({ drake: 0.5, choice: 0.2, fire: 0.1, smug: 0.09, sad: 0.08, cat: 0.06 }),
      ''
    )
    expect(tags).toEqual(['drake', 'choice', 'fire', 'smug'])
  })

  it('adds list words named in the caption, plural or not', () => {
    const tags = pickTags(scores({}), 'Two women are making funny faces with cats. Thumbs up!')
    expect(tags).toEqual(['cat', 'woman', 'thumbs up'])
  })

  it('does not match a word inside another word', () => {
    expect(pickTags(scores({}), 'A scattered carpet')).toEqual([])
  })
})
