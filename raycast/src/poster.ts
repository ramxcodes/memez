import { execFile } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Returns a PNG of the video's first frame, made once by macOS Quick Look (`qlmanage`) and kept in
 * `dir`. Media file names are content hashes, so a saved frame is never out of date.
 * Throws when Quick Look cannot make a frame; `qlmanage` exits with 0 even then.
 */
export async function videoPoster(video: string, dir: string): Promise<string> {
  // qlmanage names the frame after the video: `<hash>.mp4.png`.
  const poster = join(dir, `${basename(video)}.png`)
  const exists = () =>
    access(poster).then(
      () => true,
      () => false
    )
  if (await exists()) return poster
  await mkdir(dir, { recursive: true })
  await run('/usr/bin/qlmanage', ['-t', '-s', '512', '-o', dir, video])
  if (!(await exists())) throw new Error(`Quick Look made no frame for ${basename(video)}`)
  return poster
}
