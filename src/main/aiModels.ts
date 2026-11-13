import type { ProgressInfo } from '@huggingface/transformers'
import type { MemePatch } from '../shared/types'
import { normalizeTags } from './library'
import { modelInfo, type ModelId, type ModelRole } from '../shared/models'

// The model code. It runs in the AI process (see aiWorker.ts), never in the app's main process:
// a native crash in the model runtime or the image decoder must not end the app.
// Both models run on this device. They download once into `cacheDir` (see shared/models.ts).
// The caption model (Florence-2) writes a short caption, which becomes the title.
// The CLIP model scores the image against `TAG_WORDS`; the best words become tags. Its image
// vector also powers search by meaning (see semantic.ts), so both use the same model.
// fp16 keeps CLIP's accuracy; 8-bit CLIP gave noisy tags in our tests.

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
 * Loads the caption and tag models. Downloads them first when they are not in `cacheDir`.
 * `read` gives the CLIP vector of the image at `path` for search and, when `suggest` is true,
 * a title and tags. The caption model is the slow part, so it runs only when asked.
 */
export async function loadTagModels(
  cacheDir: string,
  active: Record<ModelRole, ModelId>,
  onProgress: (fraction: number) => void
) {
  const captioner = modelInfo(active.caption)
  const clip = modelInfo(active.clip)
  const ai = await import('@huggingface/transformers')
  ai.env.cacheDir = cacheDir

  const expectedBytes = captioner.approxBytes + clip.approxBytes
  const options = { progress_callback: sumProgress(onProgress, expectedBytes) }

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
    ai.Florence2Processor.from_pretrained(captioner.repo, options) as Promise<
      InstanceType<typeof ai.Florence2Processor>
    >,
    ai.AutoTokenizer.from_pretrained(captioner.repo, options),
    ai.Florence2ForConditionalGeneration.from_pretrained(captioner.repo, {
      ...options,
      dtype: captioner.dtype
    }),
    ai.AutoProcessor.from_pretrained(clip.repo, options),
    ai.AutoTokenizer.from_pretrained(clip.repo, options),
    ai.CLIPVisionModelWithProjection.from_pretrained(clip.repo, { ...options, dtype: clip.dtype }),
    ai.CLIPTextModelWithProjection.from_pretrained(clip.repo, { ...options, dtype: clip.dtype })
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
    async read(
      path: string,
      suggest: boolean
    ): Promise<{ vector: number[]; suggestion: Required<MemePatch> | null }> {
      // For a GIF this reads the first frame.
      const image = await ai.RawImage.read(path)
      const { image_embeds } = await visionModel(await tagProcessor(image))
      const [vector] = image_embeds.normalize(2, -1).tolist() as number[][]
      if (!suggest) return { vector, suggestion: null }
      const text = await caption(image)
      const suggestion = { title: titleFromCaption(text), tags: pickTags(wordScores(vector), text) }
      return { vector, suggestion }
    }
  }
}

/**
 * The CLIP text model for search queries. Its files come with the tag model's download.
 * It never downloads: the auto tagger owns the download and shows its progress.
 */
export async function loadTextModel(cacheDir: string, id: ModelId) {
  const { repo, dtype } = modelInfo(id)
  const ai = await import('@huggingface/transformers')
  ai.env.cacheDir = cacheDir
  const options = { local_files_only: true }
  const [tokenizer, model] = await Promise.all([
    ai.AutoTokenizer.from_pretrained(repo, options),
    ai.CLIPTextModelWithProjection.from_pretrained(repo, { ...options, dtype })
  ])
  return {
    async embed(text: string): Promise<number[]> {
      const { text_embeds } = await model(tokenizer([text], { truncation: true }))
      return (text_embeds.normalize(2, -1).tolist() as number[][])[0]
    }
  }
}
