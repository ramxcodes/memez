import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_MODELS } from '../shared/models'
import type { AutoTagStatus, Meme } from '../shared/types'
import { createAi } from './ai'
import { AiCrashError, startAiProcess } from './aiProcess'
import { createAutoTagger } from './autotag'
import { openLibrary } from './library'
import { openVectors } from './semantic'

vi.mock('./aiProcess', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./aiProcess')>()),
  startAiProcess: vi.fn()
}))

type Read = { frames: unknown[]; options: { suggest: boolean; readText: boolean } }

/**
 * A fake AI process for each start. Each `read` takes the next outcome: `crash` ends the process
 * the way a native crash does (open calls reject, `onCrash` runs). `reads` keeps what was read.
 */
function fakeAi(outcomes: ('ok' | 'crash')[] = []): { started: () => number; reads: Read[] } {
  let started = 0
  const reads: Read[] = []
  vi.mocked(startAiProcess).mockImplementation((_onProgress, onCrash) => {
    started++
    const call = async (method: string, ...args: unknown[]): Promise<unknown> => {
      if (method !== 'read') return undefined
      if (outcomes.shift() === 'crash') {
        const crash = new AiCrashError('The AI stopped unexpectedly (exit code 11).')
        onCrash(crash)
        throw crash
      }
      const [, , frames, options] = args as [string, unknown, Read['frames'], Read['options']]
      reads.push({ frames, options })
      return {
        vector: [1, 0],
        suggestion: options.suggest ? { title: 'Cat', tags: ['cat'] } : null,
        text: options.readText ? 'so true' : null
      }
    }
    return { call, stop: () => undefined } as ReturnType<typeof startAiProcess>
  })
  return { started: () => started, reads }
}

const PNG = [0x89, 0x50, 0x4e, 0x47]
const GIF = [0x47, 0x49, 0x46, 0x38]
const FRAMES = [new Uint8Array([1]), new Uint8Array([2])]

/** Runs the tagger on new memes made from `files` and waits until the queue is empty. */
async function tag(files: number[][], grabFrames = async (): Promise<Uint8Array[]> => FRAMES) {
  const root = await mkdtemp(join(tmpdir(), 'memez-'))
  const library = await openLibrary(root)
  for (const bytes of files) await library.add(new Uint8Array(bytes))
  const vectors = await openVectors(join(root, 'vectors.json'))
  let status: AutoTagStatus | undefined
  const tagger = createAutoTagger(
    library,
    vectors,
    createAi(),
    root,
    () => true,
    () => DEFAULT_MODELS,
    (next) => (status = next),
    () => undefined,
    grabFrames
  )
  tagger.start()
  await vi.waitFor(() => expect(tagger.busy() || status?.pending.length).toBeFalsy())
  // The idle timer of the AI must not keep the test run open.
  tagger.unload()
  const memes: Meme[] = library.list()
  return { memes, vectors, status, tagged: memes.filter((meme) => meme.autoTagged).length }
}

const tagThree = (): ReturnType<typeof tag> => tag([1, 2, 3].map((seed) => [...PNG, seed]))

describe('createAutoTagger when the AI process crashes', () => {
  it('skips the meme, and the next meme starts a new process', async () => {
    const ai = fakeAi(['crash', 'ok', 'ok'])
    const { tagged, status } = await tagThree()
    expect(tagged).toBe(2)
    expect(ai.started()).toBe(2)
    expect(status?.model).toEqual({ state: 'idle' })
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

describe('createAutoTagger on a GIF or video', () => {
  it('reads the frames of the clip, and saves its text with the title and tags', async () => {
    const ai = fakeAi()
    const { memes, vectors } = await tag([[...GIF, 1]])
    expect(ai.reads).toEqual([{ frames: FRAMES, options: { suggest: true, readText: true } }])
    expect(memes[0]).toMatchObject({ title: 'Cat', tags: ['cat'], ocrText: 'so true' })
    expect(vectors.has(memes[0].id)).toBe(true)
  })

  it('shows why a clip could not be decoded, and saves nothing for it', async () => {
    const ai = fakeAi()
    const { memes, vectors, status } = await tag([[...GIF, 1]], async () => {
      throw new Error('This video format cannot be played on this computer.')
    })
    expect(ai.reads).toEqual([])
    expect(status?.failed).toEqual([
      { id: memes[0].id, message: 'This video format cannot be played on this computer.' }
    ])
    expect(memes[0].autoTagged).toBeFalsy()
    expect(vectors.has(memes[0].id)).toBe(false)
  })

  it('reads a still image from its file, with no text (Apple Vision reads that)', async () => {
    const ai = fakeAi()
    const { memes } = await tag([[...PNG, 1]])
    expect(ai.reads[0].options).toEqual({ suggest: true, readText: false })
    expect(ai.reads[0].frames).toHaveLength(1)
    expect(memes[0].ocrText).toBeUndefined()
  })
})
