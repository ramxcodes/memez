import { execFile, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

/**
 * Linux desktop helpers: which session runs, which tools are installed, and how to press paste
 * for the user. Electron cannot send a keystroke to another app, so Memez runs a small tool.
 */

export type Session = 'wayland' | 'x11'

type Env = Record<string, string | undefined>

/** The display session, or null when there is none (or not Linux). Wayland wins when both are set. */
export function linuxSession(env: Env, platform: string = process.platform): Session | null {
  if (platform !== 'linux') return null
  if (env['WAYLAND_DISPLAY'] || env['XDG_SESSION_TYPE'] === 'wayland') return 'wayland'
  if (env['DISPLAY'] || env['XDG_SESSION_TYPE'] === 'x11') return 'x11'
  return null
}

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** Full path of `name` on `PATH`, like `which`. Null when it is not installed. */
export function findExecutable(
  name: string,
  env: Env = process.env,
  canRun: (path: string) => boolean = isExecutable
): string | null {
  for (const dir of (env['PATH'] ?? '').split(delimiter)) {
    if (dir && canRun(join(dir, name))) return join(dir, name)
  }
  return null
}

export interface PasteTool {
  name: 'wtype' | 'xdotool'
  path: string
  args: string[]
}

/**
 * The tool that presses paste in the window in front. Shift+Insert, like the Omarchy clipboard
 * manager: it pastes the clipboard in terminals and in GUI apps alike, where Ctrl+V does not
 * paste in most terminals.
 *   Wayland: `wtype` (needs a compositor with the virtual keyboard protocol: Hyprland, Sway,
 *   KDE; not GNOME). X11: `xdotool`. Null when the tool for this session is missing.
 */
export function choosePasteTool(
  session: Session | null,
  find: (name: string) => string | null
): PasteTool | null {
  if (session === 'wayland') {
    const path = find('wtype')
    return path
      ? { name: 'wtype', path, args: ['-M', 'shift', '-k', 'Insert', '-m', 'shift'] }
      : null
  }
  if (session === 'x11') {
    const path = find('xdotool')
    return path
      ? { name: 'xdotool', path, args: ['key', '--clearmodifiers', 'shift+Insert'] }
      : null
  }
  return null
}

/** The tool to install for paste in this session, for the Settings hint. */
export const pasteToolFor = (session: Session | null): PasteTool['name'] | null =>
  session === 'wayland' ? 'wtype' : session === 'x11' ? 'xdotool' : null

/** Presses paste with `tool`. Throws when the tool fails (for example GNOME without virtual keyboard). */
export async function pressPaste(tool: PasteTool): Promise<void> {
  await promisify(execFile)(tool.path, tool.args, { timeout: 5000 })
}

/**
 * The MIME types offered on the Wayland clipboard now, from `wl-paste --list-types`. Null when
 * wl-paste is missing or fails.
 */
export async function waylandClipboardTypes(wlPaste: string): Promise<string[] | null> {
  try {
    const { stdout } = await promisify(execFile)(wlPaste, ['--list-types'], { timeout: 2000 })
    return stdout.split('\n').filter(Boolean)
  } catch {
    return null // "Nothing is copied" exits with an error too.
  }
}

// Closes every inherited file descriptor above stderr, then runs the command. Chromium keeps
// some descriptors open across exec (the DevTools port, for one), and wl-copy lives on after
// Memez: it would hold them, so a restarted Memez could not listen on that port again.
const CLOSE_FDS_AND_EXEC =
  'for f in /proc/$$/fd/*; do n=${f##*/}; [ "$n" -gt 2 ] && eval "exec $n>&-"; done; exec "$0" "$@"'

/**
 * Puts `data` on the Wayland clipboard as `type` with `wl-copy`. wl-copy forks a process that
 * serves the clipboard until something else is copied, so this does not wait for it to exit.
 */
export function wlCopy(wlCopyPath: string, type: string, data: Uint8Array | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', CLOSE_FDS_AND_EXEC, wlCopyPath, '--type', type], {
      stdio: ['pipe', 'ignore', 'pipe']
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += String(chunk)))
    child.on('error', reject)
    // The foreground wl-copy exits once its background copy owns the clipboard.
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `wl-copy exited with ${code}`))
    )
    child.stdin.end(data)
  })
}

