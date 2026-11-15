import { Command } from 'lucide-react'
import { acceleratorKeys } from '../../lib/accelerator'
import { useDesktopSupport } from '../../lib/hooks'
import { IconTile, Keycaps, Pill, Row } from '../ui'
import { useHotkey } from './useHotkey'

/** Settings → Quick search → Hotkey: shows the shortcut, records a new one, or removes it. */
export function HotkeyRow({ onError }: { onError: (error: unknown) => void }) {
  const { hotkey, recording, record, cancel, remove } = useHotkey(onError)
  const accelerator = hotkey?.hotkey ?? null
  // On Wayland the desktop owns global keys: Memez can ask for one through the desktop portal,
  // but cannot tell whether it works (Hyprland, for one, needs a binding in its own config).
  const wayland = useDesktopSupport()?.session === 'wayland'
  const icon = window.api.isMac ? 'menu bar icon' : 'tray icon'

  const status = recording
    ? { text: 'Press the new shortcut. Escape cancels.', danger: false }
    : !hotkey
      ? { text: 'Opens the meme popup from any app.', danger: false }
      : accelerator === null
        ? { text: `No shortcut. Open the popup from the ${icon}.`, danger: false }
        : wayland
          ? {
              text: 'Wayland: works only if your desktop passes it on. If it does nothing, bind the command below.',
              danger: false
            }
          : !hotkey.active
            ? { text: 'Another app uses this shortcut.', danger: true }
            : { text: 'Opens the meme popup from any app.', danger: false }

  return (
    <Row>
      <IconTile color="indigo">
        <Command size={16} />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="font-medium">Hotkey</p>
        <p className={`text-[12px] ${status.danger ? 'text-danger' : 'text-mute'}`}>
          {status.text}
        </p>
      </div>
      {recording ? (
        <Pill size="sm" onClick={cancel}>
          Cancel
        </Pill>
      ) : accelerator === null ? (
        <Pill
          size="sm"
          onClick={record}
          disabled={!hotkey}
          title={hotkey ? undefined : 'The hotkey has not loaded. Reopen Settings.'}
        >
          Set
        </Pill>
      ) : (
        <>
          <Keycaps keys={acceleratorKeys(accelerator, window.api.isMac)} />
          <Pill size="sm" onClick={record}>
            Change
          </Pill>
          <Pill size="sm" variant="danger" onClick={() => void remove()}>
            Remove
          </Pill>
        </>
      )}
    </Row>
  )
}
