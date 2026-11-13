import { mediaKind, type Meme } from '../../../../shared/types'

/**
 * What the Info "Text in image" section shows, or `null` to hide it. Still images: only macOS
 * reads their text (Apple Vision), so "Reading text…" shows only there until OCR has run.
 * Videos and GIFs: the local AI reads their text on every OS, while `tagging` is true.
 */
export function textInImage(meme: Meme, isMac: boolean, tagging: boolean): string | null {
  if (meme.ocrText?.trim()) return meme.ocrText
  if (meme.ocrText !== undefined) return null
  const reading = mediaKind(meme.ext) === 'image' ? isMac : tagging
  return reading ? 'Reading text…' : null
}
