import { Cloud, Folder } from 'lucide-react'
import { useState } from 'react'
import type { Settings } from '../../../../shared/types'
import { IconTile, Pill, Row, Switch } from '../ui'
import { backupText } from './backupText'

/**
 * Settings → Library and backup → the backup switch, its folder, and "Back up now".
 * The result of each backup arrives as `settings.lastBackup` and shows in the status line.
 */
export function BackupRow(props: { settings: Settings; onError: (error: unknown) => void }) {
  const { backup } = props.settings
  // `backing-up` only for "Back up now"; `switching` while the switch or folder picker runs.
  const [job, setJob] = useState<'idle' | 'switching' | 'backing-up'>('idle')
  const text = backupText(props.settings, new Date())

  const run = async (
    next: 'switching' | 'backing-up',
    action: () => Promise<unknown>
  ): Promise<void> => {
    setJob(next)
    try {
      await action()
    } catch (error) {
      props.onError(error)
    }
    setJob('idle')
  }

  return (
    <Row>
      <IconTile color="blue">{text.iCloud ? <Cloud size={16} /> : <Folder size={16} />}</IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{text.title}</p>
        <p className={`text-[12px] ${text.failed ? 'text-danger' : 'text-mute'}`}>
          {job === 'backing-up' ? 'Backing up…' : text.status}
        </p>
        {backup.state === 'on' && (
          <p className="flex min-w-0 items-baseline gap-1.5 text-[12px] text-mute">
            <span className="truncate" title={backup.folder}>
              {backup.folder}
            </span>
            <button
              type="button"
              disabled={job !== 'idle'}
              title={job !== 'idle' ? 'Wait until the backup is done.' : undefined}
              onClick={() => void run('switching', window.api.chooseBackupFolder)}
              className="shrink-0 text-accent hover:underline disabled:opacity-45"
            >
              Change…
            </button>
          </p>
        )}
      </div>
      {backup.state === 'on' && (
        <Pill
          size="sm"
          disabled={job !== 'idle'}
          title={job !== 'idle' ? 'Wait until the backup is done.' : undefined}
          onClick={() => void run('backing-up', window.api.backupNow)}
        >
          {job === 'backing-up' ? 'Backing up…' : 'Back up now'}
        </Pill>
      )}
      <Switch
        label="Back up"
        checked={backup.state === 'on'}
        disabled={job !== 'idle'}
        onChange={(on) => void run('switching', () => window.api.setBackup(on))}
      />
    </Row>
  )
}
