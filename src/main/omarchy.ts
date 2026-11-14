import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, constants, cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, join, relative } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** The plugin's id in its manifest, and its folder name. */
export const PLUGIN_ID = 'memez'
/** Same family as Omarchy's own pickers: Clipboard is Super+Ctrl+V, Emojis Super+Ctrl+E. */
export const KEY = 'SUPER + CTRL + M'

// The plugin source (`omarchy/` in the repo). It is unpacked from the asar archive, so the copy
// below reads real files.
const bundledDir = join(__dirname, '../../omarchy').replace('app.asar', 'app.asar.unpacked')
const configHome = (): string => process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config')
const pluginDir = (): string => join(configHome(), 'omarchy', 'plugins', PLUGIN_ID)
const bindingsFile = (): string => join(configHome(), 'hypr', 'bindings.lua')
/** Where the app tells the plugin which library folder it uses (see `MEMEZ_LIBRARY`). */
const CONFIG_FILE = 'config.json'

const exists = (path: string, mode = constants.F_OK): Promise<boolean> =>
  access(path, mode).then(
    () => true,
    () => false
  )

/** True when `command` is an executable on `PATH`. */
async function onPath(command: string): Promise<boolean> {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter).filter(Boolean))
    if (await exists(join(dir, command), constants.X_OK)) return true
  return false
}

/** True on an Omarchy desktop: Linux with the Omarchy shell. */
export const hasOmarchy = async (): Promise<boolean> =>
  process.platform === 'linux' && (await onPath('omarchy-shell'))

export const isOmarchyInstalled = (): Promise<boolean> =>
  exists(join(pluginDir(), 'manifest.json'))

// --- The key binding. Pure text edits, so they are tested without a desktop. ---

const BEGIN = '-- >>> Memez (added by the Memez app; Settings > Omarchy > Remove takes it out)'
const END = '-- <<< Memez'

/** True when `text` already binds the Memez overlay, from the app or by hand. */
export const hasBinding = (text: string): boolean =>
  text.includes(BEGIN) || /panel\s*=\s*["']memez["']/.test(text)

/** `text` with the Memez binding block added at the end. Unchanged if it is already there. */
export function addBinding(text: string): string {
  if (hasBinding(text)) return text
  const block = `${BEGIN}\no.bind("${KEY}", "Memez", { panel = "${PLUGIN_ID}" })\n${END}\n`
  // A blank line before the block, unless the file is empty.
  const gap = text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return text + gap + block
}

/** `text` without the block `addBinding` added. Bindings the user wrote stay. */
export function removeBinding(text: string): string {
  const start = text.indexOf(BEGIN)
  if (start === -1) return text
  const end = text.indexOf(END, start)
  if (end === -1) return text
  let after = end + END.length
  if (text[after] === '\n') after++
  // Drop the blank line addBinding put before the block.
  const before = text.slice(0, start).replace(/\n\n$/, '\n')
  return before + text.slice(after)
}

interface HyprBind {
  modmask: number
  key: string
}

/** Hyprland's modifier bits: SUPER is 64, CTRL 4. */
const SUPER_CTRL = 64 | 4

/** True when Super+Ctrl+M already does something else in the running Hyprland. */
export const keyTaken = (binds: HyprBind[]): boolean =>
  binds.some((bind) => bind.modmask === SUPER_CTRL && bind.key.toLowerCase() === 'm')

/** What happened to the key binding on install. Settings shows it. */
export type BindingResult = 'added' | 'existing' | 'taken' | 'no-config'

async function bindKey(): Promise<BindingResult> {
  const file = bindingsFile()
  // Omarchy's Lua config. Older setups use another format; Settings then says how to bind.
  if (!(await exists(file))) return 'no-config'
  const text = await readFile(file, 'utf8')
  if (hasBinding(text)) return 'existing'
  const binds = await run('hyprctl', ['binds', '-j']).then(
    ({ stdout }) => JSON.parse(stdout) as HyprBind[],
    () => [] // No hyprctl answer: bind anyway; the line is easy to see and remove.
  )
  if (keyTaken(binds)) return 'taken'
  await writeFile(file, addBinding(text))
  return 'added'
}

async function unbindKey(): Promise<void> {
  const file = bindingsFile()
  if (!(await exists(file))) return
  const text = await readFile(file, 'utf8')
  const next = removeBinding(text)
  if (next !== text) await writeFile(file, next)
}

// --- Install, remove, update. ---

/** Tests and notes stay out of the installed plugin. */
const shipped = (source: string): boolean => !/\.test\.[jt]s$|\.md$/.test(source)

/**
 * Asks the shell to enable the plugin. Right after the files land, the shell may not have
 * found them yet ("not known"), so try a few times.
 */
async function enablePlugin(): Promise<void> {
  await run('omarchy-shell', ['shell', 'rescanPlugins']).catch(() => undefined)
  let lastError: unknown
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await run('omarchy', ['plugin', 'enable', PLUGIN_ID])
      return
    } catch (error) {
      lastError = error
      await wait(500)
    }
  }
  throw new Error(`Omarchy did not enable the Memez plugin: ${String(lastError)}`)
}

async function copyPlugin(libraryRoot: string): Promise<void> {
  if (!(await exists(join(bundledDir, 'manifest.json'))))
    throw new Error('This build of Memez has no Omarchy plugin.')
  const target = pluginDir()
  await rm(target, { recursive: true, force: true })
  await mkdir(target, { recursive: true })
  await cp(bundledDir, target, { recursive: true, filter: shipped })
  await writeFile(join(target, CONFIG_FILE), JSON.stringify({ libraryRoot }, null, 2) + '\n')
}

/**
 * Puts the Memez overlay in the Omarchy shell and binds Super+Ctrl+M to it. Returns what happened
 * to the key binding. Throws when the shell cannot enable the plugin.
 */
export async function installOmarchy(libraryRoot: string): Promise<BindingResult> {
  if (!(await hasOmarchy())) throw new Error('This is not an Omarchy desktop.')
  await copyPlugin(libraryRoot)
  await enablePlugin()
  return bindKey()
}

export async function removeOmarchy(): Promise<void> {
  await run('omarchy', ['plugin', 'disable', PLUGIN_ID]).catch(() => undefined)
  await rm(pluginDir(), { recursive: true, force: true })
  await unbindKey()
  await run('omarchy-shell', ['shell', 'rescanPlugins']).catch(() => undefined)
}

/** A hash of every shipped file name and its bytes in `dir`. */
async function hashPlugin(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((file) => file !== CONFIG_FILE && shipped(file))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update(await readFile(join(dir, file)))
  return hash.digest('hex')
}

/**
 * At launch: if the plugin is installed and this app has another version, or uses another
 * library folder, copy it again. The shell reloads plugin files by itself; the key stays.
 */
export async function updateOmarchy(libraryRoot: string): Promise<void> {
  if (!(await isOmarchyInstalled()) || !(await exists(join(bundledDir, 'manifest.json')))) return
  const [installed, bundled, config] = await Promise.all([
    hashPlugin(pluginDir()),
    hashPlugin(bundledDir),
    readFile(join(pluginDir(), CONFIG_FILE), 'utf8').catch(() => '')
  ])
  const sameRoot = config.includes(JSON.stringify(libraryRoot))
  if (installed !== bundled || !sameRoot) await copyPlugin(libraryRoot)
}
