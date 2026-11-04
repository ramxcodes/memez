import { Keyboard } from 'lucide-react'
import { useEffect, useState } from 'react'
import { acceleratorKeys, toAccelerator } from '../lib/accelerator'
import { Keycaps } from './ui'

/** Row with the popup hotkey (sidebar and Settings). Click it, then press a new key combination to change it. */
export function HotkeyButton({ onError }: { onError: (error: unknown) => void }) {
  const [hotkey, setHotkey] = useState<{ hotkey: string; active: boolean } | null>(null)
  const [recording, setRecording] = useState(false)

  // Reload when Settings (or this button in another window) changes the hotkey.
  useEffect(() => {
    const load = (): void => {
      window.api.getHotkey().then(setHotkey, onError)
    }
    load()
    return window.api.onSettingsChanged(load)
  }, [onError])

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      if (event.key === 'Escape') return setRecording(false)
      const accelerator = toAccelerator(event)
      if (!accelerator) return
      setRecording(false)
      window.api
        .setHotkey(accelerator)
        .then(() => setHotkey({ hotkey: accelerator, active: true }), onError)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recording, onError])

  const inactive = hotkey && !hotkey.active && !recording

  return (
    <button
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      title={
        inactive ? 'Another app uses this shortcut. Click to pick a new one.' : 'Click to change'
      }
      className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-control ${
        recording ? 'bg-accent/10 ring-1 ring-accent/50' : ''
      }`}
    >
      <Keyboard size={15} className="shrink-0 text-secondary" />
      <span className="flex-1 truncate">{recording ? 'Type a shortcut…' : 'Quick Search'}</span>
      {inactive && <span className="size-1.5 shrink-0 rounded-full bg-danger" />}
      {hotkey && !recording && <Keycaps keys={acceleratorKeys(hotkey.hotkey)} />}
    </button>
  )
}
