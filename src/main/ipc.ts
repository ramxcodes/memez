import type { IpcMainInvokeEvent } from 'electron'
import type { MemezIpc, Settings } from '../shared/types'
import type { AutoTagger } from './autotag'
import type { Library } from './library'
import type { Vectors } from './semantic'

/** One main-process handler per `MemezIpc` method. Its name is also the IPC channel name. */
export type Handlers = {
  [K in keyof MemezIpc]: (
    event: IpcMainInvokeEvent,
    ...args: Parameters<MemezIpc[K]>
  ) => ReturnType<MemezIpc[K]>
}

/**
 * What feature modules (backup, models) need from the app. Each module returns a `Pick` of
 * `Handlers` for the methods it owns, and `index.ts` puts them together.
 */
export interface MainContext {
  library: Library
  /** The live settings object. Change it, then call `saveSettings`. */
  settings: Settings
  libraryRoot: string
  modelDir: string
  vectors: Vectors
  autoTagger: AutoTagger
  /** Saves `settings` and tells every window. */
  saveSettings(): Promise<void>
  broadcast(channel: string, ...args: unknown[]): void
  /** Runs `listener` after each library change (add, edit, delete, AI tags, OCR, import). */
  onLibraryChanged(listener: () => void): void
}
