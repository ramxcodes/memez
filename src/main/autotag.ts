import type { ProgressInfo } from '@huggingface/transformers'
import {
  mediaKind,
  type AutoTagStatus,
  type Meme,
  type MemePatch,
  type ModelStatus
} from '../shared/types'
import type { Library } from './library'
import { normalizeTags } from './library'
import { SEARCH_MODEL, type Vectors } from './semantic'

// Both models run on this device. They download once (about 570 MB) into `cacheDir`.
// Florence-2 writes a short caption, which becomes the title.
const CAPTION_MODEL = 'onnx-community/Florence-2-base-ft'
// CLIP scores the image against `TAG_WORDS`; the best words become tags. Its image vector also
// powers search by meaning (see semantic.ts), so both use the same model.
// fp16 keeps CLIP's accuracy; 8-bit CLIP gave noisy tags in our tests.
const TAG_MODEL = SEARCH_MODEL

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
const UNLOAD_AFTER_MS = 2 * 60_000

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

interface Models {
  /**
   * Reads the image at `path`: its CLIP vector for search and, when `suggest` is true,
   * a title and tags. The caption model is the slow part, so it runs only when asked.
   */
  read(
    path: string,
    suggest: boolean
  ): Promise<{ vector: number[]; suggestion: Required<MemePatch> | null }>
  dispose(): Promise<void>
}

/** Loads both models. Downloads them first when they are not in `cacheDir`. */
async function loadModels(cacheDir: string, onProgress: (fraction: number) => void) {
  const ai = await import('@huggingface/transformers')
  ai.env.cacheDir = cacheDir

  // Each file reports its own bytes. Add them up for one progress value.
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (info: ProgressInfo): void => {
    if (info.status !== 'progress') return
    files.set(`${info.name}/${info.file}`, info)
    let loaded = 0
    let total = 0
    for (const file of files.values()) {
      loaded += file.loaded
      total += file.total
    }
    if (total > 0) onProgress(loaded / total)
  }
  const options = { progress_callback }

  const [
    captionProcessor,
    captionTokenizer,
    captionModel,
    tagProcessor,
    tagTokenizer,
    visionModel,
    textModel
  ] = await Promise.all([
    // The typings return the base `Processor`; the object is a `Florence2Processor`.
    ai.Florence2Processor.from_pretrained(CAPTION_MODEL, options) as Promise<
      InstanceType<typeof ai.Florence2Processor>
    >,
    ai.AutoTokenizer.from_pretrained(CAPTION_MODEL, options),
    ai.Florence2ForConditionalGeneration.from_pretrained(CAPTION_MODEL, {
      ...options,
      dtype: 'q8'
    }),
    ai.AutoProcessor.from_pretrained(TAG_MODEL, options),
    ai.AutoTokenizer.from_pretrained(TAG_MODEL, options),
    ai.CLIPVisionModelWithProjection.from_pretrained(TAG_MODEL, { ...options, dtype: 'fp16' }),
    ai.CLIPTextModelWithProjection.from_pretrained(TAG_MODEL, { ...options, dtype: 'fp16' })
  ])

  // The words never change, so embed them once and free the text model.
  const words = TAG_WORDS.map((word) => `a picture of ${word}`)
  const { text_embeds } = await textModel(tagTokenizer(words, { padding: true, truncation: true }))
  const wordVectors = text_embeds.normalize(2, -1).tolist() as number[][]
  await textModel.dispose()

  const caption = async (image: InstanceType<typeof ai.RawImage>): Promise<string> => {
    const task = '<CAPTION>'
    const inputs = await captionProcessor(image, captionProcessor.construct_prompts(task))
    const ids = await captionModel.generate({ ...inputs, max_new_tokens: 40 })
    const [raw] = captionTokenizer.batch_decode(ids as InstanceType<typeof ai.Tensor>, {
      skip_special_tokens: false
    })
    const result = captionProcessor.post_process_generation(raw, task, image.size)[task]
    return typeof result === 'string' ? result : ''
  }

  // CLIP zero-shot: cosine similarity to each word, times CLIP's scale (100), then softmax.
  const wordScores = (vector: number[]): number[] =>
    softmax(wordVectors.map((word) => 100 * word.reduce((sum, x, i) => sum + x * vector[i], 0)))

  return {
    async read(path, suggest) {
      // For a GIF this reads the first frame.
      const image = await ai.RawImage.read(path)
      const { image_embeds } = await visionModel(await tagProcessor(image))
      const [vector] = image_embeds.normalize(2, -1).tolist() as number[][]
      if (!suggest) return { vector, suggestion: null }
      const text = await caption(image)
      const suggestion = { title: titleFromCaption(text), tags: pickTags(wordScores(vector), text) }
      return { vector, suggestion }
    },
    async dispose() {
      await Promise.all([captionModel.dispose(), visionModel.dispose()])
    }
  } satisfies Models
}

