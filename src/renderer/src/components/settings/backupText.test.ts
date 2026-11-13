import { describe, expect, it } from 'vitest'
import { backupText, formatWhen } from './backupText'

const now = new Date(2026, 10, 13, 15, 0)
const iCloud = '/Users/ram/Library/Mobile Documents/com~apple~CloudDocs/Memez'

describe('formatWhen', () => {
  it('says today, yesterday, or the date', () => {
    expect(formatWhen(new Date(2026, 10, 13, 9, 41), now)).toBe('today at 9:41')
    expect(formatWhen(new Date(2026, 10, 12, 23, 5), now)).toBe('yesterday at 23:05')
    expect(formatWhen(new Date(2026, 10, 2, 9, 41), now)).toBe('on Nov 2 at 9:41')
  })
})

describe('backupText', () => {
  it('says Off while backup is off, even after an earlier backup', () => {
    const lastBackup = { state: 'done', at: now.toISOString(), bytes: 1e6 } as const
    expect(backupText({ backup: { state: 'off' }, lastBackup }, now)).toEqual({
      title: 'Back up to a folder',
      iCloud: false,
      status: 'Off',
      failed: false
    })
  })

  it('names iCloud Drive only for an iCloud folder', () => {
    expect(backupText({ backup: { state: 'on', folder: iCloud } }, now)).toMatchObject({
      title: 'Back up to iCloud Drive',
      iCloud: true,
      status: 'Not backed up yet'
    })
    expect(backupText({ backup: { state: 'on', folder: '/mnt/usb' } }, now).iCloud).toBe(false)
  })

  it('shows the last result', () => {
    const backup = { state: 'on', folder: iCloud } as const
    const done = {
      state: 'done',
      at: new Date(2026, 10, 13, 9, 41).toISOString(),
      bytes: 182e6
    } as const
    const failed = { state: 'failed', at: now.toISOString(), message: 'Disk full' } as const

    expect(backupText({ backup, lastBackup: done }, now).status).toBe(
      'Last backup today at 9:41 · 182 MB'
    )
    expect(backupText({ backup, lastBackup: failed }, now)).toMatchObject({
      status: 'Backup failed: Disk full',
      failed: true
    })
  })
})
