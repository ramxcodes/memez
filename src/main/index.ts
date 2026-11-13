import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  shell,
  systemPreferences,
  Tray
} from 'electron'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { MEDIA_EXTS, mediaFileName, mediaKind, type Meme, type MemezIpc } from '../shared/types'
import { backupHandlers } from './backup'
import { exportZip, importZip } from './archive'
import { createAi } from './ai'
import { createAutoTagger } from './autotag'
import { grabFrames } from './frames'
import { downloadMedia, readClipboardMedia, readFiles } from './ingest'
import type { Handlers, MainContext } from './ipc'
import { openLibrary, type Library } from './library'
import { parseLink } from './links'
import { modelHandlers } from './models'
import { createOcrQueue } from './ocr'
import { installRaycast, isRaycastInstalled, removeRaycast, updateRaycast } from './raycast'
import { createSemanticSearch, openVectors } from './semantic'
import { loadSettings, saveSettings, type Settings } from './settings'
import { createLibraryWindow, createPopupWindow, createSettingsWindow, showPopup } from './windows'

// `MEMEZ_LIBRARY` points dev and test runs at another folder.
const LIBRARY_ROOT = process.env['MEMEZ_LIBRARY'] ?? join(homedir(), 'Memez')
const MEDIA_NAME = new RegExp(`^[a-f0-9]{16}\\.(${MEDIA_EXTS.join('|')})$`)

// `meme://media/<file>` serves library files to the renderer. Must run before `app` is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'meme',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

let quitting = false
let libraryWindow: BrowserWindow
let popup: BrowserWindow
let tray: Tray
let settingsWindow: BrowserWindow | null = null
let semanticSearch: ReturnType<typeof createSemanticSearch>
// `memez://` links from Raycast. A link can start the app, so it waits until the app is ready.
const linkHandler = Promise.withResolvers<(url: string) => Promise<void>>()

const broadcast = (channel: string, ...args: unknown[]): void =>
  BrowserWindow.getAllWindows().forEach((window) => window.webContents.send(channel, ...args))

function openLibraryWindow(): void {
  libraryWindow.show()
  libraryWindow.focus()
}