const shellQuote = (arg: string): string =>
  /^[\w./:=@%+-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`

/**
 * The command that starts this Memez with `flag`, for a window manager key binding:
 * `memez --toggle-popup` when `memez` is on PATH, the AppImage path for an AppImage, else the
 * executable (plus the app folder in development).
 * `APPIMAGE` and `APPDIR` count only when this executable runs from that AppImage's mount
 * (`APPDIR`): apps started from another AppImage inherit both.
 */
export function launchCommand(
  flag: string,
  app: { packaged: boolean; execPath: string; appPath: string },
  env: Env,
  memezOnPath: string | null
): string {
  const appDir = env['APPDIR']
  const appImage =
    app.packaged && env['APPIMAGE'] && appDir && app.execPath.startsWith(`${appDir}/`)
      ? env['APPIMAGE']
      : null
  const parts = appImage
    ? [appImage]
    : !app.packaged
      ? [app.execPath, app.appPath]
      : memezOnPath
        ? ['memez']
        : [app.execPath]
  return [...parts, flag].map(shellQuote).join(' ')
}

/** The bytes of the Wayland clipboard as `type`, from `wl-paste`. */
async function wlPasteBytes(wlPaste: string, type: string): Promise<Buffer> {
  const { stdout } = await promisify(execFile)(wlPaste, ['--no-newline', '--type', type], {
    encoding: 'buffer',
    maxBuffer: 512 * 1024 * 1024,
    timeout: 10_000
  })
  return stdout
}

const IMAGE_TYPES = ['image/gif', 'image/png', 'image/webp', 'image/jpeg']

/** What to read from a Wayland clipboard that offers `types`, best first. */
export function waylandClipboardPlan(types: string[]): {
  uriList: boolean
  text: boolean
  image: string | null
} {
  return {
    uriList: types.includes('text/uri-list'),
    text: types.includes('text/plain;charset=utf-8') || types.includes('text/plain'),
    image: IMAGE_TYPES.find((type) => types.includes(type)) ?? null
  }
}

/**
 * Reads the meme on the Wayland clipboard with `wl-paste`, for `memez://add`: Chromium on
 * Wayland only sees the clipboard while one of its windows has focus, and a link comes while
 * none has. Copied files first, then a copied link (downloaded), then copied image data.
 */
export async function readWaylandClipboardMedia(
  wlPaste: string,
  ingest: {
    readFiles(paths: string[]): Promise<Uint8Array[]>
    downloadMedia(url: string): Promise<Uint8Array>
  }
): Promise<Uint8Array[]> {
  const types = await waylandClipboardTypes(wlPaste)
  if (!types?.length) throw new Error('The clipboard is empty.')
  const plan = waylandClipboardPlan(types)
  if (plan.uriList) {
    const uris = String(await wlPasteBytes(wlPaste, 'text/uri-list')).split(/\r?\n/)
    const paths = uris.filter((uri) => uri.startsWith('file://')).map((uri) => fileURLToPath(uri))
    if (paths.length > 0) return ingest.readFiles(paths)
  }
  const text = plan.text ? String(await wlPasteBytes(wlPaste, 'text/plain')).trim() : ''
  const link = /^https?:\/\/\S+$/.test(text) ? text : null
  if (link) {
    try {
      return [await ingest.downloadMedia(link)]
    } catch (error) {
      if (!plan.image) throw error // With no image, the download error is the answer.
    }
  }
  if (plan.image) return [new Uint8Array(await wlPasteBytes(wlPaste, plan.image))]
  throw new Error('Copy an image, GIF, video or link first.')
}
