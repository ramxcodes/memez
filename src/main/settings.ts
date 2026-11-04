import { app } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Settings } from '../shared/types'

export type { Settings }

const DEFAULTS: Settings = { hotkey: 'CommandOrControl+Shift+M', localAi: true, pasteMode: 'paste' }
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

/** Settings for this device only (not part of the library or the zip export). */
export async function loadSettings(): Promise<Settings> {
  try {
    return { ...DEFAULTS, ...JSON.parse(await readFile(settingsPath(), 'utf8')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Bad settings.json', error)
    return { ...DEFAULTS } // A copy: callers change it.
  }
}

export const saveSettings = (settings: Settings): Promise<void> =>
  writeFile(settingsPath(), JSON.stringify(settings, null, 2))
