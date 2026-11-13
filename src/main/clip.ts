// How the AI reads a moving meme (a video or an animated GIF): a few frames from across the whole
// clip instead of the first frame only. Audio is not read. See autotag.ts for the models.

/** A moving meme, as the frame grabber measures it (see frames.ts). */
export type Clip = { kind: 'video'; seconds: number } | { kind: 'gif'; frames: number }

const MAX_FRAMES = 6
/** The first and last 5% often hold fades or black frames. */
const EDGE = 0.05
/** Short videos get fewer frames: at most one per half second. */
const MIN_SECONDS_PER_FRAME = 0.5

/**
 * Where to take frames from `clip`, spread evenly over its middle 90%.
 * Video: times in seconds. GIF: frame indexes, without repeats.
 */
export function samplePoints(clip: Clip): number[] {
  const length = clip.kind === 'video' ? clip.seconds : clip.frames
  const count =
    clip.kind === 'video'
      ? Math.min(MAX_FRAMES, Math.max(1, Math.floor(clip.seconds / MIN_SECONDS_PER_FRAME)))
      : Math.min(MAX_FRAMES, clip.frames)
  const span = length * (1 - 2 * EDGE)
  const points = Array.from({ length: count }, (_, i) => length * EDGE + ((i + 0.5) * span) / count)
  if (clip.kind === 'video') return points
  return [...new Set(points.map((point) => Math.min(clip.frames - 1, Math.floor(point))))]
}

const dot = (a: number[], b: number[]): number => a.reduce((sum, x, i) => sum + x * b[i], 0)

/**
 * The average of the frame vectors, scaled back to length 1 like every CLIP vector we store.
 * This is the usual way to use CLIP on a video: one vector that stands for the whole clip.
 */
export function meanVector(vectors: number[][]): number[] {
  const sum = vectors[0].map((_, i) => vectors.reduce((total, vector) => total + vector[i], 0))
  const length = Math.hypot(...sum)
  return sum.map((x) => x / length)
}

/** Index of the frame closest to `mean`: the most typical frame, the one we caption. */
export function typicalFrame(vectors: number[][], mean: number[]): number {
  const scores = vectors.map((vector) => dot(vector, mean))
  return scores.indexOf(Math.max(...scores))
}

/**
 * Text read from each frame, joined into one text. Captions in meme videos change between
 * frames, so every line is kept once, in the order it first shows.
 */
export function mergeTextLines(texts: string[]): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of texts.flatMap((text) => text.split('\n'))) {
    const clean = line.trim().replace(/\s+/g, ' ')
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    lines.push(clean)
  }
  return lines.join('\n')
}
