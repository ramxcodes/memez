import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { unzipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Settings } from '../shared/types'
import { BACKUP_DELAY_MS, BACKUP_FILE, backupHandlers, writeBackup } from './backup'
import { openLibrary } from './library'
import { parseSettings } from './settings'

const png = (seed: number): Uint8Array => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed])
const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'memez-'))
const now = new Date('2026-11-13T09:41:00Z')
const event = {} as IpcMainInvokeEvent

const libraryWith = async (count: number): ReturnType<typeof openLibrary> => {
  const library = await openLibrary(await tempDir())
  for (let seed = 0; seed < count; seed++) await library.add(png(seed))
  return library
}

describe('writeBackup', () => {
  it('writes the library zip into the folder and replaces the old one', async () => {
    const folder = await tempDir()
    await writeFile(join(folder, BACKUP_FILE), 'old backup')

    const result = await writeBackup(await libraryWith(2), folder, now)

    const zip = await readFile(join(folder, BACKUP_FILE))
    expect(result).toEqual({ state: 'done', at: now.toISOString(), bytes: zip.byteLength })
    expect(Object.keys(unzipSync(zip))).toHaveLength(3) // library.json and 2 media files
    expect(await readdir(folder)).toEqual([BACKUP_FILE]) // No temp file left.
  })

  it('returns a failure for a missing folder instead of throwing', async () => {
    const folder = join(await tempDir(), 'gone')

    const result = await writeBackup(await libraryWith(1), folder, now)

    expect(result).toMatchObject({ state: 'failed', at: now.toISOString() })
    expect(result.state === 'failed' && result.message).toContain('ENOENT')
  })
})

describe('backupHandlers', () => {
  afterEach(() => vi.useRealTimers())

  const setup = async (
    backup: Settings['backup'],
    saveSettings = vi.fn(async (): Promise<void> => undefined)
  ) => {
    const settings = { ...parseSettings(undefined), backup }
    const listeners: (() => void)[] = []
    const handlers = backupHandlers({
      library: await libraryWith(1),
      settings,
      saveSettings,
      onLibraryChanged: (listener) => listeners.push(listener)
    })
    const changed = (): void => listeners.forEach((listener) => listener())
    return { settings, handlers, saveSettings, changed }
  }
  const onAt = async (): Promise<Settings['backup']> => ({ state: 'on', folder: await tempDir() })

  it('throws a clear error when backup is off', async () => {
    const { handlers } = await setup({ state: 'off' })
    await expect(handlers.backupNow(event)).rejects.toThrow('Backup is off')
  })

  it('saves the result as lastBackup and returns it', async () => {
    const { handlers, settings, saveSettings } = await setup(await onAt())

    const result = await handlers.backupNow(event)

    expect(result.state).toBe('done')
    expect(settings.lastBackup).toEqual(result)
    expect(saveSettings).toHaveBeenCalledOnce()
  })

  it('returns a failed backup instead of throwing', async () => {
    const { handlers, settings } = await setup({ state: 'on', folder: '/no/such/folder' })

    const result = await handlers.backupNow(event)

    expect(result.state).toBe('failed')
    expect(settings.lastBackup).toEqual(result)
  })

  it('runs backups one after another, never two at once', async () => {
    let running = 0
    let most = 0
    const slowSave = vi.fn(async (): Promise<void> => {
      most = Math.max(most, ++running)
      await new Promise((resolve) => setTimeout(resolve, 10))
      running--
    })
    const { handlers } = await setup(await onAt(), slowSave)

    const results = await Promise.all([handlers.backupNow(event), handlers.backupNow(event)])

    expect(results.map((result) => result.state)).toEqual(['done', 'done'])
    expect(slowSave).toHaveBeenCalledTimes(2)
    expect(most).toBe(1)
  })

  it('backs up once, 2 minutes after the last library change', async () => {
    vi.useFakeTimers()
    const { changed, saveSettings } = await setup(await onAt())

    changed()
    await vi.advanceTimersByTimeAsync(BACKUP_DELAY_MS - 1000)
    changed() // Restarts the wait.
    await vi.advanceTimersByTimeAsync(BACKUP_DELAY_MS - 1000)
    expect(saveSettings).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1000)
    await vi.waitFor(() => expect(saveSettings).toHaveBeenCalledOnce())
  })

  it('does not back up on a library change while backup is off', async () => {
    vi.useFakeTimers()
    const { changed, saveSettings } = await setup({ state: 'off' })

    changed()
    await vi.advanceTimersByTimeAsync(BACKUP_DELAY_MS)
    expect(saveSettings).not.toHaveBeenCalled()
  })
})