/**
 * Suggests a title and tags for new memes, one at a time, with the local models.
 * It also saves each meme's CLIP vector in `vectors`, for search by meaning.
 * Best effort, like OCR: a failure is visible in the status and never blocks saving a meme.
 * The models load when there is work and unload after a quiet time, to free memory.
 * `isEnabled` is the user's "Local AI" setting; when it is off, nothing new is queued.
 */
export function createAutoTagger(
  library: Library,
  vectors: Vectors,
  cacheDir: string,
  isEnabled: () => boolean,
  onStatus: (status: AutoTagStatus) => void,
  onTagged: () => void
) {
  let model: ModelStatus = { state: 'idle' }
  let models: Promise<Models> | null = null
  const pending = new Set<string>()
  let running = false
  let unloadTimer: ReturnType<typeof setTimeout> | undefined

  const status = (): AutoTagStatus => ({ model, pending: [...pending] })
  const setModel = (next: ModelStatus): void => {
    model = next
    onStatus(status())
  }

  const getModels = (): Promise<Models> => {
    if (models) return models
    setModel({ state: 'loading', progress: 0 })
    let percent = 0
    models = loadModels(cacheDir, (fraction) => {
      // Progress fires many times a second. Send it only when the whole percent changes.
      if (Math.floor(fraction * 100) === percent) return
      percent = Math.floor(fraction * 100)
      setModel({ state: 'loading', progress: fraction })
    }).then(
      (loaded) => {
        setModel({ state: 'ready' })
        return loaded
      },
      (error: unknown) => {
        models = null
        setModel({
          state: 'failed',
          message: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    )
    return models
  }

  /** Frees the models. Safe to call when they are not loaded. */
  const unload = async (): Promise<void> => {
    clearTimeout(unloadTimer)
    const loaded = models
    if (!loaded || running) return
    models = null
    setModel({ state: 'idle' })
    await loaded.then((m) => m.dispose()).catch((error) => console.warn('Unload failed', error))
  }

  const scheduleUnload = (): void => {
    clearTimeout(unloadTimer)
    unloadTimer = setTimeout(() => void unload(), UNLOAD_AFTER_MS)
  }

  const run = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      const loaded = await getModels()
      // A Set visits items added while the loop runs, so new memes join this pass.
      for (const id of pending) {
        try {
          const meme = library.list().find((other) => other.id === id)
          if (meme) {
            const { vector, suggestion } = await loaded.read(library.pathOf(meme), !meme.autoTagged)
            await vectors.set(id, vector)
            if (suggestion) {
              await library.applyAutoTags(id, suggestion)
              onTagged()
            }
          }
        } catch (error) {
          // This meme stays without `autoTagged`, so it runs again on the next launch.
          console.warn(`Auto tag failed for ${id}`, error)
        }
        pending.delete(id)
        onStatus(status())
      }
    } catch (error) {
      // The models did not load. The status shows the error; `retry` starts again.
      console.warn('AI models did not load', error)
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
    todo.forEach((meme) => pending.add(meme.id))
    onStatus(status())
    void run()
  }

  return {
    status,
    queue,
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
