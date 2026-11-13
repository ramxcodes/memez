import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { access, cp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'

// The built extension (`npm run build:raycast`). `resources/` is unpacked from the asar archive,
// so this is a real folder on disk.
const bundledDir = join(__dirname, '../../resources/raycast').replace(
  'app.asar',
  'app.asar.unpacked'
)
// Raycast loads private extensions from here. `ray build` writes to the same place.
const installedDir = join(homedir(), '.config', 'raycast', 'extensions', 'memez')
const MAIN_FILE = 'search-memes.js'

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false
  )

/** True when the Memez extension is in Raycast's folder. */
export const isRaycastInstalled = (): Promise<boolean> => exists(join(installedDir, 'package.json'))

/**
 * Sends Raycast a message of its `ray` tool about the installed extension. In the background, so
 * Raycast does not come to the front. Opening the link also starts Raycast if it is not running.
 */
const tellRaycast = (action: 'start' | 'build-success' | 'stop' | 'build-refresh'): Promise<void> =>
  shell.openExternal(
    `raycast://cli/memez/${action}?cwd=${encodeURIComponent(installedDir)}&info=`,
    { activate: false }
  )

// The files `ray develop` keeps in the extension folder while a development session runs.
const SESSION_FILES = ['cli.pid', 'dev.log'].map((name) => join(installedDir, name))

/**
 * Makes Raycast add the extension in `installedDir`. Raycast adds a local extension only when a
 * development session starts for it, which is what `ray develop` does. `build-refresh` alone
 * only reloads an extension Raycast already has, so on a Mac that never ran `ray develop` the
 * commands did not show. This starts a session the same way and stops it at once; the extension
 * stays in Raycast after that, as it does after `ray develop` ends.
 */
async function registerWithRaycast(): Promise<void> {
  await writeFile(SESSION_FILES[0], String(process.pid))
  await writeFile(SESSION_FILES[1], '')
  try {
    await tellRaycast('start')
    await tellRaycast('build-success')
    await wait(1000) // Raycast reads the folder after the messages.
  } finally {
    await Promise.all(SESSION_FILES.map((file) => rm(file, { force: true })))
  }
  await tellRaycast('stop')
}

const hasRaycast = (): boolean => Boolean(app.getApplicationNameForProtocol('raycast://'))

/** Copies the built extension into Raycast. Throws when Raycast or the built files are missing. */
export async function installRaycast(): Promise<void> {
  if (!hasRaycast())
    throw new Error('Raycast is not installed. Get it from raycast.com, then try again.')
  if (!(await exists(join(bundledDir, MAIN_FILE))))
    throw new Error('This build of Memez has no Raycast extension. Run npm run build:raycast.')
  await rm(installedDir, { recursive: true, force: true })
  await cp(bundledDir, installedDir, { recursive: true })
  await registerWithRaycast()
}

export async function removeRaycast(): Promise<void> {
  await rm(installedDir, { recursive: true, force: true })
  // Raycast may be gone already; then there is nothing to tell.
  if (hasRaycast()) await tellRaycast('build-refresh')
}

/** A hash of every file name and its bytes in `dir`. Any change to the extension changes it. */
async function hashFolder(dir: string): Promise<string> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort()
  const hash = createHash('sha256')
  for (const file of files) hash.update(file).update(await readFile(join(dir, file)))
  return hash.digest('hex')
}

/** At launch: if the extension is installed and this app has another version, install it again. */
export async function updateRaycast(): Promise<void> {
  if (!(await isRaycastInstalled()) || !(await exists(join(bundledDir, MAIN_FILE)))) return
  const [installed, bundled] = await Promise.all([hashFolder(installedDir), hashFolder(bundledDir)])
  if (installed !== bundled) await installRaycast()
}
