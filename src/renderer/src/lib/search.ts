import Fuse from 'fuse.js'
import type { Meme } from '../../../shared/types'

/**
 * Builds a fuzzy search over title, tags and OCR text. Tags count most.
 * Each word is matched on its own, so "sad cat" finds a meme tagged `sad` and `cat`.
 * Memes that match more words come first; then the closer match wins.
 */
export function createSearch(memes: Meme[]): (query: string) => Meme[] {
  const fuse = new Fuse(memes, {
    keys: [
      { name: 'tags', weight: 3 },
      { name: 'title', weight: 2 },
      { name: 'ocrText', weight: 1 }
    ],
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.4
  })

  return (query) => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) return memes

    // Fuse scores go from 0 (exact) to 1 (no match).
    const totals = new Map<Meme, { hits: number; score: number }>()
    for (const word of words) {
      for (const { item, score = 1 } of fuse.search(word)) {
        const total = totals.get(item) ?? { hits: 0, score: 0 }
        totals.set(item, { hits: total.hits + 1, score: total.score + score })
      }
    }
    return [...totals]
      .sort(([, a], [, b]) => b.hits - a.hits || a.score - b.score)
      .map(([meme]) => meme)
  }
}

/** Most recently used or added first. The popup shows this list before the user types. */
export const byRecentUse = (memes: Meme[]): Meme[] =>
  memes.toSorted((a, b) => (b.usedAt ?? b.addedAt).localeCompare(a.usedAt ?? a.addedAt))
