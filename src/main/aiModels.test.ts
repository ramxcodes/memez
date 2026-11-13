import { describe, expect, it } from 'vitest'
import type { ProgressInfo } from '@huggingface/transformers'
import { pickTags, sumProgress, TAG_WORDS, titleFromCaption } from './aiModels'

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

describe('sumProgress', () => {
  const progress = (file: string, loaded: number, total: number): ProgressInfo => ({
    status: 'progress',
    name: 'repo',
    file,
    loaded,
    total,
    progress: (loaded / total) * 100
  })

  // The bug: the first small file finished and the 830 MB download read 100%.
  it('does not read 100% when only the first small file is done', () => {
    const seen: number[] = []
    const report = sumProgress((fraction) => seen.push(fraction), 1000)
    report(progress('config.json', 10, 10))
    expect(Math.max(...seen)).toBeCloseTo(0.01)
    report(progress('model.onnx', 500, 990))
    expect(seen.at(-1)).toBeCloseTo(0.51)
  })

  it('uses the real total when it is larger than expected', () => {
    const seen: number[] = []
    const report = sumProgress((fraction) => seen.push(fraction), 100)
    report(progress('model.onnx', 100, 400))
    expect(seen.at(-1)).toBe(0.25)
  })
})
