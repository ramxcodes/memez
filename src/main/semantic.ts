import { readFile } from 'node:fs/promises'
import { writeAtomic } from './library'

/** CLIP text model for queries. Its files are part of the first-launch download (see autotag). */
export const SEARCH_MODEL = 'Xenova/clip-vit-base-patch32'
const UNLOAD_AFTER_MS = 5 * 60_000

/**
 * One CLIP image vector per meme, saved in `path` (library root / vectors.json).
 * It can always be built again from the images, so a missing or bad file starts empty.
 */
export async function openVectors(path: string) {
  let vectors: Record<string, number[]> = {}
  try {
    vectors = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Bad vectors.json', error)
  }
  let lastWrite: Promise<void> = Promise.resolve()

  // Saves run one after another so an older snapshot never overwrites a newer one.
  const save = (): Promise<void> => {
    const content = JSON.stringify(vectors)
    lastWrite = lastWrite.catch(() => undefined).then(() => writeAtomic(path, content))
    return lastWrite
  }

  return {
    has: (id: string): boolean => id in vectors,
    entries: (): [string, number[]][] => Object.entries(vectors),
    set(id: string, vector: number[]): Promise<void> {
      vectors[id] = vector.map((x) => Math.round(x * 1e5) / 1e5) // Smaller file, same ranking.
      return save()
    },
    /** Drops vectors of memes no longer in the library. */
    keepOnly(ids: string[]): Promise<void> {
      const keep = new Set(ids)
      const stale = Object.keys(vectors).filter((id) => !keep.has(id))
      if (stale.length === 0) return Promise.resolve()
      stale.forEach((id) => delete vectors[id])
      return save()
    }
  }
}

export type Vectors = Awaited<ReturnType<typeof openVectors>>

// From tests on real memes: for real words the best match leads the library median by 0.023 to
// 0.084; for nonsense ("asdf", "the", "ok") the lead stays under 0.022.
const MIN_LEAD_OVER_MEDIAN = 0.022
const MAX_GAP_FROM_BEST = 0.02
const MAX_MATCHES = 8

/** Picks the memes that clearly match, best first. CLIP scores mean little on their own. */
export function pickMatches(scores: { id: string; score: number }[]): string[] {
  if (scores.length === 0) return []
  const sorted = scores.toSorted((a, b) => b.score - a.score)
  const median = sorted[Math.floor(sorted.length / 2)].score
  const floor = Math.max(median + MIN_LEAD_OVER_MEDIAN, sorted[0].score - MAX_GAP_FROM_BEST)
  return sorted
    .filter(({ score }) => score >= floor)
    .slice(0, MAX_MATCHES)
    .map(({ id }) => id)
}

/**
 * Search by meaning: "crying" finds a crying cat with no such tag or title.
 * Best effort: before the models are downloaded, or on any failure, it finds nothing.
 * The text model loads on first use and unloads after a quiet time.
 * `isEnabled` is the user's "Local AI" setting; when it is off, it finds nothing.
 */
export function createSemanticSearch(cacheDir: string, vectors: Vectors, isEnabled: () => boolean) {
  const loadTextModel = async () => {
    const ai = await import('@huggingface/transformers')
    ai.env.cacheDir = cacheDir
    // Never download here: the auto tagger owns the download and shows its progress.
    const options = { local_files_only: true }
    const [tokenizer, model] = await Promise.all([
      ai.AutoTokenizer.from_pretrained(SEARCH_MODEL, options),
      ai.CLIPTextModelWithProjection.from_pretrained(SEARCH_MODEL, { ...options, dtype: 'fp16' })
    ])
    return {
      async embed(text: string): Promise<number[]> {
        const { text_embeds } = await model(tokenizer([text], { truncation: true }))
        return (text_embeds.normalize(2, -1).tolist() as number[][])[0]
      },
      dispose: () => model.dispose()
    }
  }

  let textModel: ReturnType<typeof loadTextModel> | null = null
  let unloadTimer: ReturnType<typeof setTimeout> | undefined

  const unload = async (): Promise<void> => {
    clearTimeout(unloadTimer)
    const loaded = textModel
    textModel = null
    await loaded?.then((m) => m.dispose()).catch(() => undefined)
  }

  const getTextModel = (): ReturnType<typeof loadTextModel> => {
    clearTimeout(unloadTimer)
    unloadTimer = setTimeout(() => void unload(), UNLOAD_AFTER_MS)
    textModel ??= loadTextModel().catch((error: unknown) => {
      textModel = null
      throw error
    })
    return textModel
  }

  return {
    /** Loads the text model ahead of time, so the first search is fast. */
    warm(): void {
      if (!isEnabled()) return
      getTextModel().catch(() => undefined) // Not downloaded yet; search finds nothing for now.
    },

    /** Ids of the memes that match `query` by meaning, best first. */
    async search(query: string): Promise<string[]> {
      const entries = vectors.entries()
      if (!isEnabled() || !query.trim() || entries.length === 0) return []
      try {
        // The same wording the tag words use. It ranked the right memes first in tests.
        const q = await (await getTextModel()).embed(`a picture of ${query.trim()}`)
        return pickMatches(
          entries.map(([id, v]) => ({ id, score: v.reduce((sum, x, i) => sum + x * q[i], 0) }))
        )
      } catch (error) {
        console.warn('Semantic search failed', error)
        return []
      }
    },

    unload
  }
}
