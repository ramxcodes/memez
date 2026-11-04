import { mediaKind, type Meme } from '../shared/types'
import type { Library } from './library'

/**
 * Reads text in images with Apple Vision (macOS only), one meme at a time.
 * OCR is best effort: a failure is logged and never blocks saving a meme.
 * Videos are skipped; search them by title and tags.
 */
export function createOcrQueue(library: Library, onDone: () => void) {
  let queue: Promise<void> = Promise.resolve()

  const run = async (meme: Meme): Promise<void> => {
    try {
      const { recognize, OcrAccuracy } = await import('@napi-rs/system-ocr')
      const result = await recognize(library.pathOf(meme), OcrAccuracy.Accurate)
      await library.setOcrText(meme.id, result.text.trim())
      onDone()
    } catch (error) {
      console.warn(`OCR failed for ${meme.id}`, error)
    }
  }

  return (meme: Meme): void => {
    if (mediaKind(meme.ext) === 'video' || meme.ocrText !== undefined) return
    queue = queue.then(() => run(meme))
  }
}
