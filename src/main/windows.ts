import {
  BrowserWindow,
  nativeTheme,
  screen,
  shell,
  type BrowserWindowConstructorOptions
} from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'

export type View = 'library' | 'popup' | 'settings'

const isMac = process.platform === 'darwin'

// On macOS the window is clear and the system blur (vibrancy) shows through where CSS has no
// background. Elsewhere there is no vibrancy, so paint the theme color to avoid a white flash.
const background = (): string =>
  isMac ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#ffffff'

function createWindow(view: View, options: BrowserWindowConstructorOptions): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    backgroundColor: background(),
    ...options,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Both windows load the same page. The hash tells the renderer which view to show.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${view}`)
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'), { hash: view })
  }
  return window
}

/** The library window. Closing it only hides it, so the hotkey keeps working. */
export function createLibraryWindow(isQuitting: () => boolean): BrowserWindow {
  const window = createWindow('library', {
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 560,
    title: 'Memez',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar'
  })
  window.on('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (isQuitting()) return
    event.preventDefault()
    window.hide()
  })
  return window
}

/** The Settings window (⌘,). Small and fixed, like macOS settings windows. */
export function createSettingsWindow(): BrowserWindow {
  const window = createWindow('settings', {
    width: 460,
    height: 580,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Settings',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 }
  })
  window.on('ready-to-show', () => window.show())
  return window
}

const POPUP_SIZE = { width: 560, height: 300 }

/**
 * The hotkey search window. On macOS it is a panel: it floats over full-screen apps and does not
 * pull the whole app to the front, so focus goes back to the previous app when it hides.
 */
export function createPopupWindow(): BrowserWindow {
  const window = createWindow('popup', {
    ...POPUP_SIZE,
    type: isMac ? 'panel' : undefined,
    frame: false,
    transparent: !isMac,
    backgroundColor: '#00000000',
    vibrancy: 'popover',
    // A panel never makes the app active, so keep the blur in its active look.
    visualEffectState: 'active',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true
  })
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.on('blur', () => window.hide())
  return window
}

/** Shows the popup near the top of the screen that has the mouse pointer. */
export function showPopup(popup: BrowserWindow): void {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  popup.setPosition(
    Math.round(workArea.x + (workArea.width - POPUP_SIZE.width) / 2),
    Math.round(workArea.y + workArea.height * 0.2)
  )
  popup.show()
  popup.focus()
  popup.webContents.send('popup:shown')
}
