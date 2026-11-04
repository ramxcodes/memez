import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Sends a `memez://` link to the Memez app (see `src/main/links.ts`). The app owns the library,
 * so every change goes through it. `-g` keeps Memez in the background, so the app the user
 * pasted into keeps focus. Throws when Memez is not installed.
 */
const openMemez = (path: string) => run('/usr/bin/open', ['-g', `memez://${path}`])

/** Adds the meme on the clipboard. Starts Memez if needed; it shows the result as a notification. */
export const addFromClipboard = () => openMemez('add')

/**
 * Moves the meme up in recent memes. Only when Memez is running: starting the app after each
 * paste would be a surprise. When it is not running, recent order just does not change.
 */
export async function markUsed(id: string) {
  const running = await run('/usr/bin/pgrep', ['-x', 'Memez']).then(
    () => true,
    () => false
  )
  if (running) await openMemez(`used/${id}`)
}
