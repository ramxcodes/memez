import { mediaKind, type Meme } from '../../../../shared/types'

/**
 * What the Info "Text in image" section shows, or `null` to hide it. Only macOS reads text
 * from images (Apple Vision), so "Reading text…" shows only there, and only until OCR has run.
 * Videos have no OCR.
 */
export function textInImage(meme: Meme, isMac: boolean): string | null {
  if (mediaKind(meme.ext) === 'video') return null
  if (meme.ocrText?.trim()) return meme.ocrText
  if (isMac && meme.ocrText === undefined) return 'Reading text…'
  return null
}
