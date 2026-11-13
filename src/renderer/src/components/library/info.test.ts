import { describe, expect, it } from 'vitest'
import type { Meme } from '../../../../shared/types'
import { textInImage } from './info'

const meme = (fields: Partial<Meme>): Meme => ({
  id: 'a',
  ext: 'png',
  title: '',
  tags: [],
  addedAt: '2026-01-01T00:00:00.000Z',
  ...fields
})

describe('textInImage', () => {
  it('shows the text read from the image', () => {
    expect(textInImage(meme({ ocrText: 'monday again' }), false, false)).toBe('monday again')
    expect(textInImage(meme({ ext: 'mp4', ocrText: 'text' }), false, false)).toBe('text')
  })

  it('says "Reading text…" for a still image only on macOS while OCR has not run', () => {
    expect(textInImage(meme({}), true, false)).toBe('Reading text…')
    expect(textInImage(meme({}), false, false)).toBeNull()
  })

  it('says "Reading text…" for a video or GIF only while the AI reads it, on every OS', () => {
    expect(textInImage(meme({ ext: 'mp4' }), false, true)).toBe('Reading text…')
    expect(textInImage(meme({ ext: 'gif' }), true, false)).toBeNull()
  })

  it('hides the section when no text was found', () => {
    expect(textInImage(meme({ ocrText: ' ' }), true, true)).toBeNull()
  })
})
