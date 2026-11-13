import { app } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_MODELS, MODELS, type ModelId, type ModelRole } from '../shared/models'
import type { Backup, BackupResult, Settings } from '../shared/types'
import { writeAtomic } from './library'

export type { Settings }

const DEFAULTS: Settings = {
  hotkey: 'CommandOrControl+Shift+M',
  localAi: true,
  pasteMode: 'paste',
  backup: { state: 'off' },
  models: DEFAULT_MODELS
}
const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

type Fields = Record<string, unknown>
const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null

const parseBackup = (raw: unknown): Backup | undefined => {
  if (!isFields(raw)) return undefined
  if (raw.state === 'off') return { state: 'off' }
  if (raw.state === 'on' && typeof raw.folder === 'string' && raw.folder)
    return { state: 'on', folder: raw.folder }
  return undefined
}

const parseBackupResult = (raw: unknown): BackupResult | undefined => {
  if (!isFields(raw) || typeof raw.at !== 'string') return undefined
  if (raw.state === 'done' && typeof raw.bytes === 'number')
    return { state: 'done', at: raw.at, bytes: raw.bytes }
  if (raw.state === 'failed' && typeof raw.message === 'string')
    return { state: 'failed', at: raw.at, message: raw.message }
  return undefined
}

/** The saved model for `role`, or the default when it is unknown or made for another role. */
const parseModel = (raw: unknown, role: ModelRole): ModelId =>
  MODELS.find((model) => model.id === raw && model.role === role)?.id ?? DEFAULT_MODELS[role]

/**
 * Reads a `settings.json` value. Missing or bad fields get their default, so an old file (no
 * `backup`, no `models`) and a hand-edited one both load. Never throws.
 */
export function parseSettings(raw: unknown): Settings {
  const fields = isFields(raw) ? raw : {}
  const settings = structuredClone(DEFAULTS) // A copy: callers change it, nested objects too.
  if (typeof fields.hotkey === 'string' || fields.hotkey === null) settings.hotkey = fields.hotkey
  if (typeof fields.localAi === 'boolean') settings.localAi = fields.localAi
  if (fields.pasteMode === 'paste' || fields.pasteMode === 'copy')
    settings.pasteMode = fields.pasteMode
  settings.backup = parseBackup(fields.backup) ?? settings.backup
  const lastBackup = parseBackupResult(fields.lastBackup)
  if (lastBackup) settings.lastBackup = lastBackup
  const models = isFields(fields.models) ? fields.models : {}
  settings.models = {
    caption: parseModel(models.caption, 'caption'),
    clip: parseModel(models.clip, 'clip')
  }
  return settings
}

/** Settings for this device only (not part of the library or the zip export). */
export async function loadSettings(): Promise<Settings> {
  try {
    return parseSettings(JSON.parse(await readFile(settingsPath(), 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Bad settings.json', error)
    return parseSettings(undefined)
  }
}

let lastSave: Promise<void> = Promise.resolve()

/**
 * Saves one after another, each through a temp file, so two saves at once (a setting and an
 * automatic backup) never leave a broken settings.json.
 */
export const saveSettings = (settings: Settings): Promise<void> => {
  const content = JSON.stringify(settings, null, 2)
  lastSave = lastSave.catch(() => undefined).then(() => writeAtomic(settingsPath(), content))
  return lastSave
}
