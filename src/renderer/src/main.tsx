import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DataModeSwitch } from './components/DataModeSwitch'
import { isModHeld } from './lib/accelerator'
import { LibraryView } from './views/LibraryView'
import { PopupView } from './views/PopupView'
import { SettingsView } from './views/SettingsView'

// `.mac` lets the system blur (vibrancy) show through. See main.css.
if (window.api.isMac) document.documentElement.classList.add('mac')

// The main process loads this page with `#library`, `#popup` or `#settings`.
const view = window.location.hash.slice(1)

// ⌘, (Ctrl+, elsewhere) opens Settings from every window. The macOS menu has it too, but the
// popup is a panel that never makes the app active, so the menu shortcut does not reach it.
window.addEventListener('keydown', (event) => {
  if (isModHeld(event, window.api.isMac) && event.key === ',') {
    event.preventDefault()
    void window.api.openSettings()
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {view === 'popup' ? <PopupView /> : view === 'settings' ? <SettingsView /> : <LibraryView />}
    {import.meta.env.DEV && window.location.search.includes('data=') && <DataModeSwitch />}
  </StrictMode>
)
