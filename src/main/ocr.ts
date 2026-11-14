import { nativeImage, type NativeImage } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { mediaKind, type Meme, type StillImageOcr } from '../shared/types'
import type { Library } from './library'
import { findExecutable } from './linux'
import { betterRead, bitmapToPgm, parseTesseractTsv } from './tesseract'

/**
 * Who reads text in still images here: Apple Vision on macOS (@napi-rs/system-ocr), the
 * `tesseract` command on Linux when it is installed. Windows: none yet (see README).
 */
export function stillImageOcr(): StillImageOcr {
  if (process.platform === 'darwin') return 'available'
  if (process.platform !== 'linux') return 'unsupported'
  return findExecutable('tesseract') ? 'available' : 'missing'
}

/**
 * A still image as a NativeImage. Electron on Linux does not decode WebP, so that goes through
 * ImageMagick when it is installed. Empty when the image cannot be decoded.
 */
export async function decodeStill(path: string): Promise<NativeImage> {
  const image = nativeImage.createFromPath(path)
  if (!image.isEmpty() || process.platform !== 'linux') return image
  const magick = findExecutable('magick')
  if (!magick) return image
  try {
    const { stdout } = await promisify(execFile)(magick, [`${path}[0]`, 'png:-'], {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 30_000
    })
    return nativeImage.createFromBuffer(stdout)
  } catch (error) {
    console.warn(`Could not decode ${path}`, error)
    return image
  }
}

// One thread: OCR runs in the background and should not take every core.
const TESSERACT_ENV = { ...process.env, OMP_THREAD_LIMIT: '1' }

/** Runs `tesseract <input> stdout tsv`. `input` is a file path, or image bytes for stdin. */
function tesseractTsv(tesseract: string, input: string | Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(tesseract, [typeof input === 'string' ? input : 'stdin', 'stdout', 'tsv'], {
      env: TESSERACT_ENV,
      timeout: 60_000
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += String(chunk)))
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `tesseract exited ${code}`))
    )
    child.stdin.on('error', () => undefined) // A failed tesseract closes stdin early.
    child.stdin.end(typeof input === 'string' ? undefined : input)
  })
}

/** Larger images read no better and take longer. */
const MAX_SIDE = 2000

/** Reads an image with Tesseract twice, as it is and as a white-caption mask; keeps the better. */
async function readWithTesseract(tesseract: string, path: string): Promise<string> {
  const reads = [parseTesseractTsv(await tesseractTsv(tesseract, path))]
  let image = await decodeStill(path)
  if (!image.isEmpty()) {
    const { width, height } = image.getSize()
    if (Math.max(width, height) > MAX_SIDE)
      image = image.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE })
    const size = image.getSize()
    const mask = bitmapToPgm(image.toBitmap(), size.width, size.height, true)
    reads.push(parseTesseractTsv(await tesseractTsv(tesseract, mask)))
  }
  return betterRead(reads).text
}

async function readWithSystemOcr(path: string): Promise<string> {
  const { recognize, OcrAccuracy } = await import('@napi-rs/system-ocr')
  return (await recognize(path, OcrAccuracy.Accurate)).text.trim()
}

/**
 * Reads text in still images, one meme at a time: Apple Vision on macOS, Tesseract on Linux.
 * OCR is best effort: a failure is logged and never blocks saving a meme. On Linux without
 * Tesseract nothing is queued, and memes keep `ocrText` unset, so they are read on a later
 * launch once Tesseract is installed.
 * Videos and GIFs are skipped: the local AI reads their text from frames across the clip
 * (see autotag.ts), on every OS.
 */
export function createOcrQueue(library: Library, onDone: () => void) {
  let queue: Promise<void> = Promise.resolve()

  const run = async (meme: Meme, tesseract: string | null): Promise<void> => {
    try {
      const path = library.pathOf(meme)
      const text = tesseract
        ? await readWithTesseract(tesseract, path)
        : await readWithSystemOcr(path)
      await library.setOcrText(meme.id, text)
      onDone()
    } catch (error) {
      console.warn(`OCR failed for ${meme.id}`, error)
    }
  }

  return (meme: Meme): void => {
    if (mediaKind(meme.ext) !== 'image' || meme.ocrText !== undefined) return
    if (process.platform === 'linux') {
      const tesseract = findExecutable('tesseract')
      if (tesseract) queue = queue.then(() => run(meme, tesseract))
      return
    }
    queue = queue.then(() => run(meme, null))
  }
}
