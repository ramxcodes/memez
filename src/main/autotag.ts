import { mediaKind, type AutoTagStatus, type Meme, type ModelStatus } from '../shared/types'
import type { Library } from './library'
import type { ModelId, ModelRole } from '../shared/models'
import type { Ai } from './ai'
import { AiCrashError, AiStoppedError } from './aiProcess'
import type { Vectors } from './semantic'

// A crash skips its meme. More crashes in a row than this stop the queue (see `run`).
const MAX_CRASHES_IN_A_ROW = 2

/** Videos and GIFs: the AI reads frames from across the clip, and reads their text too. */
const isClip = (meme: Meme): boolean => mediaKind(meme.ext) !== 'image'

/** One key per pair of active models. A read made with another key is out of date. */
const modelsKey = (active: Record<ModelRole, ModelId>): string => `${active.caption} ${active.clip}`

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Suggests a title and tags for new memes, one at a time, with the local models.
 * It also saves each meme's CLIP vector in `vectors`, for search by meaning.
 * For videos and GIFs it also saves the text in the frames (Apple Vision reads still images).
 * Best effort, like OCR: a failure is visible in the status and never blocks saving a meme.
 * The models run in the shared AI process `ai` (see ai.ts) and load there when a read first
 * needs them. If the process crashes, the app keeps running.
 * They follow `activeModels`: after a switch in Settings, the next meme uses the new models.
 * `isEnabled` is the user's "Local AI" setting; when it is off, nothing new is queued.
 */
export function createAutoTagger(
  library: Pick<Library, 'list' | 'pathOf' | 'applyAutoTags' | 'setOcrText'>,
  vectors: Pick<Vectors, 'has' | 'set'>,
  ai: Ai,
  cacheDir: string,
  isEnabled: () => boolean,
  activeModels: () => Record<ModelRole, ModelId>,
  onStatus: (status: AutoTagStatus) => void,
  onTagged: () => void,
  /** Frames from across a video or GIF (see frames.ts). Throws when the file cannot be decoded. */
  grabFrames: (meme: Meme) => Promise<Uint8Array[]>
) {
  let model: ModelStatus = { state: 'idle' }
  /**
   * Memes to read, with what to do. `fill`: a title and tags only when the AI has not written
   * them yet, plus the vector. `retag`: a new title and tags even when it has (see applyAutoTags).
   */
  const pending = new Map<string, 'fill' | 'retag'>()
  /** Memes the AI could not read, with the reason. Shown in Info; cleared once a read works. */
  const failed = new Map<string, string>()
  let running = false

  const status = (): AutoTagStatus => ({
    model,
    pending: [...pending.keys()],
    failed: [...failed].map(([id, message]) => ({ id, message }))
  })
  const setModel = (next: ModelStatus): void => {
    model = next
    onStatus(status())
  }

  ai.onProgress((progress) => setModel({ state: 'loading', progress }))
  // After a crash the next read starts a new process. A stop is not an error, and it must not
  // hide an error that is on screen.
  ai.onEnd((crash) => {
    if (crash) setModel({ state: 'failed', message: crash.message })
    else if (model.state !== 'failed') setModel({ state: 'idle' })
  })

  const setReady = (): void => {
    if (model.state !== 'ready') setModel({ state: 'ready' })
  }

  /**
   * Loads the models a read needs (downloads them first when they are missing). `withCaption`
   * adds the caption model. A failure here is a broken setup, not one bad meme.
   */
  const prepare = async (
    active: Record<ModelRole, ModelId>,
    withCaption: boolean
  ): Promise<void> => {
    try {
      await ai.call('prepare', cacheDir, active, withCaption)
    } catch (error) {
      // A stop on purpose (Local AI turned off, a model switch) is not a failure to show.
      if (!(error instanceof AiStoppedError))
        setModel({ state: 'failed', message: messageOf(error) })
      throw error
    }
    setReady()
  }

  const run = async (): Promise<void> => {
    if (running) return
    running = true
    let crashesInARow = 0
    try {
      // A Map visits entries added while the loop runs, so new memes join this pass.
      for (const [id, mode] of pending) {
        const active = activeModels()
        const meme = library.list().find((other) => other.id === id)
        if (meme) {
          const clip = isClip(meme)
          const options = {
            suggest: mode === 'retag' || !meme.autoTagged,
            readText: clip && (mode === 'retag' || meme.ocrText === undefined)
          }
          await prepare(active, options.suggest || options.readText)
          try {
            const frames = clip ? await grabFrames(meme) : [library.pathOf(meme)]
            const { vector, suggestion, text } = await ai.call(
              'read',
              cacheDir,
              active,
              frames,
              options
            )
            // A read loads a model again when a search with other models freed it in between.
            setReady()
            if (modelsKey(activeModels()) !== modelsKey(active)) {
              // The user switched models while this meme was read. Read it again with the new
              // ones, at the end of the queue (unless `stop` dropped it).
              if (pending.delete(id)) pending.set(id, mode)
              continue
            }
            crashesInARow = 0
            await vectors.set(id, vector)
            if (text !== null) await library.setOcrText(id, text)
            if (suggestion) await library.applyAutoTags(id, suggestion, mode)
            if (suggestion || text !== null) onTagged()
            failed.delete(id)
          } catch (error) {
            // This meme stays without `autoTagged`, so it runs again on the next launch.
            console.warn(`Auto tag failed for ${id}`, error)
            failed.set(id, messageOf(error))
            // The AI process crashed on this meme. The next meme starts a new process. Crashes
            // in a row mean the setup is broken, not one file: stop, so it does not restart
            // for each.
            if (error instanceof AiCrashError && ++crashesInARow >= MAX_CRASHES_IN_A_ROW)
              throw error
          }
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
    }
  }

  /**
   * Adds memes with no suggestion or no vector yet, and videos and GIFs whose text is not read
   * yet. A zip import brings suggestions but not vectors.
   */
  const queue = (memes: Meme[]): void => {
    if (!isEnabled()) return
    const todo = memes.filter(
      (meme) =>
        !meme.autoTagged || !vectors.has(meme.id) || (isClip(meme) && meme.ocrText === undefined)
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
     * Runs the AI again on `memes`: a new title and tags even when it wrote them before, and for
     * videos and GIFs their text. Titles the user wrote stay. The status shows the progress.
     */
    retag(memes: Meme[]): void {
      memes.forEach((meme) => pending.set(meme.id, 'retag'))
      onStatus(status())
      void run()
    },

    /**
     * The CLIP image vector of the file at `path`, for search by a dropped image. Loads the CLIP
     * model if needed (it must be downloaded already: loading downloads missing files). It never
     * loads or runs the caption model.
     */
    async embed(path: string): Promise<number[]> {
      const active = activeModels()
      await prepare(active, false)
      const options = { suggest: false, readText: false }
      const { vector } = await ai.call('read', cacheDir, active, [path], options)
      setReady()
      return vector
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

    /**
     * Ends the AI process to free its memory, also for search. The next use loads the active
     * models. While memes are read it does nothing: the read in flight must finish.
     */
    unload(): void {
      if (!running) ai.stop()
    }
  }
}

export type AutoTagger = ReturnType<typeof createAutoTagger>
