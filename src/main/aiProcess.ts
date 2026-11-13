import { utilityProcess } from 'electron'
import workerPath from './aiWorker?modulePath'
import type { AiApi, AiMessage, AiRequest } from './aiWorker'

/** The AI process ended without `stop`: it crashed or the system killed it. */
export class AiCrashError extends Error {}

/** The AI process was ended on purpose with `stop`. Not a failure of the AI. */
export class AiStoppedError extends Error {}

/**
 * Starts an AI process (see aiWorker.ts) and returns a way to call it. The app uses it through
 * `createAi` (see ai.ts), which keeps one process for all AI work.
 * The models and the image decoder use native code. In the main process a crash there ended
 * the whole app; here it ends only this process. Calls in flight then reject and `onCrash` runs.
 * `stop` ends the process on purpose and frees all its memory; `onCrash` does not run then.
 * `onProgress` gets the download progress (0 to 1) while models load.
 */
export function startAiProcess(
  onProgress: (fraction: number) => void,
  onCrash: (error: Error) => void
) {
  const child = utilityProcess.fork(workerPath, [], { serviceName: 'Memez AI' })
  const calls = new Map<number, PromiseWithResolvers<unknown>>()
  let nextId = 0
  // `null` while the process runs. After `stop` or a crash: why it ended. Calls then reject.
  let ended: Error | null = null

  const end = (reason: Error): void => {
    ended = reason
    calls.forEach((call) => call.reject(reason))
    calls.clear()
  }

  child.on('message', (message: AiMessage) => {
    if ('progress' in message) return onProgress(message.progress)
    const call = calls.get(message.id)
    calls.delete(message.id)
    if ('error' in message) call?.reject(new Error(message.error))
    else call?.resolve(message.result)
  })

  child.once('exit', (code) => {
    if (ended) return // Stopped on purpose.
    const crash = new AiCrashError(`The AI stopped unexpectedly (exit code ${code}).`)
    end(crash)
    onCrash(crash)
  })

  return {
    call<K extends keyof AiApi>(
      method: K,
      ...args: Parameters<AiApi[K]>
    ): Promise<Awaited<ReturnType<AiApi[K]>>> {
      if (ended) return Promise.reject(ended)
      const id = nextId++
      const call = Promise.withResolvers<unknown>()
      calls.set(id, call)
      child.postMessage({ id, method, args } as AiRequest)
      return call.promise as Promise<Awaited<ReturnType<AiApi[K]>>>
    },

    stop(): void {
      if (ended) return
      end(new AiStoppedError('The AI was stopped.'))
      // Before 'spawn' there is nothing to kill yet (`kill` does nothing): kill it once it starts.
      if (child.pid === undefined) child.once('spawn', () => child.kill())
      else child.kill()
    }
  }
}

export type AiProcess = ReturnType<typeof startAiProcess>
