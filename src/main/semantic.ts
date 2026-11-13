import { readFile } from 'node:fs/promises'
import type { ModelId, ModelRole } from '../shared/models'
import { startAiProcess } from './aiProcess'
import { writeAtomic } from './library'
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
    get: (id: string): number[] | undefined => vectors[id],
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
    },
    /** Drops every vector. For a new CLIP model: its vectors have another length and meaning. */
    clear(): Promise<void> {
      vectors = {}
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

// CLIP image vectors all point roughly the same way, so image-to-image scores run high:
// unrelated images usually score about 0.45 to 0.7, the same subject or template about 0.75 to
// 0.9, and near-copies (a crop, a resize, another frame) 0.95 or more. In a small synthetic test
// library every pair scored 0.43 to 0.72, so a high floor like 0.8 found nothing at all. The
// list is best first, so 0.6 only drops images that are clearly unrelated.
const MIN_SIMILARITY = 0.6
const MAX_SIMILAR = 24

const dot = (a: number[], b: number[]): number => a.reduce((sum, x, i) => sum + x * b[i], 0)

/**
 * Ids of the memes whose image vector is close to `target`, best first. Vectors are unit length,
 * so the dot product is the cosine. `exclude` is the meme being compared, left out of its own list.
 */
export function rankSimilar(
  target: number[],
  entries: [string, number[]][],
  exclude?: string
): string[] {
  return entries
    .filter(([id]) => id !== exclude)
    .map(([id, vector]) => ({ id, score: dot(target, vector) }))
    .filter(({ score }) => score >= MIN_SIMILARITY)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SIMILAR)
    .map(({ id }) => id)
}

/**
 * Search by meaning: "crying" finds a crying cat with no such tag or title.
 * Best effort: before the models are downloaded, or on any failure, it finds nothing.
 * The text model loads on first use, in its own process, and the process ends after a quiet time.
 * `isEnabled` is the user's "Local AI" setting; when it is off, it finds nothing.
 */
export function createSemanticSearch(
  cacheDir: string,
  vectors: Vectors,
  isEnabled: () => boolean,
  activeModels: () => Record<ModelRole, ModelId>
) {
  // The CLIP text model for queries, in its own AI process (see aiProcess.ts). It never
  // downloads, so there is no progress. `onCrash` runs when the process crashes.
  const loadTextModel = (id: ModelId, onCrash: () => void) => {
    const ai = startAiProcess(() => undefined, onCrash)
    return ai.call('loadTextModel', cacheDir, id).then(
      () => ({ embed: (text: string) => ai.call('embedText', text), dispose: ai.stop }),
      (error: unknown) => {
        ai.stop()
        throw error
      }
    )
  }

  let textModel: ReturnType<typeof loadTextModel> | null = null
  // The CLIP model `textModel` belongs to. A switch in Settings loads the new one on next use.
  let textModelId: ModelId | null = null
  let unloadTimer: ReturnType<typeof setTimeout> | undefined

  const unload = async (): Promise<void> => {
    clearTimeout(unloadTimer)
    const loaded = textModel
    textModel = null
    await loaded?.then((m) => m.dispose()).catch(() => undefined)
  }

  const getTextModel = (): ReturnType<typeof loadTextModel> => {
    const id = activeModels().clip
    if (textModelId !== id) void unload() // Drops the old model at once, frees it in the background.
    clearTimeout(unloadTimer)
    unloadTimer = setTimeout(() => void unload(), UNLOAD_AFTER_MS)
    textModelId = id
    if (textModel) return textModel
    // After a failed load or a crash, the next search loads it again.
    const forget = (): void => {
      if (textModel === loading) textModel = null
    }
    const loading: ReturnType<typeof loadTextModel> = loadTextModel(id, forget).catch(
      (error: unknown) => {
        forget()
        throw error
      }
    )
    textModel = loading
    return loading
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
        return pickMatches(entries.map(([id, v]) => ({ id, score: dot(v, q) })))
      } catch (error) {
        console.warn('Semantic search failed', error)
        return []
      }
    },

    unload
  }
}

export type SemanticSearch = ReturnType<typeof createSemanticSearch>
