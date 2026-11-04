import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openVectors, pickMatches } from './semantic'

const scores = (values: Record<string, number>): { id: string; score: number }[] =>
  Object.entries(values).map(([id, score]) => ({ id, score }))

describe('pickMatches', () => {
  it('keeps memes clearly above the median and near the best, best first', () => {
    // Real CLIP scores for "crying" from our test library.
    const ids = pickMatches(
      scores({ pikachu: 0.249, cat: 0.26, yell: 0.243, a: 0.223, b: 0.22, c: 0.221, d: 0.218 })
    )
    expect(ids).toEqual(['cat', 'pikachu'])
  })

  it('finds nothing when no meme stands out', () => {
    expect(pickMatches(scores({ a: 0.23, b: 0.229, c: 0.231, d: 0.228 }))).toEqual([])
  })
})

describe('openVectors', () => {
  it('starts empty on a bad file and drops vectors of deleted memes', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'memez-')), 'vectors.json')
    await writeFile(path, '{ broken')
    const vectors = await openVectors(path)
    expect(vectors.entries()).toEqual([])

    await vectors.set('kept', [0.1])
    await vectors.set('gone', [0.2])
    await vectors.keepOnly(['kept'])
    expect((await openVectors(path)).entries()).toEqual([['kept', [0.1]]])
  })
})
