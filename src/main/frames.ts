import { BrowserWindow } from 'electron'
import { samplePoints, type Clip } from './clip'

// Frames are decoded by Chromium inside Electron, so it works the same on macOS, Windows and
// Linux with no ffmpeg: a <video> element for MP4 and WebM, WebCodecs ImageDecoder for GIF.
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
  const MAX_SIDE = 768 // The caption model reads 768 px, CLIP 224 px.
  const canvas = document.createElement('canvas')
  const toJpeg = (source, width, height) => {
    if (!width || !height) throw new Error('This file has no picture.')
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.9).split(',')[1]
  }
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
    openVideo: safe(async (src) => {
      video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      // From memory: the meme protocol does not answer byte ranges, so a video read from it
      // cannot seek and every frame would be the first one.
      video.src = URL.createObjectURL(await (await fetch(src)).blob())
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
        frames.push(toJpeg(video, video.videoWidth, video.videoHeight))
      }
      return frames
    }),
    openGif: safe(async (src) => {
      const response = await fetch(src)
      decoder = new ImageDecoder({ data: response.body, type: 'image/gif' })
      await decoder.completed
      return decoder.tracks.selectedTrack.frameCount
    }),
    gifFrames: safe(async (indexes) => {
      const frames = []
      for (const frameIndex of indexes) {
        const { image } = await decoder.decode({ frameIndex })
        frames.push(toJpeg(image, image.displayWidth, image.displayHeight))
        image.close()
      }
      return frames
    })
  }
})()`

type PageResult<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * A few JPEG frames spread over the whole of the clip at `url` (a `meme://media/` link), for the
 * AI to read (see clip.ts for which frames). Throws with a message the user can read when the
 * file cannot be decoded. Opens a hidden window for the job and always closes it.
 */
export async function grabFrames(url: string, kind: Clip['kind']): Promise<Uint8Array[]> {
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
    const src = JSON.stringify(url)
    const clip: Clip =
      kind === 'video'
        ? { kind, seconds: await run<number>(`memezFrames.openVideo(${src})`) }
        : { kind, frames: await run<number>(`memezFrames.openGif(${src})`) }
    const points = JSON.stringify(samplePoints(clip))
    const frames = await run<string[]>(`memezFrames.${kind}Frames(${points})`)
    if (frames.length === 0) throw new Error('No frames could be read from this file.')
    return frames.map((jpeg) => Buffer.from(jpeg, 'base64'))
  } finally {
    window.destroy()
  }
}
