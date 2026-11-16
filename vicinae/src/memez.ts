import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const isMac = process.platform === 'darwin'
const isLinux = process.platform === 'linux'
const isWindows = process.platform === 'win32'

/**
 * Sends a `memez://` link to the Memez app. The app owns the library, so every change goes
 * through it. macOS keeps Memez in the background with `-g`; Linux and Windows hand the link
 * to the system protocol handler.
 */
async function openMemezLink(path: string): Promise<void> {
  const url = `memez://${path}`
  if (isMac) {
    await run('/usr/bin/open', ['-g', url])
    return
  }
  if (isWindows) {
    await run('cmd', ['/c', 'start', '', url])
    return
  }
  await run('xdg-open', [url])
}

/** Adds the meme on the clipboard. Starts Memez if needed; it shows a notification. */
export const addFromClipboard = (): Promise<void> => openMemezLink('add')

/** True when the Memez app is running. Starting it just to mark a meme used is a surprise. */
async function isMemezRunning(): Promise<boolean> {
  if (isMac)
    return run('/usr/bin/pgrep', ['-x', 'Memez']).then(
      () => true,
      () => false
    )
  if (isLinux) {
    const exact = await run('pgrep', ['-x', 'memez']).then(
      () => true,
      () => false
    )
    if (exact) return true
    // AppImages and some packages keep the full path as the process title.
    return run('pgrep', ['-f', '/memez( |$)']).then(
      () => true,
      () => false
    )
  }
  if (isWindows) {
    return run('tasklist', ['/FI', 'IMAGENAME eq memez.exe', '/NH']).then(
      ({ stdout }) => stdout.toLowerCase().includes('memez.exe'),
      () => false
    )
  }
  return false
}

/** Moves the meme up in recent memes. Only when Memez is running. */
export async function markUsed(id: string): Promise<void> {
  if (!/^[a-f0-9]{16}$/.test(id)) return
  if (await isMemezRunning()) await openMemezLink(`used/${id}`)
}
