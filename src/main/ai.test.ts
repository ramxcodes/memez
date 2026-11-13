import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAi } from './ai'
import { startAiProcess } from './aiProcess'

vi.mock('./aiProcess', () => ({ startAiProcess: vi.fn() }))

const FIVE_MINUTES = 5 * 60_000

/** A fake AI process for each start. `finish` ends its open calls. */
function fakeProcess() {
  const calls: PromiseWithResolvers<unknown>[] = []
  const stop = vi.fn()
  vi.mocked(startAiProcess).mockImplementation(() => {
    const call = (): Promise<unknown> => {
      calls.push(Promise.withResolvers<unknown>())
      return calls.at(-1)!.promise
    }
    return { call, stop } as unknown as ReturnType<typeof startAiProcess>
  })
  return { stop, finish: () => calls.splice(0).forEach((call) => call.resolve(undefined)) }
}

describe('createAi', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  it('uses one process for all calls, and ends it only after a quiet time', async () => {
    const process = fakeProcess()
    const ai = createAi()
    const ended = vi.fn()
    ai.onEnd(ended)

    void ai.call('embedText', '/models', 'clip-vit-b-32', 'cat')
    void ai.call('loadTextModel', '/models', 'clip-vit-b-32')
    expect(startAiProcess).toHaveBeenCalledTimes(1)

    // A call is still open: a long read must not lose its process.
    await vi.advanceTimersByTimeAsync(2 * FIVE_MINUTES)
    expect(process.stop).not.toHaveBeenCalled()

    process.finish()
    await vi.advanceTimersByTimeAsync(FIVE_MINUTES - 1)
    expect(process.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(process.stop).toHaveBeenCalledTimes(1)
    expect(ended).toHaveBeenCalledWith(null)

    // The next call starts a new process.
    void ai.call('embedText', '/models', 'clip-vit-b-32', 'cat')
    expect(startAiProcess).toHaveBeenCalledTimes(2)
    ai.stop()
  })
})