/** Opens Settings (⌘,). From the popup too, which is a panel, so pull the app to the front. */
function openSettings(): void {
  popup.hide()
  if (!settingsWindow || settingsWindow.isDestroyed()) settingsWindow = createSettingsWindow()
  else settingsWindow.show()
  settingsWindow.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

/** The macOS menu bar: the standard menus, plus Settings… (⌘,) in the app menu. */
function setAppMenu(): void {
  if (process.platform !== 'darwin') return
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        role: 'appMenu',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'CommandOrControl+,', click: openSettings },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

/** Shows the popup and loads the search model, so the first search by meaning is fast. */
function openPopup(): void {
  showPopup(popup)
  semanticSearch.warm()
}

function togglePopup(): void {
  if (popup.isVisible()) popup.hide()
  else openPopup()
}

/**
 * Registers the popup hotkey. `null` leaves no hotkey. Keeps the old hotkey when the new one is
 * taken by another app.
 */
function registerHotkey(next: string | null, previous?: string | null): void {
  globalShortcut.unregisterAll()
  if (next === null || globalShortcut.register(next, togglePopup)) return
  if (previous) globalShortcut.register(previous, togglePopup)
  throw new Error(`${next} is not available. Another app may use it.`)
}

/**
 * Puts a meme on the clipboard. Still images go as image data and as a file, so they paste
 * into image editors and chat apps. GIFs and videos go only as a file: as image data they
 * would lose their animation.
 */
async function copyMeme(library: Library, meme: Meme): Promise<void> {
  const path = library.pathOf(meme)
  const formats: Record<string, string | Blob> = { 'text/uri-list': pathToFileURL(path).href }
  if (mediaKind(meme.ext) === 'image') {
    const png = nativeImage.createFromPath(path).toPNG()
    if (png.length > 0)
      formats['image/png'] = new Blob([new Uint8Array(png)], { type: 'image/png' })
  }
  await clipboard.write([new ClipboardItem(formats)])
}

// Posts ⌘V as a key event (CGEventPost) from macOS's built-in JavaScript. It needs only the
// Accessibility permission. The older `System Events` way also needed "control this Mac"
// (Automation), a second prompt. Source 1 is the HID system state, 9 is the V key,
// 0x100000 is the Command flag, tap 0 is the HID event tap.
const PASTE_SCRIPT = `
ObjC.import('CoreGraphics')
const source = $.CGEventSourceCreate(1)
for (const keyDown of [true, false]) {
  const event = $.CGEventCreateKeyboardEvent(source, 9, keyDown)
  $.CGEventSetFlags(event, 0x100000)
  $.CGEventPost(0, event)
}`

/**
 * Sends ⌘V to the app in front. Throws when Memez has no Accessibility permission.
 * It never shows the macOS prompt itself: Settings → Allow… does that, once.
 */
async function pasteIntoFrontApp(): Promise<void> {
  if (!systemPreferences.isTrustedAccessibilityClient(false))
    throw new Error('To paste for you, Memez needs Accessibility access. Open Settings (⌘,).')
  await promisify(execFile)('osascript', ['-l', 'JavaScript', '-e', PASTE_SCRIPT])
}

/** The small picture under the pointer while dragging. macOS needs a non-empty one. */
function dragIcon(library: Library, meme: Meme): Electron.NativeImage {
  const preview =
    mediaKind(meme.ext) === 'video' ? null : nativeImage.createFromPath(library.pathOf(meme))
  const image = preview && !preview.isEmpty() ? preview : nativeImage.createFromPath(icon)
  return image.resize({ width: 96 })
}

/** Sets the menu-bar menu. Runs again when the hotkey changes, to show the new shortcut. */
function setTrayMenu(tray: Tray, settings: Settings): void {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Search Memes', accelerator: settings.hotkey ?? undefined, click: openPopup },
      { label: 'Open Library', click: openLibraryWindow },
      { label: 'Settings…', click: openSettings },
      { type: 'separator' },
      { label: 'Quit Memez', role: 'quit' }
    ])
  )
}

