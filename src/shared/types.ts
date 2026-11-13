import type { ModelId, ModelRole } from './models'

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
  /**
   * Who wrote the title: the AI (Info shows an "auto" chip; "Re-tag all" may replace it) or the
   * user. Absent on memes from before this field, and on untitled memes.
   */
  titleSource?: 'ai' | 'user'
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

/** Backup of the library to a folder (iCloud Drive by default on macOS). The user's choice. */
export type Backup = { state: 'off' } | { state: 'on'; folder: string }

/** How the last backup went. Shown under the backup switch. */
export type BackupResult =
  { state: 'done'; at: string; bytes: number } | { state: 'failed'; at: string; message: string }

/** Settings for this device only (not part of the library or the zip export). */
export interface Settings {
  /** Global shortcut for the popup, like `CommandOrControl+Shift+M`. `null`: no shortcut. */
  hotkey: string | null
  /** Local AI on: download the models, tag new memes, search by meaning. */
  localAi: boolean
  /** What picking a meme in the popup does: paste into the app behind, or only copy. */
  pasteMode: 'paste' | 'copy'
  backup: Backup
  lastBackup?: BackupResult
  /** The model the local AI uses for each job. See `MODELS` in `shared/models.ts`. */
  models: Record<ModelRole, ModelId>
}

export type SettingsPatch = Partial<Pick<Settings, 'localAi' | 'pasteMode'>>

/** Download state of one model on this device. */
export type ModelDownload =
  | { state: 'none' }
  | { state: 'downloading'; progress: number }
  /** Cancel was pressed. The download stops and its files are removed. */
  | { state: 'cancelling' }
  | { state: 'ready' }
  | { state: 'failed'; message: string }

/** One model of the catalog, as it is on this device. */
export interface ModelState {
  id: ModelId
  /** True when the local AI uses this model for its role. */
  active: boolean
  download: ModelDownload
  /** Bytes on disk. 0 when not downloaded. */
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
  /** `active` is false when another app owns the shortcut, or when there is no shortcut. */
  getHotkey(): Promise<{ hotkey: string | null; active: boolean }>
  /** `null` removes the shortcut. The popup still opens from the menu-bar icon. */
  setHotkey(accelerator: string | null): Promise<void>
  hidePopup(): Promise<void>
  getAutoTagStatus(): Promise<AutoTagStatus>
  getSettings(): Promise<Settings>
  updateSettings(patch: SettingsPatch): Promise<Settings>
  /** Every model of the catalog, as it is on this device. Changes arrive with `onModelsChanged`. */
  listModels(): Promise<ModelState[]>
  /** Downloads a model, then makes it the active one for its role. Resolves when it starts. */
  downloadModel(id: ModelId): Promise<void>
  /** Stops a download and removes its files. */
  cancelDownload(id: ModelId): Promise<void>
  /** Makes a downloaded model the active one for its role. A new tag model re-reads every meme. */
  useModel(id: ModelId): Promise<void>
  /** Deletes one model's files. Deleting an active model turns Local AI off. */
  deleteModel(id: ModelId): Promise<void>
  /** Unloads and deletes all models, and turns Local AI off. Fails while they are in use. */
  deleteModels(): Promise<void>
  /** Runs the AI again on every meme: replaces AI titles and empty titles, adds tags. */
  retagAll(): Promise<void>
  /** Ids of the memes that look like this one, best first. Fails when the AI has not read it. */
  findSimilar(id: string): Promise<string[]>
  /** Ids of the memes that look like the image file at `path`, best first. */
  searchByImage(path: string): Promise<string[]>
  /** Renames a tag on every meme. Renaming into an existing tag merges them. */
  renameTag(from: string, to: string): Promise<void>
  /** Removes a tag from every meme. */
  deleteTag(tag: string): Promise<void>
  /** Turns folder backup on or off. On asks for a folder unless macOS has iCloud Drive. */
  setBackup(on: boolean): Promise<void>
  /** Asks for another backup folder. Cancel keeps the old one. */
  chooseBackupFolder(): Promise<void>
  /** Backs up now. The result is also saved as `lastBackup`. */
  backupNow(): Promise<BackupResult>
  openSettings(): Promise<void>
  showFolder(folder: 'library' | 'models'): Promise<void>
  /** The library folder for display, like `~/Memez`. */
  getLibraryFolder(): Promise<string>
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
  /** Runs `listener` each time a model's download state, size or active flag changes. */
  onModelsChanged(listener: (models: ModelState[]) => void): () => void
}
