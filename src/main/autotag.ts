import {
  mediaKind,
  type AutoTagStatus,
  type Meme,
  type MemePatch,
  type ModelStatus
} from '../shared/types'
import type { Library } from './library'
import type { ModelId, ModelRole } from '../shared/models'
import { AiCrashError, startAiProcess } from './aiProcess'
import type { Vectors } from './semantic'

const UNLOAD_AFTER_MS = 2 * 60_000
// A crash skips its meme. More crashes in a row than this stop the queue (see `run`).
const MAX_CRASHES_IN_A_ROW = 2

interface Models {
  /**
   * Reads the image at `path`: its CLIP vector for search and, when `suggest` is true,
   * a title and tags. The caption model is the slow part, so it runs only when asked.
   */
  read(
    path: string,
    suggest: boolean
  ): Promise<{ vector: number[]; suggestion: Required<MemePatch> | null }>
  /** Ends the AI process, which frees all its memory. */
  dispose(): void
}

/**
 * Starts an AI process and loads both models there (see aiModels.ts). Downloads them first
 * when they are not in `cacheDir`. `onCrash` runs when the process crashes.
 */
async function loadModels(
  cacheDir: string,
  active: Record<ModelRole, ModelId>,
  onProgress: (fraction: number) => void,
  onCrash: (error: Error) => void
): Promise<Models> {
  const ai = startAiProcess(onProgress, onCrash)
  try {
    await ai.call('loadTagModels', cacheDir, active)
  } catch (error) {
    ai.stop()
    throw error
  }
  return { read: (path, suggest) => ai.call('read', path, suggest), dispose: ai.stop }
}

/** One key per pair of active models. Models loaded for another key are out of date. */
const modelsKey = (active: Record<ModelRole, ModelId>): string => `${active.caption} ${active.clip}`

/**
 * Suggests a title and tags for new memes, one at a time, with the local models.
 * It also saves each meme's CLIP vector in `vectors`, for search by meaning.
 * Best effort, like OCR: a failure is visible in the status and never blocks saving a meme.
 * The models load in their own process when there is work (see aiProcess.ts). The process ends
 * after a quiet time, to free memory. If it crashes, the app keeps running.
 * They follow `activeModels`: after a switch in Settings, the next meme loads the new models.
 * `isEnabled` is the user's "Local AI" setting; when it is off, nothing new is queued.
 */
