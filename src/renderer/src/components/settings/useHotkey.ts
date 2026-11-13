import { useCallback, useEffect, useState } from 'react'
import { toAccelerator } from '../../lib/accelerator'

type Hotkey = Awaited<ReturnType<typeof window.api.getHotkey>>

/**
 * The popup hotkey and its recorder. `record()` waits for the next key combination and saves it;
 * Escape or `cancel()` stops. `remove()` leaves no shortcut. `onError` must be stable.
 */
export function useHotkey(onError: (error: unknown) => void) {
  const [hotkey, setHotkey] = useState<Hotkey | null>(null)
  const [recording, setRecording] = useState(false)

  const load = useCallback((): void => {
    window.api.getHotkey().then(setHotkey, onError)
  }, [onError])

  // Reload when another window changes the hotkey.
  useEffect(() => {
    load()
    return window.api.onSettingsChanged(load)
  }, [load])

  useEffect(() => {
    if (!recording) return
    const onKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      if (event.key === 'Escape') return setRecording(false)
      const accelerator = toAccelerator(event)
      if (!accelerator) return // Only modifiers so far, or a key without one.
      setRecording(false)
      window.api.setHotkey(accelerator).then(load, onError)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recording, load, onError])

  return {
    hotkey,
    recording,
    record: () => setRecording(true),
    cancel: () => setRecording(false),
    remove: () => window.api.setHotkey(null).then(load, onError)
  }
}
