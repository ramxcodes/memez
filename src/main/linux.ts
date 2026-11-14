import { execFile, spawn } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { delimiter, join } from 'node:path'
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

/**
 * Puts `data` on the Wayland clipboard as `type` with `wl-copy`. wl-copy forks a process that
 * serves the clipboard until something else is copied, so this does not wait for it to exit.
 */
export function wlCopy(wlCopyPath: string, type: string, data: Uint8Array | string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(wlCopyPath, ['--type', type], { stdio: ['pipe', 'ignore', 'pipe'] })
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
