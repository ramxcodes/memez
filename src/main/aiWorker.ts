import { createModels } from './aiModels'

// The AI process: an Electron utility process that the main process starts (see aiProcess.ts).
// It holds every model the app uses (see aiModels.ts). The main process ends it to free the
// memory. A native crash here ends only this process, never the app.

const models = createModels((progress) =>
  process.parentPort.postMessage({ progress } satisfies AiMessage)
)

/** What the AI process can do. The main process calls it with `Ai.call`. */
export type AiApi = typeof models

export type AiRequest = {
  [K in keyof AiApi]: { id: number; method: K; args: Parameters<AiApi[K]> }
}[keyof AiApi]

/** A call's result or error, or download progress (0 to 1) while models load. */
export type AiMessage =
  { id: number; result: unknown } | { id: number; error: string } | { progress: number }

process.parentPort.on('message', async ({ data }: { data: AiRequest }) => {
  const reply = (message: AiMessage): void => process.parentPort.postMessage(message)
  try {
    const run = models[data.method] as (...args: AiRequest['args']) => Promise<unknown>
    reply({ id: data.id, result: await run(...data.args) })
  } catch (error) {
    reply({ id: data.id, error: error instanceof Error ? error.message : String(error) })
  }
})