export function createAutoTagger(
  library: Library,
  vectors: Vectors,
  cacheDir: string,
  isEnabled: () => boolean,
  activeModels: () => Record<ModelRole, ModelId>,
  onStatus: (status: AutoTagStatus) => void,
  onTagged: () => void
) {
  let model: ModelStatus = { state: 'idle' }
  let models: { key: string; loaded: Promise<Models> } | null = null
  /**
   * Memes to read, with what to do. `fill`: a title and tags only when the AI has not written
   * them yet, plus the vector. `retag`: a new title and tags even when it has (see applyAutoTags).
   */
  const pending = new Map<string, 'fill' | 'retag'>()
  let running = false
  let unloadTimer: ReturnType<typeof setTimeout> | undefined

  const status = (): AutoTagStatus => ({ model, pending: [...pending.keys()] })
  const setModel = (next: ModelStatus): void => {
    model = next
    onStatus(status())
  }

  const dispose = (loaded: Promise<Models>): Promise<void> =>
    loaded.then((m) => m.dispose()).catch((error) => console.warn('Unload failed', error))

  /** The models for the active ids. Loads them, and frees models of other ids. */
  const getModels = (): Promise<Models> => {
    const active = activeModels()
    const key = modelsKey(active)
    if (models?.key === key) return models.loaded
    if (models) void dispose(models.loaded)
    setModel({ state: 'loading', progress: 0 })
    // An older load that ends after a switch must not change the status of the newer one.
    const isCurrent = (): boolean => models?.loaded === loaded
    const onProgress = (progress: number): void => {
      if (isCurrent()) setModel({ state: 'loading', progress })
    }
    // The AI process crashed. The next call starts a new one.
    const onCrash = (error: Error): void => {
      if (!isCurrent()) return
      models = null
      setModel({ state: 'failed', message: error.message })
    }
    const loaded = loadModels(cacheDir, active, onProgress, onCrash).then(
      (ready) => {
        if (isCurrent()) setModel({ state: 'ready' })
        return ready
      },
      (error: unknown) => {
        // An older load's failure says nothing about the newer one.
        if (!isCurrent()) throw error
        models = null
        setModel({
          state: 'failed',
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    )
    models = { key, loaded }
    return loaded
  }

  /** Frees the models. Safe to call when they are not loaded. */
  const unload = async (): Promise<void> => {
    clearTimeout(unloadTimer)
    const current = models
    if (!current || running) return
    models = null
    setModel({ state: 'idle' })
    await dispose(current.loaded)
  }

  const scheduleUnload = (): void => {
    clearTimeout(unloadTimer)
    unloadTimer = setTimeout(() => void unload(), UNLOAD_AFTER_MS)
  }

  const run = async (): Promise<void> => {
    if (running) return
    running = true
    let crashesInARow = 0
    try {
      // A Map visits entries added while the loop runs, so new memes join this pass.
      for (const [id, mode] of pending) {
        const key = modelsKey(activeModels())
        // An older load that fails after a model switch says nothing about the new models:
        // load those instead of dropping the queue.
        const loaded = await getModels().catch((error: unknown) => {
          if (modelsKey(activeModels()) !== key) return getModels()
          throw error
        })
        try {
          const meme = library.list().find((other) => other.id === id)
          if (meme) {
            const suggest = mode === 'retag' || !meme.autoTagged
            const { vector, suggestion } = await loaded.read(library.pathOf(meme), suggest)
            if (modelsKey(activeModels()) !== key) {
              // The user switched models while this meme was read. Read it again with the new
              // ones, at the end of the queue (unless `stop` dropped it).
              if (pending.delete(id)) pending.set(id, mode)
              continue
            }
            crashesInARow = 0
            await vectors.set(id, vector)
            if (suggestion) {
              await library.applyAutoTags(id, suggestion, mode)
              onTagged()
            }
          }
        } catch (error) {
          // This meme stays without `autoTagged`, so it runs again on the next launch.
          console.warn(`Auto tag failed for ${id}`, error)
          // The AI process crashed on this meme. The next meme starts a new process. Crashes in
          // a row mean the setup is broken, not one file: stop, so it does not restart for each.
          if (error instanceof AiCrashError && ++crashesInARow >= MAX_CRASHES_IN_A_ROW) throw error
        }
        pending.delete(id)
        onStatus(status())
      }
    } catch (error) {
      // The models did not load, or the AI process kept crashing. The status shows the error;
      // `retry` starts again.
      console.warn('AI stopped', error)
      pending.clear()
      onStatus(status())
    } finally {
      running = false
      if (models) scheduleUnload()
    }
  }

  /**
   * Adds memes with no suggestion or no vector yet. A zip import brings suggestions but not
   * vectors. Videos are skipped; they have no still frame.
   */
  const queue = (memes: Meme[]): void => {
    if (!isEnabled()) return
    const todo = memes.filter(
      (meme) => mediaKind(meme.ext) !== 'video' && (!meme.autoTagged || !vectors.has(meme.id))
    )
    if (todo.length === 0) return
    todo.forEach((meme) => pending.has(meme.id) || pending.set(meme.id, 'fill'))
    onStatus(status())
    void run()
  }

  return {
    status,
    queue,

    /**
     * Runs the AI again on `memes` (not videos): a new title and tags even when it wrote them
     * before. Titles the user wrote stay. The status shows the progress like new memes.
     */
    retag(memes: Meme[]): void {
      memes
        .filter((meme) => mediaKind(meme.ext) !== 'video')
        .forEach((meme) => pending.set(meme.id, 'retag'))
      onStatus(status())
      void run()
    },

    /**
     * The CLIP image vector of the file at `path`, for search by a dropped image. Loads the models
     * if needed (they must be downloaded already: loading downloads missing files). It never runs
     * the slow caption model.
     */
    async embed(path: string): Promise<number[]> {
      const loaded = await getModels()
      try {
        return (await loaded.read(path, false)).vector
      } finally {
        if (!running) scheduleUnload()
      }
    },

    /**
     * Loads the models (downloads them on first launch) and queues every meme still to do.
     * Runs at app start, and again when the user retries after a failed download.
     */
    start(): void {
      queue(library.list())
      void run()
    },

    /** Drops the queue. The meme being read now still finishes. */
    stop(): void {
      pending.clear()
      onStatus(status())
    },

    /** True while models load or memes are being read. The models folder must not change then. */
    busy: (): boolean => running || model.state === 'loading',

    unload
  }
}

export type AutoTagger = ReturnType<typeof createAutoTagger>
