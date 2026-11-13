import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { openVectors, pickMatches, rankSimilar } from './semantic'

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

describe('rankSimilar', () => {
  // Unit vectors at a given cosine to the target [1, 0].
  const at = (cosine: number): number[] => [cosine, Math.sqrt(1 - cosine * cosine)]

  it('ranks best first, leaves out itself and memes under 0.6', () => {
    const entries: [string, number[]][] = [
      ['self', at(1)],
      ['related', at(0.84)],
      ['copy', at(0.97)],
      ['same look', at(0.65)],
      ['at floor', at(0.6)],
      ['unrelated', at(0.55)]
    ]
    expect(rankSimilar(at(1), entries, 'self')).toEqual([
      'copy',
      'related',
      'same look',
      'at floor'
    ])
  })

  it('returns the best 24', () => {
    const entries = Array.from({ length: 30 }, (_, i): [string, number[]] => [
      `m${i}`,
      at(0.61 + i * 0.01)
    ])
    const ids = rankSimilar(at(1), entries)
    expect(ids).toHaveLength(24)
    expect(ids[0]).toBe('m29')
    expect(ids).not.toContain('m5')
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

describe('openVectors clear', () => {
  it('drops every vector, also on disk', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'memez-')), 'vectors.json')
    const vectors = await openVectors(path)
    await vectors.set('a', [0.5])
    expect(vectors.get('a')).toEqual([0.5])
    await vectors.clear()
    expect(vectors.get('a')).toBeUndefined()
    expect((await openVectors(path)).entries()).toEqual([])
  })
})