async function registerIpc(library: Library, settings: Settings): Promise<void> {
  const libraryListeners: (() => void)[] = []
  const libraryChanged = (): void => {
    broadcast('library:changed')
    libraryListeners.forEach((listener) => listener())
  }
  const queueOcr = createOcrQueue(library, libraryChanged)
  const modelDir = join(app.getPath('userData'), 'models')
  const vectors = await openVectors(join(LIBRARY_ROOT, 'vectors.json'))
  await vectors.keepOnly(library.list().map((meme) => meme.id))
  const localAi = (): boolean => settings.localAi
  const activeModels = (): Settings['models'] => settings.models
  const ai = createAi()
  semanticSearch = createSemanticSearch(ai, modelDir, vectors, localAi, activeModels)
  const autoTagger = createAutoTagger(
    library,
    vectors,
    ai,
    modelDir,
    localAi,
    activeModels,
    (status) => broadcast('autotag:status', status),
    libraryChanged,
    // Only videos and GIFs come here (see autotag.ts).
    (meme) =>
      grabFrames(
        `meme://media/${mediaFileName(meme)}`,
        mediaKind(meme.ext) === 'gif' ? 'gif' : 'video'
      )
  )

  const addAll = async (files: Uint8Array[]): ReturnType<MemezIpc['importFiles']> => {
    const results = []
    for (const bytes of files) results.push(await library.add(bytes))
    results.forEach(({ meme }) => queueOcr(meme))
    autoTagger.queue(results.map(({ meme }) => meme))
    libraryChanged()
    return results
  }

  /** Runs a `memez://` link. No window is open, so the result shows as a notification. */
  const openLink = async (url: string): Promise<void> => {
    try {
      const link = parseLink(url)
      if (link.action === 'used') {
        await library.markUsed(link.id)
        libraryChanged()
        return
      }
      const results = await addAll(await readClipboardMedia())
      const added = results.filter((result) => !result.duplicate).length
      new Notification({
        title: added > 0 ? 'Added to Memez' : 'Already in Memez',
        body: results.map((result) => result.meme.title || 'Untitled meme').join(', ')
      }).show()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      new Notification({ title: 'Memez could not do that', body: message }).show()
    }
  }
  linkHandler.resolve(openLink)

  const saveAndBroadcast = async (): Promise<void> => {
    await saveSettings(settings)
    broadcast('settings:changed')
  }

  const ctx: MainContext = {
    library,
    settings,
    libraryRoot: LIBRARY_ROOT,
    modelDir,
    vectors,
    autoTagger,
    saveSettings: saveAndBroadcast,
    broadcast,
    onLibraryChanged: (listener) => libraryListeners.push(listener)
  }

  library.list().forEach(queueOcr)
  // First launch with Local AI on: this downloads the models.
  if (settings.localAi) autoTagger.start()

  const handlers: Handlers = {
    list: async () => library.list(),
    importClipboard: async () => addAll(await readClipboardMedia()),
    importFiles: async (_, paths) => addAll(await readFiles(paths)),
    importUrl: async (_, url) => (await addAll([await downloadMedia(url)]))[0],
    update: async (_, id, patch) => {
      const meme = await library.update(id, patch)
      libraryChanged()
      return meme
    },
    remove: async (_, id) => {
      await library.remove(id)
      libraryChanged()
    },
    copy: async (_, id) => {
      await copyMeme(library, library.get(id))
      await library.markUsed(id)
      libraryChanged()
    },
    paste: async (_, id) => {
      await copyMeme(library, library.get(id))
      await library.markUsed(id)
      libraryChanged()
      popup.hide()
      // Copy only: the user chose it in Settings, or the system cannot paste for us.
      if (settings.pasteMode === 'copy' || process.platform !== 'darwin') return
      // Wait for focus to go back to the app behind the popup.
      await new Promise((resolve) => setTimeout(resolve, 120))
      try {
        await pasteIntoFrontApp()
      } catch (error) {
        // The popup is hidden now, so tell the user with a system notification.
        const message = error instanceof Error ? error.message : String(error)
        new Notification({ title: 'Meme copied, not pasted', body: message }).show()
      }
    },
    reveal: async (_, id) => shell.showItemInFolder(library.pathOf(library.get(id))),
    startDrag: async (event, id) => {
      const meme = library.get(id)
      event.sender.startDrag({ file: library.pathOf(meme), icon: dragIcon(library, meme) })
    },
    showContextMenu: async (event, id) => {
      const meme = library.get(id)
      const path = library.pathOf(meme)
      Menu.buildFromTemplate([
        { label: 'Copy', click: () => void copyMeme(library, meme) },
        {
          label: process.platform === 'darwin' ? 'Show in Finder' : 'Show in Folder',
          click: () => shell.showItemInFolder(path)
        },
        { label: 'Copy Path', click: () => void clipboard.writeText(path) }
      ]).popup({ window: BrowserWindow.fromWebContents(event.sender) ?? undefined })
    },
    exportZip: async () => {
      const date = new Date().toISOString().slice(0, 10)
      const { filePath } = await dialog.showSaveDialog(libraryWindow, {
        defaultPath: join(app.getPath('downloads'), `memez-${date}.zip`),
        filters: [{ name: 'Zip', extensions: ['zip'] }]
      })
      if (!filePath) return null
      await writeFile(filePath, await exportZip(library))
      return filePath
    },
    importZip: async () => {
      const { filePaths } = await dialog.showOpenDialog(libraryWindow, {
        filters: [{ name: 'Zip', extensions: ['zip'] }],
        properties: ['openFile']
      })
      if (!filePaths[0]) return null
      const result = await importZip(library, await readFile(filePaths[0]))
      library.list().forEach(queueOcr)
      autoTagger.queue(library.list())
      libraryChanged()
      return result
    },
    getHotkey: async () => ({
      hotkey: settings.hotkey,
      active: settings.hotkey !== null && globalShortcut.isRegistered(settings.hotkey)
    }),
    setHotkey: async (_, hotkey) => {
      registerHotkey(hotkey, settings.hotkey)
      settings.hotkey = hotkey
      await saveAndBroadcast()
      setTrayMenu(tray, settings)
    },
    getSettings: async () => ({ ...settings }),
    updateSettings: async (_, patch) => {
      Object.assign(settings, patch)
      await saveAndBroadcast()
      if (patch.localAi === true) autoTagger.start()
      if (patch.localAi === false) {
        // Free the memory now; the files stay until the user deletes them.
        autoTagger.stop()
        autoTagger.unload()
      }
      return { ...settings }
    },
    openSettings: async () => openSettings(),
    showFolder: async (_, folder) => {
      const path = folder === 'library' ? LIBRARY_ROOT : modelDir
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    getLibraryFolder: async () =>
      LIBRARY_ROOT.startsWith(homedir()) && process.platform !== 'win32'
        ? `~${LIBRARY_ROOT.slice(homedir().length)}`
        : LIBRARY_ROOT,
    canPaste: async () =>
      process.platform !== 'darwin' || systemPreferences.isTrustedAccessibilityClient(false),
    openPasteAccess: async () => {
      systemPreferences.isTrustedAccessibilityClient(true) // Adds Memez to the list.
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
      )
    },
    hidePopup: async () => popup.hide(),
    getAutoTagStatus: async () => autoTagger.status(),
    semanticSearch: async (_, query) => semanticSearch.search(query),
    retryAutoTag: async () => autoTagger.start(),
    isRaycastInstalled: async () => isRaycastInstalled(),
    installRaycast: async () => installRaycast(),
    removeRaycast: async () => removeRaycast(),
    renameTag: async (_, from, to) => {
      await library.renameTag(from, to)
      libraryChanged()
    },
    deleteTag: async (_, tag) => {
      await library.deleteTag(tag)
      libraryChanged()
    },
    ...backupHandlers(ctx),
    ...modelHandlers(ctx)
  }

  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler)
}

