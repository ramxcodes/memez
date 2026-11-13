import type { ProgressInfo, RawImage } from '@huggingface/transformers'
import type { MemePatch } from '../shared/types'
import { normalizeTags } from './library'
import { modelInfo, type ModelId, type ModelRole } from '../shared/models'
import { meanVector, mergeTextLines, typicalFrame } from './clip'

// The model code. It runs in the AI process (see aiWorker.ts), never in the app's main process:
// a native crash in the model runtime or the image decoder must not end the app.
// Both models run on this device. They download once into `cacheDir` (see shared/models.ts).
// Each model loads when a job first needs it and stays loaded until the AI process ends.
// The caption model (Florence-2) writes a short caption, which becomes the title.
// The CLIP model scores the image against `TAG_WORDS`; the best words become tags. Its image
// vector also powers search by meaning (see semantic.ts), so both use the same model.
// fp16 keeps CLIP's accuracy; 8-bit CLIP gave noisy tags in our tests.
// Videos and GIFs are read from a few frames across the whole clip (see clip.ts, frames.ts).
// The caption model also reads their text, on every OS; still images use Apple Vision (ocr.ts).
// Audio is not read.

/** Words the tag model can pick: well-known memes, feelings, actions and things. */
export const TAG_WORDS = [
  // Who or what is in it
  'cat', 'dog', 'kitten', 'puppy', 'bird', 'frog', 'monkey', 'bear',
  'man', 'woman', 'boy', 'girl', 'baby', 'old man', 'couple', 'group', 'crowd', 'celebrity',
  'cartoon', 'anime', 'simpsons', 'spongebob', 'pikachu', 'pokemon', 'drake', 'shrek',
  'doge', 'pepe', 'wojak',
  // Feelings
  'crying', 'sad', 'happy', 'laughing', 'smiling', 'angry', 'surprised', 'shocked',
  'confused', 'scared', 'disgusted', 'smug', 'bored', 'tired', 'sleeping', 'thinking',
  'nervous', 'sweating', 'awkward', 'jealous', 'proud', 'cool', 'cute', 'cringe',
  // Actions
  'dancing', 'eating', 'drinking', 'running', 'walking', 'fighting', 'pointing', 'screaming',
  'staring', 'waving', 'thumbs up', 'facepalm', 'shrug',
  // Things and places
  'fire', 'explosion', 'water', 'food', 'money', 'car', 'phone', 'computer', 'gaming',
  'sports', 'football', 'cricket', 'brain', 'button', 'office', 'school', 'party',
  'birthday', 'christmas', 'night', 'beach', 'space', 'mirror', 'glasses', 'suit',
  // Meme formats
  'choice', 'comparison', 'before and after', 'chart', 'wholesome', 'chaos', 'fail', 'love'
] // prettier-ignore

// From tests on real memes: right tags score about 0.1 to 0.5, noise stays under 0.07.
const MIN_TAG_SCORE = 0.07
const MAX_MODEL_TAGS = 4

