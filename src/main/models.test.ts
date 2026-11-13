import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it } from 'vitest'
import { modelInfo } from '../shared/models'
import type { Settings } from '../shared/types'
import { createAutoTagger } from './autotag'
import { openLibrary } from './library'
import { isModelReady, modelHandlers } from './models'
import { createSemanticSearch, openVectors } from './semantic'
import { parseSettings } from './settings'

const noop = (): void => undefined

describe('isModelReady', () => {
  const clip = modelInfo('clip-vit-b-32')
  // What the app loads for CLIP at fp16: both ONNX parts, the config, tokenizer and processor.
  const files = [
    'config.json',
    'onnx/vision_model_fp16.onnx',
    'onnx/text_model_fp16.onnx',
    'tokenizer.json',
    'tokenizer_config.json',
    'preprocessor_config.json'
  ]
  const setUp = async (names: string[]): Promise<string> => {
    const modelDir = await mkdtemp(join(tmpdir(), 'memez-models-'))
    for (const name of names) {
      const path = join(modelDir, clip.repo, name)
      await mkdir(dirname(path), { recursive: true })
      const config = { architectures: ['CLIPModel'], model_type: 'clip' }
      await writeFile(path, name === 'config.json' ? JSON.stringify(config) : 'x')
    }
    return modelDir
  }

  it('is ready only when every file for the catalog dtype is there', async () => {
    const modelDir = await setUp(files)
    expect(await isModelReady(modelDir, clip)).toBe(true)
    await rm(join(modelDir, clip.repo, 'onnx/text_model_fp16.onnx'))
    expect(await isModelReady(modelDir, clip)).toBe(false)
  })

  it('is not ready with files of another dtype or a partial download', async () => {
    const other = files.map((name) => name.replace('_fp16', '_quantized'))
    expect(await isModelReady(await setUp(other), clip)).toBe(false)
    const partial = [
      ...files.filter((name) => !name.includes('vision')),
      'onnx/vision_model_fp16.onnx.tmp.1.a'
    ]
    expect(await isModelReady(await setUp(partial), clip)).toBe(false)
    expect(await isModelReady(await setUp([]), clip)).toBe(false)
  })

  describe('modelHandlers', () => {
    const event = {} as IpcMainInvokeEvent
    // Real modules on temp folders. Nothing here loads a model or uses the network.
    const handlersFor = async (modelDir: string, localAi = true) => {
      const libraryRoot = await mkdtemp(join(tmpdir(), 'memez-'))
      const library = await openLibrary(libraryRoot)
      const vectors = await openVectors(join(libraryRoot, 'vectors.json'))
      const settings = { ...parseSettings(undefined), localAi }
      const isEnabled = (): boolean => settings.localAi
      const active = (): Settings['models'] => settings.models
      return modelHandlers({
        library,
        settings,
        libraryRoot,
        modelDir,
        vectors,
        autoTagger: createAutoTagger(library, vectors, modelDir, isEnabled, active, noop, noop),
        semanticSearch: createSemanticSearch(modelDir, vectors, isEnabled, active),
        saveSettings: async () => undefined,
        broadcast: noop,
        onLibraryChanged: noop
      })
    }

    it('refuses a second Get while the first one checks the disk, then clears the job', async () => {
      const handlers = await handlersFor(await setUp(files))
      const first = handlers.downloadModel(event, clip.id)
      await expect(handlers.downloadModel(event, clip.id)).rejects.toThrow('already downloading')
      await first
      const states = await handlers.listModels(event)
      expect(states.find((state) => state.id === clip.id)?.download).toEqual({ state: 'ready' })
    })

    it('says why search by image cannot run', async () => {
      const off = await handlersFor(await setUp([]), false)
      await expect(off.searchByImage(event, 'meme.png')).rejects.toThrow('Turn on smart titles')
      const missing = await handlersFor(await setUp([]))
      await expect(missing.searchByImage(event, 'meme.png')).rejects.toThrow('not downloaded yet')
    })
  })
})
