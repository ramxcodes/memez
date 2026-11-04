import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { videoPoster } from './poster'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'memez-poster-'))
})

describe('videoPoster', () => {
  it('reuses a saved frame', async () => {
    const poster = join(dir, 'abc.mp4.png')
    await writeFile(poster, '')
    await expect(videoPoster('/nowhere/abc.mp4', dir)).resolves.toBe(poster)
  })

  it('throws when no frame was made', async () => {
    const video = join(dir, 'broken.mp4')
    await writeFile(video, 'not a video')
    await expect(videoPoster(video, join(dir, 'posters'))).rejects.toThrow()
  })
})
