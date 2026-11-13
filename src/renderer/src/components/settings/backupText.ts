import { isICloudFolder } from '../../../../shared/backup'
import type { Settings } from '../../../../shared/types'
import { formatSize } from '../../lib/format'

/** "today at 9:41", "yesterday at 9:41" or "on Nov 12 at 9:41", in the local time zone. */
export function formatWhen(at: Date, now: Date): string {
  const time = `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`
  const day = (date: Date): number =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((day(now) - day(at)) / 86_400_000)
  if (days === 0) return `today at ${time}`
  if (days === 1) return `yesterday at ${time}`
  return `on ${at.toLocaleDateString('en', { month: 'short', day: 'numeric' })} at ${time}`
}

/** Title, icon and status line of the backup row. */
export function backupText(
  settings: Pick<Settings, 'backup' | 'lastBackup'>,
  now: Date
): { title: string; iCloud: boolean; status: string; failed: boolean } {
  const { backup, lastBackup } = settings
  const iCloud = backup.state === 'on' && isICloudFolder(backup.folder)
  const title = iCloud ? 'Back up to iCloud Drive' : 'Back up to a folder'
  if (backup.state === 'off') return { title, iCloud, status: 'Off', failed: false }
  if (!lastBackup) return { title, iCloud, status: 'Not backed up yet', failed: false }
  if (lastBackup.state === 'failed')
    return { title, iCloud, status: `Backup failed: ${lastBackup.message}`, failed: true }
  const when = formatWhen(new Date(lastBackup.at), now)
  return {
    title,
    iCloud,
    status: `Last backup ${when} · ${formatSize(lastBackup.bytes)}`,
    failed: false
  }
}