// Must be added before the app is ready: the link that starts the app arrives early.
app.on('open-url', (event, url) => {
  event.preventDefault()
  void linkHandler.promise.then((open) => open(url))
})

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ramxcodes.memez')
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))
  app.on('before-quit', () => (quitting = true))
  app.on('activate', openLibraryWindow)

  let library: Library
  try {
    library = await openLibrary(LIBRARY_ROOT)
  } catch (error) {
    // Do not start with an empty library: a later save would overwrite the user's data.
    dialog.showErrorBox('Memez cannot open the library', `${LIBRARY_ROOT}\n\n${String(error)}`)
    app.exit(1)
    return
  }

  protocol.handle('meme', (request) => {
    const name = new URL(request.url).pathname.slice(1)
    if (!MEDIA_NAME.test(name)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(join(library.mediaDir, name)).href)
  })

  const settings = await loadSettings()
  await registerIpc(library, settings)
  libraryWindow = createLibraryWindow(() => quitting)
  popup = createPopupWindow()
  setAppMenu()
  tray = new Tray(nativeImage.createFromPath(icon).resize({ width: 18, height: 18 }))
  tray.setToolTip('Memez')
  setTrayMenu(tray, settings)

  try {
    registerHotkey(settings.hotkey)
  } catch (error) {
    // The library window shows the hotkey as not active, so the user can pick another one.
    console.warn(error)
  }

  // Best effort: an old extension still works, so a failed update must not stop the app.
  updateRaycast().catch((error) => console.warn('Raycast extension update failed', error))
})

app.on('will-quit', () => globalShortcut.unregisterAll())
