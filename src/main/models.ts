import { access, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MODELS, modelInfo, type ModelId, type ModelInfo } from '../shared/models'
import type { ModelDownload, ModelState } from '../shared/types'
import { SESSION_OPTIONS, sumProgress } from './aiModels'
import type { Handlers, MainContext } from './ipc'
import { rankSimilar } from './semantic'

/** Bytes of all files under `dir`. 0 when it does not exist. */
export async function folderSize(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    const sizes = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => (await stat(join(entry.parentPath, entry.name))).size)
    )
    return sizes.reduce((a, b) => a + b, 0)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0
    throw error
  }
}

/**
 * transformers.js keeps each file at `<cacheDir>/<repo>/<path in repo>`, so every model has its
 * own folder. A file appears only when it is complete (it downloads to a `.tmp` name first).
 */
const modelFolder = (modelDir: string, model: ModelInfo): string => join(modelDir, model.repo)

// Files the tokenizer and the image processor read. Every catalog repo has them.
const SHARED_FILES = ['tokenizer.json', 'tokenizer_config.json', 'preprocessor_config.json']
// The ONNX parts the app loads: Florence-2 has one model class, CLIP a vision and a text model.
const PARTS = { caption: [undefined], clip: ['vision_model', 'text_model'] }

/**
 * True when every file the app loads for `model` is on disk, for the catalog dtype. The ONNX
 * file names come from transformers.js and the model's own config.json, so no network is used.
 */
