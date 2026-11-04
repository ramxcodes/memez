import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AutoTagStatus, MemezApi, MemezIpc } from '../shared/types'

// The main process registers one handler per `MemezIpc` key (see `registerIpc`).
const invoke = <K extends keyof MemezIpc>(
  channel: K,
  ...args: Parameters<MemezIpc[K]>
): ReturnType<MemezIpc[K]> => ipcRenderer.invoke(channel, ...args) as ReturnType<MemezIpc[K]>

const subscribe = (channel: string, listener: () => void): (() => void) => {
  const handler = (): void => listener()
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: MemezApi = {
  isMac: process.platform === 'darwin',
  list: () => invoke('list'),
  importClipboard: () => invoke('importClipboard'),
  importFiles: (paths) => invoke('importFiles', paths),
  importUrl: (url) => invoke('importUrl', url),
  update: (id, patch) => invoke('update', id, patch),
  remove: (id) => invoke('remove', id),
  copy: (id) => invoke('copy', id),
  paste: (id) => invoke('paste', id),
  reveal: (id) => invoke('reveal', id),
  startDrag: (id) => invoke('startDrag', id),
  showContextMenu: (id) => invoke('showContextMenu', id),
  exportZip: () => invoke('exportZip'),
  importZip: () => invoke('importZip'),
  getHotkey: () => invoke('getHotkey'),
  setHotkey: (accelerator) => invoke('setHotkey', accelerator),
  hidePopup: () => invoke('hidePopup'),
  getAutoTagStatus: () => invoke('getAutoTagStatus'),
  semanticSearch: (query) => invoke('semanticSearch', query),
  getSettings: () => invoke('getSettings'),
  updateSettings: (patch) => invoke('updateSettings', patch),
  getModelInfo: () => invoke('getModelInfo'),
  deleteModels: () => invoke('deleteModels'),
  openSettings: () => invoke('openSettings'),
  showFolder: (folder) => invoke('showFolder', folder),
  canPaste: () => invoke('canPaste'),
  openPasteAccess: () => invoke('openPasteAccess'),
  retryAutoTag: () => invoke('retryAutoTag'),
  isRaycastInstalled: () => invoke('isRaycastInstalled'),
  installRaycast: () => invoke('installRaycast'),
  removeRaycast: () => invoke('removeRaycast'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  onLibraryChanged: (listener) => subscribe('library:changed', listener),
  onPopupShown: (listener) => subscribe('popup:shown', listener),
  onSettingsChanged: (listener) => subscribe('settings:changed', listener),
  onAutoTagStatus: (listener) => {
    const handler = (_: unknown, status: AutoTagStatus): void => listener(status)
    ipcRenderer.on('autotag:status', handler)
    return () => ipcRenderer.off('autotag:status', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
