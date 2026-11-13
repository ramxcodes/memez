import type { ModelId, ModelRole } from '../shared/models'
import { loadTagModels, loadTextModel } from './aiModels'

// The AI process: an Electron utility process that the main process starts (see aiProcess.ts).
// It runs one model set, the tag models or the search text model. The main process ends it to
// free the memory. A native crash here ends only this process, never the app.

let tagModels: Awaited<ReturnType<typeof loadTagModels>> | undefined
let textModel: Awaited<ReturnType<typeof loadTextModel>> | undefined

const loaded = <T>(models: T | undefined): T => {
  if (!models) throw new Error('The AI models are not loaded.')
  return models
}

const api = {
  async loadTagModels(cacheDir: string, active: Record<ModelRole, ModelId>): Promise<void> {
    tagModels = await loadTagModels(cacheDir, active, (progress) =>
      process.parentPort.postMessage({ progress } satisfies AiMessage)
    )
  },
  read: (path: string, suggest: boolean) => loaded(tagModels).read(path, suggest),
  async loadTextModel(cacheDir: string, id: ModelId): Promise<void> {
    textModel = await loadTextModel(cacheDir, id)
  },
  embedText: (text: string) => loaded(textModel).embed(text)
}

/** What the AI process can do. The main process calls it with `AiProcess.call`. */
export type AiApi = typeof api

export type AiRequest = {
  [K in keyof AiApi]: { id: number; method: K; args: Parameters<AiApi[K]> }
}[keyof AiApi]

/** A call's result or error, or download progress (0 to 1) while models load. */
export type AiMessage =
  { id: number; result: unknown } | { id: number; error: string } | { progress: number }

process.parentPort.on('message', async ({ data }: { data: AiRequest }) => {
  const reply = (message: AiMessage): void => process.parentPort.postMessage(message)
  try {
    const run = api[data.method] as (...args: AiRequest['args']) => Promise<unknown>
    reply({ id: data.id, result: await run(...data.args) })
  } catch (error) {
    reply({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
