import { BrowserWindow, dialog, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron'
import { mkdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ICLOUD_DRIVE } from '../shared/backup'
import type { BackupResult } from '../shared/types'
import { exportZip } from './archive'
import type { Handlers, MainContext } from './ipc'
import { writeAtomic, type Library } from './library'

export const BACKUP_FILE = 'Memez backup.zip'

/** Time from the last library change to the automatic backup. */
export const BACKUP_DELAY_MS = 2 * 60 * 1000

/**
 * Writes the library zip to `<folder>/Memez backup.zip`. It writes a temp file in the same folder
 * first, then renames it, so the old backup stays whole until the new one is complete.
 * Never throws: a failure (folder missing, not writable, disk full) is the result.
 */
export async function writeBackup(
  library: Library,
  folder: string,
  now: Date
): Promise<BackupResult> {
  const at = now.toISOString()
  const path = join(folder, BACKUP_FILE)
  try {
    const zip = await exportZip(library)
    await writeAtomic(path, zip)
    return { state: 'done', at, bytes: zip.byteLength }
  } catch (error) {
    await rm(`${path}.tmp`, { force: true }).catch(() => undefined)
    return { state: 'failed', at, message: error instanceof Error ? error.message : String(error) }
  }
}

/** macOS with iCloud Drive: its `Memez` folder, created if needed. Otherwise `null`. */
async function iCloudFolder(): Promise<string | null> {
  if (process.platform !== 'darwin') return null
  const drive = join(homedir(), ICLOUD_DRIVE)
  const isDrive = await stat(drive).then(
    (info) => info.isDirectory(),
    () => false
  )
  if (!isDrive) return null
  const folder = join(drive, 'Memez')
  await mkdir(folder, { recursive: true })
  return folder
}

/** Asks the user for a backup folder, over the window that asked. `null` on cancel. */
async function pickFolder(event: IpcMainInvokeEvent): Promise<string | null> {
  const options: OpenDialogOptions = {
    title: 'Choose a backup folder',
    buttonLabel: 'Choose',
    properties: ['openDirectory', 'createDirectory']
  }
  const parent = BrowserWindow.fromWebContents(event.sender)
  const { canceled, filePaths } = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return canceled ? null : (filePaths[0] ?? null)
}

/**
 * Folder backup: the switch, the folder, "Back up now", and a backup 2 minutes after the last
 * library change. Backups run one after another, never two at once.
 */
export function backupHandlers(
  ctx: Pick<MainContext, 'library' | 'settings' | 'saveSettings' | 'onLibraryChanged'>
): Pick<Handlers, 'setBackup' | 'chooseBackupFolder' | 'backupNow'> {
  const { settings } = ctx
  let queue: Promise<unknown> = Promise.resolve()

  /** Backs up once, after any backup that is running. Throws only when backup is off. */
  const backupNow = (): Promise<BackupResult> => {
    const run = queue.then(async () => {
      const { backup } = settings
      if (backup.state === 'off') throw new Error('Backup is off. Turn it on in Settings.')
      settings.lastBackup = await writeBackup(ctx.library, backup.folder, new Date())
      await ctx.saveSettings()
      return settings.lastBackup
    })
    queue = run.catch(() => undefined)
    return run
  }

  const switchTo = async (folder: string): Promise<void> => {
    settings.backup = { state: 'on', folder }
    await ctx.saveSettings()
    await backupNow()
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  ctx.onLibraryChanged(() => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (settings.backup.state === 'off') return
      // The result is saved as `lastBackup` and shows in Settings.
      backupNow().catch((error) => console.warn('Automatic backup failed', error))
    }, BACKUP_DELAY_MS)
  })

  return {
    setBackup: async (event, on) => {
      if (!on) {
        settings.backup = { state: 'off' }
        await ctx.saveSettings()
        return
      }
      const folder = (await iCloudFolder()) ?? (await pickFolder(event))
      if (folder) await switchTo(folder) // Cancel: backup stays off.
    },
    chooseBackupFolder: async (event) => {
      const folder = await pickFolder(event)
      if (folder) await switchTo(folder) // Cancel: keep the old folder.
    },
    backupNow: () => backupNow()
  }
}
