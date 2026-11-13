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
    expect(textInImage(meme({ ocrText: 'monday again' }), false)).toBe('monday again')
  })

  it('says "Reading text…" only on macOS while OCR has not run', () => {
    expect(textInImage(meme({}), true)).toBe('Reading text…')
    expect(textInImage(meme({}), false)).toBeNull()
  })

  it('hides the section when no text was found, and for videos', () => {
    expect(textInImage(meme({ ocrText: ' ' }), true)).toBeNull()
    expect(textInImage(meme({ ext: 'mp4', ocrText: 'text' }), true)).toBeNull()
  })
})
