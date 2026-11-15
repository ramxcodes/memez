import { mediaKind, type Meme, type StillImageOcr } from '../../../../shared/types'

/** What Info shows for a still image on Linux without Tesseract. */
export const INSTALL_TESSERACT =
  'Install Tesseract to read text in images: sudo pacman -S tesseract tesseract-data-eng'

/**
 * What the Info "Text in image" section shows, or `null` to hide it.
 * Still images: read by Apple Vision (macOS) or Tesseract (Linux), so "Reading text…" shows
 * until OCR has run when `stillOcr` is available, and an install hint when Tesseract is
 * missing. Windows has none. `null` while it is not known yet.
 * Videos and GIFs: the local AI reads their text on every OS, while `tagging` is true.
 */
export function textInImage(
  meme: Meme,
  stillOcr: StillImageOcr | null,
  tagging: boolean
): string | null {
  if (meme.ocrText?.trim()) return meme.ocrText
  if (meme.ocrText !== undefined) return null
  if (mediaKind(meme.ext) !== 'image') return tagging ? 'Reading text…' : null
  if (stillOcr === 'available') return 'Reading text…'
  if (stillOcr === 'missing') return INSTALL_TESSERACT
  return null
}