/** "A cat is sitting on a table." → "Cat is sitting on a table" */
export function titleFromCaption(caption: string): string {
  const text = caption
    .trim()
    .replace(/[.\s]+$/, '')
    .replace(/^(a|an|the)\s+/i, '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const IRREGULAR: Record<string, string> = { women: 'woman', men: 'man' }

/** Lowercase words with a plain plural `s` removed, so "Two cats" and "cat" match. */
const baseWords = (text: string): string =>
  text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((word) => IRREGULAR[word] ?? word.replace(/s$/, ''))
    .join(' ')

/**
 * Tags from the tag model (best scores first) plus each `TAG_WORDS` word the caption names.
 * `scores[i]` is the score of `TAG_WORDS[i]`.
 */
export function pickTags(scores: number[], caption: string): string[] {
  const fromModel = TAG_WORDS.map((word, i) => ({ word, score: scores[i] }))
    .filter(({ score }) => score >= MIN_TAG_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODEL_TAGS)
    .map(({ word }) => word)
  const text = ` ${baseWords(caption)} `
  const fromCaption = TAG_WORDS.filter((word) => text.includes(` ${baseWords(word)} `))
  return normalizeTags([...fromModel, ...fromCaption])
}

const softmax = (values: number[]): number[] => {
  const max = Math.max(...values)
  const exps = values.map((value) => Math.exp(value - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((value) => value / sum)
}

/**
 * A transformers.js `progress_callback` that adds up the bytes of every file it downloads and
 * calls `onProgress` with one fraction from 0 to 1. Files report only once they start, so the
 * total is at least `expectedBytes` (the catalog size): else the first small files read 100%.
 * Progress fires many times a second, so it calls only when the whole percent changes.
 * Used by the auto tagger and by downloads in Settings.
 */
export function sumProgress(onProgress: (fraction: number) => void, expectedBytes: number) {
  const files = new Map<string, { loaded: number; total: number }>()
  let percent = 0
  return (info: ProgressInfo): void => {
    if (info.status !== 'progress') return
    files.set(`${info.name}/${info.file}`, info)
    let loaded = 0
    let started = 0
    for (const file of files.values()) {
      loaded += file.loaded
      started += file.total
    }
    const total = Math.max(started, expectedBytes)
    if (total === 0 || Math.floor((loaded / total) * 100) === percent) return
    percent = Math.floor((loaded / total) * 100)
    onProgress(loaded / total)
  }
}

/**
 * Session options for every model the app loads. The ONNX runtime's memory pool asks the system
 * for blocks that double in size, and its memory pattern asks for a whole run in one block.
 * Electron's allocator ends the process on one very large request (about 1 to 2 GB) instead of
 * returning an error, so the pool turned normal model runs into crashes. With both off, the
 * runtime asks for each tensor at its real size.
 */
export const SESSION_OPTIONS = { enableCpuMemArena: false, enableMemPattern: false }

/** A still image file path, or one frame of a clip as JPEG bytes. */
export type Frame = string | Uint8Array

/** What `from_pretrained` gets for a load: download progress, or `local_files_only`. */
type LoadOptions = { progress_callback?: (info: ProgressInfo) => void; local_files_only?: boolean }

const library = async (cacheDir: string) => {
  const ai = await import('@huggingface/transformers')
  ai.env.cacheDir = cacheDir
  return ai
}

/** The caption model (Florence-2). `task` is '<CAPTION>' for a title or '<OCR>' for text. */
async function loadCaption(cacheDir: string, id: ModelId, options: LoadOptions) {
  const { repo, dtype } = modelInfo(id)
  const ai = await library(cacheDir)
  const [processor, tokenizer, model] = await Promise.all([
    // The typings return the base `Processor`; the object is a `Florence2Processor`.
    ai.Florence2Processor.from_pretrained(repo, options) as Promise<
      InstanceType<typeof ai.Florence2Processor>
    >,
    ai.AutoTokenizer.from_pretrained(repo, options),
    ai.Florence2ForConditionalGeneration.from_pretrained(repo, {
      ...options,
      dtype,
      session_options: SESSION_OPTIONS
    })
  ])
  return {
    async describe(image: RawImage, task: '<CAPTION>' | '<OCR>'): Promise<string> {
      const inputs = await processor(image, processor.construct_prompts(task))
      const max_new_tokens = task === '<OCR>' ? 120 : 40
      const ids = await model.generate({ ...inputs, max_new_tokens })
      const [raw] = tokenizer.batch_decode(ids as InstanceType<typeof ai.Tensor>, {
        skip_special_tokens: false
      })
      const result = processor.post_process_generation(raw, task, image.size)[task]
      return typeof result === 'string' ? result : ''
    },
    dispose: () => model.dispose()
  }
}

/** The CLIP image model: one unit-length vector per image. */
async function loadVision(cacheDir: string, id: ModelId, options: LoadOptions) {
  const { repo, dtype } = modelInfo(id)
  const ai = await library(cacheDir)
  const [processor, model] = await Promise.all([
    ai.AutoProcessor.from_pretrained(repo, options),
    ai.CLIPVisionModelWithProjection.from_pretrained(repo, {
      ...options,
      dtype,
      session_options: SESSION_OPTIONS
    })
  ])
  return {
    async embed(image: RawImage): Promise<number[]> {
      const { image_embeds } = await model(await processor(image))
      return (image_embeds.normalize(2, -1).tolist() as number[][])[0]
    },
    dispose: () => model.dispose()
  }
}

/** The CLIP text model: one unit-length vector per text. For tag words and search queries. */
async function loadText(cacheDir: string, id: ModelId, options: LoadOptions) {
  const { repo, dtype } = modelInfo(id)
  const ai = await library(cacheDir)
  const [tokenizer, model] = await Promise.all([
    ai.AutoTokenizer.from_pretrained(repo, options),
    ai.CLIPTextModelWithProjection.from_pretrained(repo, {
      ...options,
      dtype,
      session_options: SESSION_OPTIONS
    })
  ])
  return {
    async embed(texts: string[]): Promise<number[][]> {
      const { text_embeds } = await model(tokenizer(texts, { padding: true, truncation: true }))
      return text_embeds.normalize(2, -1).tolist() as number[][]
    },
    dispose: () => model.dispose()
  }
}

/**
 * Holds at most one loaded model. `get` returns the model for `id` and loads it when it is not
 * there. A new id frees the old model first. A failed load is forgotten, so the next `get`
 * loads again.
 */
function slot<T extends { dispose(): Promise<unknown> }>() {
  let current: { id: ModelId; model: Promise<T> } | null = null
  return {
    has: (id: ModelId): boolean => current?.id === id,
    get(id: ModelId, load: () => Promise<T>): Promise<T> {
      if (current?.id === id) return current.model
      const old = current?.model
      const model = (async () => {
        await old?.then((loaded) => loaded.dispose()).catch(() => undefined)
        return load()
      })()
      current = { id, model }
      model.catch(() => {
        if (current?.model === model) current = null
      })
      return model
    }
  }
}

/**
 * The models of the AI process. Nothing loads until a job needs it: a search query loads only
 * the CLIP text model, an image vector only the CLIP image model, and a title, tags or text also
 * the caption model. `onProgress` gets the download progress (0 to 1) while tag models load.
 */
export function createModels(onProgress: (fraction: number) => void) {
  const caption = slot<Awaited<ReturnType<typeof loadCaption>>>()
  const vision = slot<Awaited<ReturnType<typeof loadVision>>>()
  const text = slot<Awaited<ReturnType<typeof loadText>>>()
  // The tag words never change, so they are embedded once for each CLIP model.
  let words: { id: ModelId; vectors: Promise<number[][]> } | null = null
  // Tag jobs run one after another: a model switch must not free a model that a read still uses.
  let lastJob: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(job: () => Promise<T>): Promise<T> => {
    const next = lastJob.catch(() => undefined).then(job)
    lastJob = next
    return next
  }

  /**
   * The models a read needs, loaded (and downloaded first when they are not in `cacheDir`).
   * `withCaption` adds the caption model and the CLIP text model, for a title, tags or text.
   */
  const load = async (
    cacheDir: string,
    active: Record<ModelRole, ModelId>,
    withCaption: boolean
  ) => {
    const clipMissing = !vision.has(active.clip) || (withCaption && !text.has(active.clip))
    const captionMissing = withCaption && !caption.has(active.caption)
    let options: LoadOptions = {}
    if (clipMissing || captionMissing) {
      const expectedBytes =
        (clipMissing ? modelInfo(active.clip).approxBytes : 0) +
        (captionMissing ? modelInfo(active.caption).approxBytes : 0)
      options = { progress_callback: sumProgress(onProgress, expectedBytes) }
      onProgress(0)
    }
    const loadTextModel = (): ReturnType<typeof loadText> =>
      text.get(active.clip, () => loadText(cacheDir, active.clip, options))
    const [image, captioner, wordModel] = await Promise.all([
      vision.get(active.clip, () => loadVision(cacheDir, active.clip, options)),
      withCaption
        ? caption.get(active.caption, () => loadCaption(cacheDir, active.caption, options))
        : null,
      // A search may have tried this model first. Search never downloads, so its load fails
      // when the files are missing. Then load it here, with the download.
      withCaption ? loadTextModel().catch(loadTextModel) : null
    ])
    return { image, captioner, wordModel }
  }

  const wordVectors = (id: ModelId, model: { embed(texts: string[]): Promise<number[][]> }) => {
    if (words?.id !== id) {
      const vectors = model.embed(TAG_WORDS.map((word) => `a picture of ${word}`))
      words = { id, vectors }
      vectors.catch(() => {
        if (words?.vectors === vectors) words = null
      })
    }
    return words.vectors
  }

  // The CLIP text model for search. Its files come with the tag model's download.
  // It never downloads: the auto tagger owns the download and shows its progress.
  // A search does not wait for tag jobs when its model is loaded. A load can free another text
  // model, so it takes its turn: a read may still use that one for the tag words.
  const searchText = (cacheDir: string, id: ModelId): ReturnType<typeof loadText> => {
    const get = (): ReturnType<typeof loadText> =>
      text.get(id, () => loadText(cacheDir, id, { local_files_only: true }))
    return text.has(id) ? get() : inTurn(get)
  }

  return {
    /** Loads the models for a read ahead of it, so a load failure is not a read failure. */
    prepare: (cacheDir: string, active: Record<ModelRole, ModelId>, withCaption: boolean) =>
      inTurn(async () => void (await load(cacheDir, active, withCaption))),

    /**
     * Reads the frames of one meme (a still image is one frame). Returns one CLIP vector for
     * search, the average of the frames; when `suggest` is true, a title and tags; when
     * `readText` is true, the text in the frames. The caption model is the slow part, so it
     * runs only when asked.
     */
    read: (
      cacheDir: string,
      active: Record<ModelRole, ModelId>,
      frames: Frame[],
      { suggest, readText }: { suggest: boolean; readText: boolean }
    ): Promise<{ vector: number[]; suggestion: Required<MemePatch> | null; text: string | null }> =>
      inTurn(async () => {
        const models = await load(cacheDir, active, suggest || readText)
        const { RawImage } = await library(cacheDir)
        const images = await Promise.all(
          frames.map((frame) =>
            RawImage.read(typeof frame === 'string' ? frame : new Blob([Buffer.from(frame)]))
          )
        )
        // One frame at a time, never a batch: a batch needs one large block of memory.
        const vectors: number[][] = []
        for (const image of images) vectors.push(await models.image.embed(image))
        const vector = meanVector(vectors)
        let suggestion = null
        let text = null
        if (models.captioner && models.wordModel) {
          if (suggest) {
            // One caption, of the most typical frame: captions are slow.
            const typical = images[typicalFrame(vectors, vector)]
            const title = await models.captioner.describe(typical, '<CAPTION>')
            // CLIP zero-shot: cosine similarity to each word, times CLIP's scale (100), then softmax.
            const scores = softmax(
              (await wordVectors(active.clip, models.wordModel)).map(
                (word) => 100 * word.reduce((sum, x, i) => sum + x * vector[i], 0)
              )
            )
            suggestion = { title: titleFromCaption(title), tags: pickTags(scores, title) }
          }
          if (readText) {
            const texts = []
            for (const image of images) texts.push(await models.captioner.describe(image, '<OCR>'))
            text = mergeTextLines(texts)
          }
        }
        return { vector, suggestion, text }
      }),

    /** Loads the search text model ahead of time, so the first search is fast. */
    loadTextModel: async (cacheDir: string, id: ModelId): Promise<void> =>
      void (await searchText(cacheDir, id)),

    /** The CLIP text vector of `query`, for search by meaning. */
    embedText: async (cacheDir: string, id: ModelId, query: string): Promise<number[]> =>
      (await (await searchText(cacheDir, id)).embed([query]))[0]
  }
}
