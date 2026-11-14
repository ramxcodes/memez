/**
 * Text reading for still images on Linux with the `tesseract` command (see ocr.ts). Pure
 * helpers, so they test without Electron.
 *
 * Meme captions are often white letters with a black outline (Impact style). Tesseract reads
 * them badly as they are, but well from a mask of only the near-white pixels, as black text on
 * white. So Memez reads each image twice, as it is and as that mask, and keeps the better read.
 */

/** Words below this confidence (0–100) are noise: textures, faces, edges. */
const MIN_WORD_CONFIDENCE = 45

export interface TesseractRead {
  text: string
  /** How much confident text the read found. Higher is better. */
  score: number
}

/**
 * Reads `tesseract … tsv` output: one row per page, block, paragraph, line and word. Keeps the
 * words with a letter or digit and enough confidence, one line of text per Tesseract line.
 */
export function parseTesseractTsv(tsv: string): TesseractRead {
  const lines = new Map<string, string[]>()
  let score = 0
  for (const row of tsv.split('\n')) {
    const cells = row.split('\t')
    if (cells.length < 12 || cells[0] !== '5') continue // 5: a word. The header row is skipped too.
    const [, , block, paragraph, line] = cells
    const confidence = Number(cells[10])
    const word = cells.slice(11).join('\t').trim()
    if (!word || !(confidence >= MIN_WORD_CONFIDENCE) || !/[\p{L}\p{N}]/u.test(word)) continue
    const key = `${block}.${paragraph}.${line}`
    lines.set(key, [...(lines.get(key) ?? []), word])
    score += (word.length * confidence) / 100
  }
  const text = [...lines.values()].map((words) => words.join(' ')).join('\n')
  return { text, score }
}

/** The read with more confident text. Ties keep the first. */
export const betterRead = (reads: TesseractRead[]): TesseractRead =>
  reads.reduce((best, read) => (read.score > best.score ? read : best), { text: '', score: 0 })

/** Luminance (0–255) a pixel needs to count as caption white in the mask. */
const WHITE = 225

/**
 * A grayscale PGM image (binary P5) from a BGRA bitmap, like Electron's `NativeImage.toBitmap()`.
 * `mask`: black where the pixel is near white, white everywhere else, so white captions become
 * black text on a clean page. Otherwise: plain grayscale.
 */
export function bitmapToPgm(
  bgra: Uint8Array,
  width: number,
  height: number,
  mask: boolean
): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${width} ${height}\n255\n`)
  const out = new Uint8Array(header.length + width * height)
  out.set(header)
  for (let i = 0; i < width * height; i++) {
    const b = bgra[i * 4]!
    const g = bgra[i * 4 + 1]!
    const r = bgra[i * 4 + 2]!
    const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    out[header.length + i] = mask ? (luminance >= WHITE ? 0 : 255) : luminance
  }
  return out
}
