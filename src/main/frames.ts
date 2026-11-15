import { BrowserWindow } from 'electron'
import { readFile } from 'node:fs/promises'
import { mediaFileName, mediaKind, type Meme } from '../shared/types'
import type { Frame } from './aiModels'
import { samplePoints, type Clip } from './clip'

// Every picture the AI reads is decoded here, by Chromium inside Electron, so it works the same
// on macOS, Windows and Linux with no ffmpeg and no sharp (see rawImage.ts for why not sharp):
// an <img> decoder (createImageBitmap) for still images, a <video> element for MP4 and WebM,
// WebCodecs ImageDecoder for GIF. The AI process gets raw RGBA pixels.
// Electron's Chromium plays H.264 and VP8/VP9 everywhere; a file it cannot play (for example
// HEVC on a computer with no HEVC decoder) fails with a clear message. Audio is not read.

/**
 * Same origin as the media (see the `meme` protocol in index.ts), so the canvas can read pixels.
 * The protocol answers this URL with "Not found": only the origin matters, the script adds the rest.
 */
const PAGE_URL = 'meme://media/frames'
/** One step (open the page, open the clip, grab its frames) must not stall the AI queue forever. */
const STEP_TIMEOUT_MS = 30_000

/** Runs in the hidden page. Every call returns `PageResult`: an error thrown there would lose its message. */
const PAGE_SCRIPT = `(() => {
  // The caption model stretches each picture to 768 × 768 px, CLIP reads 224 px on the short
  // side: a short side of 768 px loses nothing. The long side is capped for very long pictures.
  const MAX_SHORT_SIDE = 768
  const MAX_LONG_SIDE = 2048
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const toPixels = (source, width, height) => {
    if (!width || !height) throw new Error('This file has no picture.')
    const scale = Math.min(
      1, MAX_SHORT_SIDE / Math.min(width, height), MAX_LONG_SIDE / Math.max(width, height)
    )
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    return { width: canvas.width, height: canvas.height, data: new Uint8Array(data.buffer) }
  }
  // A library file is a meme:// link; a dropped file comes as base64 bytes.
  const blobOf = async (src) => (await fetch(src)).blob()
  const VIDEO_ERRORS = {
    3: 'This video could not be decoded.',
    4: 'This video format cannot be played on this computer.'
  }
  const next = (video, name) => new Promise((resolve, reject) => {
    video.addEventListener(name, resolve, { once: true })
    video.addEventListener('error', () => reject(new Error(
      VIDEO_ERRORS[video.error && video.error.code] || 'This video could not be read.'
    )), { once: true })
  })
  const safe = (step) => async (arg) => {
    try { return { ok: true, value: await step(arg) } }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) } }
  }
  let video, decoder
  window.memezFrames = {
    // createImageBitmap turns the picture upright from its EXIF orientation, like a browser does.
    image: safe(async (src) => {
      let bitmap
      try {
        bitmap = await createImageBitmap(await blobOf(src))
      } catch {
        throw new Error('This image could not be decoded.')
      }
      try {
        return [toPixels(bitmap, bitmap.width, bitmap.height)]
      } finally {
        bitmap.close()
      }
    }),
    openVideo: safe(async (src) => {
      video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      // From memory: the meme protocol does not answer byte ranges, so a video read from it
      // cannot seek and every frame would be the first one.
      video.src = URL.createObjectURL(await blobOf(src))
      await next(video, 'loadeddata')
      // WebM files from screen recorders often have no length until the end is read.
      if (!Number.isFinite(video.duration)) {
        video.currentTime = 1e101
        await next(video, 'seeked')
      }
      return video.duration
    }),
    videoFrames: safe(async (times) => {
      const frames = []
      for (const time of times) {
        video.currentTime = time
        await next(video, 'seeked')
        frames.push(toPixels(video, video.videoWidth, video.videoHeight))
      }
      return frames
    }),
    openGif: safe(async (src) => {
      decoder = new ImageDecoder({ data: (await blobOf(src)).stream(), type: 'image/gif' })
      await decoder.completed
      return decoder.tracks.selectedTrack.frameCount
    }),
    gifFrames: safe(async (indexes) => {
      const frames = []
      for (const frameIndex of indexes) {
        const { image } = await decoder.decode({ frameIndex })
        frames.push(toPixels(image, image.displayWidth, image.displayHeight))
        image.close()
      }
      return frames
    })
  }
})()`

type PageResult<T> = { ok: true; value: T } | { ok: false; message: string }

/** What to decode: a link the page can fetch, and how to read it. */
type Source = { src: string; kind: Clip['kind'] | 'image' }

/** Where `item` is and what it is: a library meme, or the path of any image file. */
async function sourceOf(item: Meme | string): Promise<Source> {
  if (typeof item !== 'string')
    return { src: `meme://media/${mediaFileName(item)}`, kind: mediaKind(item.ext) }
  // A dropped file can be anywhere on disk, out of reach of the page: send its bytes.
  const bytes = await readFile(item)
  return { src: `data:application/octet-stream;base64,${bytes.toString('base64')}`, kind: 'image' }
}

/**
 * The pictures the AI reads for `item`: a library meme (see the `meme` protocol in index.ts), or
 * an image file at a path (search by a dropped image). A still image gives one frame; a video
 * or GIF a few frames spread over the whole clip (see clip.ts for which). Each frame is RGBA
 * pixels, scaled down when it is large. Throws with a message the user can read when the file
 * cannot be decoded. Opens a hidden window for the job and always closes it.
 */
export async function readFrames(item: Meme | string): Promise<Frame[]> {
  const { src, kind } = await sourceOf(item)
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, backgroundThrottling: false }
  })
  const timed = async <T>(step: Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Reading this file took too long.')),
        STEP_TIMEOUT_MS
      )
    })
    try {
      return await Promise.race([step, timeout])
    } finally {
      clearTimeout(timer)
    }
  }
  const run = async <T>(call: string): Promise<T> => {
    const result: PageResult<T> = await timed(window.webContents.executeJavaScript(call))
    if (!result.ok) throw new Error(result.message)
    return result.value
  }
  try {
    await timed(
      window.loadURL(PAGE_URL).then(() => window.webContents.executeJavaScript(PAGE_SCRIPT))
    )
    const link = JSON.stringify(src)
    if (kind === 'image') return await run<Frame[]>(`memezFrames.image(${link})`)
    const clip: Clip =
      kind === 'video'
        ? { kind, seconds: await run<number>(`memezFrames.openVideo(${link})`) }
        : { kind, frames: await run<number>(`memezFrames.openGif(${link})`) }
    const points = JSON.stringify(samplePoints(clip))
    const frames = await run<Frame[]>(`memezFrames.${kind}Frames(${points})`)
    if (frames.length === 0) throw new Error('No frames could be read from this file.')
    return frames
  } finally {
    window.destroy()
  }
}
