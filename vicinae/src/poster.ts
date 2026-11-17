import { execFile } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const isMac = process.platform === 'darwin'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/**
 * Returns a PNG of the video's first frame, made once and kept in `dir`. Media file names are
 * content hashes, so a saved frame is never out of date. macOS uses Quick Look; Linux and
 * Windows use ffmpeg. Throws when no frame can be made.
 */
export async function videoPoster(video: string, dir: string): Promise<string> {
  const poster = join(dir, `${basename(video)}.png`)
  if (await exists(poster)) return poster
  await mkdir(dir, { recursive: true })
  if (isMac) {
    await run('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', dir, video])
  } else {
    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-i',
      video,
      '-frames:v',
      '1',
      '-vf',
      'scale=512:-1',
      poster
    ])
  }
  if (!(await exists(poster))) throw new Error(`No frame for ${basename(video)}`)
  return poster
}
