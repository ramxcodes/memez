import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODELS } from '../shared/models'
import type { AutoTagStatus } from '../shared/types'
import { AiCrashError, startAiProcess } from './aiProcess'
import { createAutoTagger } from './autotag'
import { openLibrary } from './library'
import { openVectors } from './semantic'

vi.mock('./aiProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiProcess')>()),
  startAiProcess: vi.fn()
}))

/**
 * A fake AI process for each start. Each `read` takes the next outcome: `crash` ends the process
 * the way a native crash does (open calls reject, `onCrash` runs).
 */
function fakeAi(outcomes: ('ok' | 'crash')[]): { started: () => number } {
  let started = 0
  vi.mocked(startAiProcess).mockImplementation((_onProgress, onCrash) => {
    started++
    const call = async (method: string): Promise<unknown> => {
      if (method !== 'read') return undefined
      if (outcomes.shift() === 'crash') {
        const crash = new AiCrashError('The AI stopped unexpectedly (exit code 11).')
        onCrash(crash)
        throw crash
      }
      return { vector: [1, 0], suggestion: { title: 'Cat', tags: ['cat'] } }
    }
    return { call, stop: () => undefined } as ReturnType<typeof startAiProcess>
  })
  return { started: () => started }
}

/** Runs the tagger on three new memes and waits until the queue is empty. */
async function tagThree() {
  const root = await mkdtemp(join(tmpdir(), 'memez-'))
  const library = await openLibrary(root)
  for (const seed of [1, 2, 3]) await library.add(new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed]))
  const vectors = await openVectors(join(root, 'vectors.json'))
  let status: AutoTagStatus | undefined
  const tagger = createAutoTagger(
    library,
    vectors,
    root,
    () => true,
    () => DEFAULT_MODELS,
    (next) => (status = next),
    () => undefined
  )
  tagger.start()
  await vi.waitFor(() => expect(tagger.busy() || status?.pending.length).toBeFalsy())
  const tagged = library.list().filter((meme) => meme.autoTagged).length
  return { tagged, status }
}

describe('createAutoTagger when the AI process crashes', () => {
  it('skips the meme, and the next meme starts a new process', async () => {
    const ai = fakeAi(['crash', 'ok', 'ok'])
    const { tagged, status } = await tagThree()
    expect(tagged).toBe(2)
    expect(ai.started()).toBe(2)
    expect(status?.model).toEqual({ state: 'ready' })
  })

  it('stops the queue after two crashes in a row, and shows the error', async () => {
    const ai = fakeAi(['crash', 'crash', 'ok'])
    const { tagged, status } = await tagThree()
    expect(tagged).toBe(0)
    expect(ai.started()).toBe(2) // No new process for the third meme.
    expect(status?.model).toEqual({
      state: 'failed',
      message: 'The AI stopped unexpectedly (exit code 11).'
    })
  })
})
