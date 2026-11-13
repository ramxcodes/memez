import type { AiApi } from './aiWorker'
import { startAiProcess, type AiProcess } from './aiProcess'

const STOP_AFTER_IDLE_MS = 5 * 60_000

/**
 * The one AI process of the app, shared by the auto tagger and by search, so each model is in
 * memory once. It starts on the first call. It ends when no call has run for a quiet time, which
 * frees all its memory; the next call starts a new one, and the models load again there.
 * After a crash the next call also starts a new one.
 */
export function createAi() {
  // `null`: no process runs.
  let current: AiProcess | null = null
  let openCalls = 0
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const progressListeners: ((fraction: number) => void)[] = []
  const endListeners: ((crash: Error | null) => void)[] = []

  const start = (): AiProcess => {
    const started: AiProcess = startAiProcess(
      (fraction) => progressListeners.forEach((listener) => listener(fraction)),
      (crash) => {
        if (current === started) current = null
        endListeners.forEach((listener) => listener(crash))
      }
    )
    return started
  }

  /** Ends the process now. Calls in flight reject. Safe to call when no process runs. */
  const stop = (): void => {
    clearTimeout(idleTimer)
    const running = current
    if (!running) return
    current = null
    running.stop()
    endListeners.forEach((listener) => listener(null))
  }

  return {
    call<K extends keyof AiApi>(
      method: K,
      ...args: Parameters<AiApi[K]>
    ): Promise<Awaited<ReturnType<AiApi[K]>>> {
      clearTimeout(idleTimer)
      current ??= start()
      openCalls++
      return current.call(method, ...args).finally(() => {
        if (--openCalls === 0) idleTimer = setTimeout(stop, STOP_AFTER_IDLE_MS)
      })
    },

    stop,

    /** `listener` gets the download progress (0 to 1) while models load. */
    onProgress: (listener: (fraction: number) => void): void =>
      void progressListeners.push(listener),

    /** `listener` runs when the process ends: with the error after a crash, with `null` after `stop`. */
    onEnd: (listener: (crash: Error | null) => void): void => void endListeners.push(listener)
  }
}

export type Ai = ReturnType<typeof createAi>
