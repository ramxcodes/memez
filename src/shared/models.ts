/**
 * The local AI models Memez can use. Each one does one job (`role`):
 * `caption` writes the title, `clip` picks tags and powers search by meaning and "Find similar".
 * The first model of each role is the default. Sizes are the download sizes on Hugging Face.
 */
export const MODELS = [
  {
    id: 'florence-2-base',
    role: 'caption',
    name: 'Florence-2 base',
    uses: 'titles',
    note: 'Writes a short title for each meme.',
    repo: 'onnx-community/Florence-2-base-ft',
    dtype: 'q8',
    approxBytes: 273e6
  },
  {
    id: 'florence-2-large',
    role: 'caption',
    name: 'Florence-2 large',
    uses: 'titles',
    note: 'Better titles, about 3× slower.',
    repo: 'onnx-community/Florence-2-large-ft',
    dtype: 'q8',
    approxBytes: 827e6
  },
  {
    id: 'clip-vit-b-32',
    role: 'clip',
    name: 'CLIP ViT-B/32',
    uses: 'tags · search',
    note: 'Picks tags and finds memes by meaning.',
    repo: 'Xenova/clip-vit-base-patch32',
    dtype: 'fp16',
    approxBytes: 303e6
  },
  {
    id: 'clip-vit-l-14',
    role: 'clip',
    name: 'CLIP ViT-L/14',
    uses: 'tags · search',
    note: 'Finds more by meaning, uses more memory.',
    repo: 'Xenova/clip-vit-large-patch14',
    dtype: 'fp16',
    approxBytes: 855e6
  }
] as const satisfies readonly {
  id: string
  role: 'caption' | 'clip'
  name: string
  uses: string
  note: string
  repo: string
  dtype: 'q8' | 'fp16'
  approxBytes: number
}[]

export type ModelInfo = (typeof MODELS)[number]
export type ModelId = ModelInfo['id']
export type ModelRole = ModelInfo['role']

export const modelInfo = (id: ModelId): ModelInfo => {
  const model = MODELS.find((other) => other.id === id)
  if (!model) throw new Error(`Unknown model ${id}`)
  return model
}

/** The model each role uses until the user picks another one. */
export const DEFAULT_MODELS: Record<ModelRole, ModelId> = {
  caption: 'florence-2-base',
  clip: 'clip-vit-b-32'
}