export async function isModelReady(modelDir: string, model: ModelInfo): Promise<boolean> {
  const folder = modelFolder(modelDir, model)
  let json: string
  try {
    json = await readFile(join(folder, 'config.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const ai = await import('@huggingface/transformers')
  const config = new ai.PretrainedConfig(JSON.parse(json))
  const parts = await Promise.all(
    PARTS[model.role].map((model_file_name) =>
      ai.ModelRegistry.get_model_files(model.repo, { config, dtype: model.dtype, model_file_name })
    )
  )
  const files = new Set([...SHARED_FILES, ...parts.flat()])
  const found = await Promise.all(
    [...files].map((file) =>
      access(join(folder, file)).then(
        () => true,
        () => false
      )
    )
  )
  return found.every(Boolean)
}

/**
 * Downloads `model` the same way the AI loads it (so the same files), then frees it.
 * An abort in `abortableFetch` stops it.
 */
async function fetchModel(
  model: ModelInfo,
  cacheDir: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  const ai = await import('@huggingface/transformers')
  ai.env.cacheDir = cacheDir
  const options = { progress_callback: sumProgress(onProgress, model.approxBytes) }
  const withDtype = { ...options, dtype: model.dtype, session_options: SESSION_OPTIONS }
  const { repo } = model
  const loads =
    model.role === 'caption'
      ? [
          ai.Florence2Processor.from_pretrained(repo, options),
          ai.AutoTokenizer.from_pretrained(repo, options),
          ai.Florence2ForConditionalGeneration.from_pretrained(repo, withDtype)
        ]
      : [
          ai.AutoProcessor.from_pretrained(repo, options),
          ai.AutoTokenizer.from_pretrained(repo, options),
          ai.CLIPVisionModelWithProjection.from_pretrained(repo, withDtype),
          ai.CLIPTextModelWithProjection.from_pretrained(repo, withDtype)
        ]
  // Wait for all, so no model is still loading when its files are removed after a failure.
  const settled = await Promise.allSettled(loads)
  await Promise.all(
    settled.map((result) =>
      result.status === 'fulfilled' && result.value instanceof ai.PreTrainedModel
        ? result.value.dispose()
        : undefined
    )
  )
  const failed = settled.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}

/**
 * transformers.js has no abort option, but it downloads through `env.fetch`. This puts a fetch
 * there that adds the abort signal of the repo a URL belongs to
 * (`https://huggingface.co/<repo>/resolve/main/<file>`). An abort ends the file stream; the cache
 * deletes its temp file and `from_pretrained` rejects.
 */
async function abortableFetch(aborts: Map<string, AbortController>): Promise<void> {
  const ai = await import('@huggingface/transformers')
  const base = ai.env.fetch
  ai.env.fetch = (input, init) => {
    const url = String(input)
    const signal = [...aborts].find(([repo]) => url.includes(`/${repo}/`))?.[1].signal
    if (!signal) return base(input, init)
    const signals = init?.signal ? [init.signal, signal] : [signal]
    return base(input, { ...init, signal: AbortSignal.any(signals) })
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The AI models in Settings, "Re-tag all", "Find similar" and search by a dropped image. */
export function modelHandlers(
  ctx: MainContext
): Pick<
  Handlers,
  | 'listModels'
  | 'downloadModel'
  | 'cancelDownload'
  | 'useModel'
  | 'deleteModel'
  | 'deleteModels'
  | 'retagAll'
  | 'findSimilar'
  | 'searchByImage'
> {
  const { library, settings, modelDir, vectors, autoTagger } = ctx
  // Downloads started here, and the last failure. Models not in it are 'ready' or 'none' on disk.
  const jobs = new Map<ModelId, Exclude<ModelDownload, { state: 'none' | 'ready' }>>()
  // One per download, by repo. Cancel aborts it.
  const aborts = new Map<string, AbortController>()
  let fetchReady: Promise<void> | null = null

  const stateOf = async (model: ModelInfo): Promise<ModelState> => ({
    id: model.id,
    active: settings.models[model.role] === model.id,
    download:
      jobs.get(model.id) ??
      ((await isModelReady(modelDir, model)) ? { state: 'ready' } : { state: 'none' }),
    bytes: await folderSize(modelFolder(modelDir, model))
  })
  const list = (): Promise<ModelState[]> => Promise.all(MODELS.map(stateOf))

  // One after another, so an older list never arrives after a newer one.
  let lastBroadcast = Promise.resolve()
  const changed = (): Promise<void> => {
    lastBroadcast = lastBroadcast
      .then(async () => ctx.broadcast('models:changed', await list()))
      .catch((error) => console.warn('Model list failed', error))
    return lastBroadcast
  }

  const setJob = (id: ModelId, job: ModelDownload): Promise<void> => {
    if (job.state === 'none' || job.state === 'ready') jobs.delete(id)
    else jobs.set(id, job)
    return changed()
  }

  const removeFiles = (model: ModelInfo): Promise<void> =>
    rm(modelFolder(modelDir, model), { recursive: true, force: true })

  /**
   * Makes `model` the active one for its role. A new CLIP model reads every meme again.
   * Its files are on disk, so an old failure in `jobs` is out of date: it is cleared.
   */
  const activate = async (model: ModelInfo): Promise<void> => {
    jobs.delete(model.id)
    if (settings.models[model.role] === model.id) return changed()
    settings.models = { ...settings.models, [model.role]: model.id }
    await ctx.saveSettings()
    autoTagger.unload()
    if (model.role === 'clip') {
      // Old vectors come from the other CLIP model (B/32 has 512 numbers, L/14 has 768).
      await vectors.clear()
      autoTagger.queue(library.list()) // Does nothing while Local AI is off; `start` does it then.
    }
    await changed()
  }

  /** Runs one download to its end: active on success, files removed on failure or cancel. */
  const download = async (model: ModelInfo): Promise<void> => {
    let failure: unknown = null
    try {
      await fetchModel(model, modelDir, (progress) => {
        if (jobs.get(model.id)?.state === 'downloading')
          void setJob(model.id, { state: 'downloading', progress })
      })
    } catch (error) {
      failure = error
    }
    aborts.delete(model.repo)
    // Cancel may come too late to abort (files done, model loading): still remove the files.
    const cancelled = jobs.get(model.id)?.state === 'cancelling'
    if (cancelled || failure) await removeFiles(model)
    if (cancelled) return setJob(model.id, { state: 'none' })
    if (failure) return setJob(model.id, { state: 'failed', message: errorMessage(failure) })
    await setJob(model.id, { state: 'ready' })
    await activate(model)
  }

  return {
    listModels: async () => list(),

    downloadModel: async (_, id) => {
      const model = modelInfo(id)
      const job = jobs.get(id)
      if (job?.state === 'downloading' || job?.state === 'cancelling')
        throw new Error(`${model.name} is already downloading.`)
      // Take the job before any await, so a second click sees it and cannot start a second download.
      jobs.set(id, { state: 'downloading', progress: 0 })
      let ready: boolean
      try {
        ready = await isModelReady(modelDir, model)
        if (!ready) await (fetchReady ??= abortableFetch(aborts))
      } catch (error) {
        await setJob(id, { state: 'none' })
        throw error
      }
      if (ready) return activate(model) // Clears the job.
      // Cancel pressed while the disk was checked: nothing was downloaded yet.
      if (jobs.get(id)?.state === 'cancelling') return setJob(id, { state: 'none' })
      aborts.set(model.repo, new AbortController())
      await changed()
      download(model).catch((error) => {
        // Only removing files or saving settings can fail here. Show it in the row.
        void setJob(id, { state: 'failed', message: errorMessage(error) })
      })
    },

    cancelDownload: async (_, id) => {
      const model = modelInfo(id)
      if (jobs.get(id)?.state !== 'downloading') return
      await setJob(id, { state: 'cancelling' })
      aborts.get(model.repo)?.abort()
    },

    useModel: async (_, id) => {
      const model = modelInfo(id)
      if (!(await isModelReady(modelDir, model)))
        throw new Error(`${model.name} is not downloaded yet.`)
      await activate(model)
    },

    deleteModel: async (_, id) => {
      const model = modelInfo(id)
      if (autoTagger.busy()) throw new Error('The AI is working. Try again when it is done.')
      const job = jobs.get(id)
      if (job?.state === 'downloading' || job?.state === 'cancelling')
        throw new Error(`Cancel the download of ${model.name} first.`)
      if (settings.models[model.role] === id) {
        // The AI cannot run without it. Same as deleting all models.
        settings.localAi = false
        await ctx.saveSettings()
        autoTagger.stop()
        autoTagger.unload()
      }
      await removeFiles(model)
      await setJob(id, { state: 'none' })
    },

    deleteModels: async () => {
      if (autoTagger.busy()) throw new Error('The AI is working. Try again when it is done.')
      // `jobs`, not `aborts`: a download's job exists before its abort control does.
      if ([...jobs.values()].some((job) => job.state !== 'failed'))
        throw new Error('A model is downloading. Cancel it first.')
      settings.localAi = false
      await ctx.saveSettings()
      autoTagger.stop()
      autoTagger.unload()
      await rm(modelDir, { recursive: true, force: true })
      jobs.clear()
      await changed()
    },

    retagAll: async () => {
      if (!settings.localAi)
        throw new Error('Turn on smart titles and tags in Settings to re-tag memes.')
      autoTagger.retag(library.list())
    },

    findSimilar: async (_, id) => {
      if (!settings.localAi)
        throw new Error('Turn on smart titles and tags in Settings to find similar memes.')
      const vector = vectors.get(id)
      // Videos, and memes the AI has not read (yet, or could not), have no vector to compare.
      if (!vector) throw new Error('The AI has not read this meme, so it cannot compare it yet.')
      return rankSimilar(vector, vectors.entries(), id)
    },

    searchByImage: async (_, path) => {
      if (!settings.localAi)
        throw new Error('Turn on smart titles and tags in Settings to search by image.')
      // Only CLIP reads the image; the caption model is not needed.
      if (!(await isModelReady(modelDir, modelInfo(settings.models.clip))))
        throw new Error('The AI models are not downloaded yet. Try again when they are ready.')
      return rankSimilar(await autoTagger.embed(path), vectors.entries())
    }
  }
}
