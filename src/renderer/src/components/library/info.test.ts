import { describe, expect, it } from 'vitest'
import type { Meme } from '../../../../shared/types'
import { INSTALL_TESSERACT, textInImage } from './info'

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
    expect(textInImage(meme({ ocrText: 'monday again' }), 'unsupported', false)).toBe(
      'monday again'
    )
    expect(textInImage(meme({ ocrText: 'text' }), 'missing', false)).toBe('text')
    expect(textInImage(meme({ ext: 'mp4', ocrText: 'text' }), null, false)).toBe('text')
  })

  it('says "Reading text…" for a still image while OCR has not run, where it can run', () => {
    // macOS (Apple Vision), or Linux with Tesseract.
    expect(textInImage(meme({}), 'available', false)).toBe('Reading text…')
    expect(textInImage(meme({ ext: 'webp' }), 'available', true)).toBe('Reading text…')
  })

  it('tells Linux users without Tesseract how to get text reading', () => {
    expect(textInImage(meme({}), 'missing', false)).toBe(INSTALL_TESSERACT)
    expect(INSTALL_TESSERACT).toContain('pacman -S tesseract')
  })

  it('says nothing for a still image where nothing reads text, or before that is known', () => {
    expect(textInImage(meme({}), 'unsupported', false)).toBeNull()
    expect(textInImage(meme({}), null, false)).toBeNull()
  })

  it('says "Reading text…" for a video or GIF only while the AI reads it, on every OS', () => {
    expect(textInImage(meme({ ext: 'mp4' }), 'unsupported', true)).toBe('Reading text…')
    expect(textInImage(meme({ ext: 'gif' }), 'available', false)).toBeNull()
    expect(textInImage(meme({ ext: 'gif' }), 'missing', false)).toBeNull()
  })

  it('hides the section when no text was found', () => {
    expect(textInImage(meme({ ocrText: ' ' }), 'available', true)).toBeNull()
  })
})
