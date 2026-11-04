export const MEDIA_EXTS = ['png', 'jpg', 'webp', 'gif', 'mp4', 'webm'] as const
export type MediaExt = (typeof MEDIA_EXTS)[number]

export interface Meme {
  /** Content hash of the file. Same bytes always give the same id, so duplicates merge. */
  id: string
  ext: MediaExt
  title: string
  tags: string[]
  /** Text read from the image. `undefined` means OCR has not run yet. */
  ocrText?: string
  /** True once the local AI model has suggested a title and tags. It runs only once per meme. */
  autoTagged?: boolean
  addedAt: string
  /** Last time the meme was copied or pasted. The popup shows recent memes first. */
  usedAt?: string
}

export type MemePatch = Partial<Pick<Meme, 'title' | 'tags'>>

export interface ImportResult {
  meme: Meme
  /** True when the same file was already in the library. */
  duplicate: boolean
}

export interface ZipImportResult {
  added: number
  merged: number
  /** Entries with bad data or a missing media file. */
  skipped: number
}

/** File name of a meme inside the library `media/` folder. */
export const mediaFileName = (meme: Pick<Meme, 'id' | 'ext'>): string => `${meme.id}.${meme.ext}`

/** State of the local AI models. They download once, on first launch. */
export type ModelStatus =
  | { state: 'idle' }
  /** Downloading or reading from disk. `progress` goes from 0 to 1. */
  | { state: 'loading'; progress: number }
  | { state: 'ready' }
  | { state: 'failed'; message: string }

export interface AutoTagStatus {
  model: ModelStatus
  /** Ids of memes that wait for a title and tags. */
  pending: string[]
}

/** Settings for this device only (not part of the library or the zip export). */
export interface Settings {
  hotkey: string
  /** Local AI on: download the models, tag new memes, search by meaning. */
  localAi: boolean
  /** What picking a meme in the popup does: paste into the app behind, or only copy. */
  pasteMode: 'paste' | 'copy'
}

export type SettingsPatch = Partial<Pick<Settings, 'localAi' | 'pasteMode'>>

/** The AI models folder on this device. */
export interface ModelInfo {
  path: string
  /** Bytes on disk. 0 means not downloaded. */
  bytes: number
}

export type MediaKind = 'image' | 'gif' | 'video'

export function mediaKind(ext: MediaExt): MediaKind {
  if (ext === 'gif') return 'gif'
  if (ext === 'mp4' || ext === 'webm') return 'video'
  return 'image'
}

/** Every call from the renderer to the main process. Main and preload both implement this. */
export interface MemezIpc {
  list(): Promise<Meme[]>
  importClipboard(): Promise<ImportResult[]>
  importFiles(paths: string[]): Promise<ImportResult[]>
  importUrl(url: string): Promise<ImportResult>
  update(id: string, patch: MemePatch): Promise<Meme>
  remove(id: string): Promise<void>
  copy(id: string): Promise<void>
  /**
   * Copies the meme, hides the popup and pastes into the app behind it.
   * Falls back to copy only when macOS does not allow Memez to send keystrokes.
   */
  paste(id: string): Promise<void>
  reveal(id: string): Promise<void>
  startDrag(id: string): Promise<void>
  showContextMenu(id: string): Promise<void>
  exportZip(): Promise<string | null>
  importZip(): Promise<ZipImportResult | null>
  /** `active` is false when another app owns the shortcut. */
  getHotkey(): Promise<{ hotkey: string; active: boolean }>
  setHotkey(accelerator: string): Promise<void>
  hidePopup(): Promise<void>
  getAutoTagStatus(): Promise<AutoTagStatus>
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  getModelInfo(): Promise<ModelInfo>
  /** Unloads and deletes the models, and turns Local AI off. Fails while they are in use. */
  deleteModels(): Promise<void>
  openSettings(): Promise<void>
  showFolder(folder: 'library' | 'models'): Promise<void>
  /** macOS: true when Memez may press ⌘V for the user (Accessibility). True elsewhere. */
  canPaste(): Promise<boolean>
  openPasteAccess(): Promise<void>
  /** Ids of memes that match `query` by what is in the image, best first. Best effort. */
  semanticSearch(query: string): Promise<string[]>
  /** Starts the models: downloads them if needed, then tags every meme still to do. */
  retryAutoTag(): Promise<void>
  /** True when the Memez extension is in Raycast. */
  isRaycastInstalled(): Promise<boolean>
  /** Copies the extension into Raycast. Fails when Raycast is not installed. */
  installRaycast(): Promise<void>
  removeRaycast(): Promise<void>
}

export interface MemezApi extends MemezIpc {
  isMac: boolean
  /** Real disk path of a dropped `File`. Empty string when the file has no path. */
  pathForFile(file: File): string
  /** Runs `listener` each time the library changes. Returns an unsubscribe function. */
  onLibraryChanged(listener: () => void): () => void
  /** Runs `listener` each time the popup opens. Returns an unsubscribe function. */
  onPopupShown(listener: () => void): () => void
  /** Runs `listener` each time the AI model state or the pending list changes. */
  onAutoTagStatus(listener: (status: AutoTagStatus) => void): () => void
  /** Runs `listener` each time a setting changes, in any window. */
  onSettingsChanged(listener: () => void): () => void
}
