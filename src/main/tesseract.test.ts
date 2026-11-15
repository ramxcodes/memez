import { describe, expect, it } from 'vitest'
import { betterRead, bitmapToPgm, parseTesseractTsv } from './tesseract'

const HEADER =
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
const word = (block: number, line: number, conf: number, text: string): string =>
  `5\t1\t${block}\t1\t${line}\t1\t0\t0\t10\t10\t${conf}\t${text}`

describe('parseTesseractTsv', () => {
  it('joins confident words into lines', () => {
    const tsv = [
      HEADER,
      '1\t1\t0\t0\t0\t0\t0\t0\t600\t400\t-1\t',
      word(1, 1, 91.2, 'MONDAY'),
      word(1, 1, 88, 'AGAIN'),
      word(2, 1, 90, 'WHY'),
      word(2, 1, 87, 'ME'),
      ''
    ].join('\n')
    expect(parseTesseractTsv(tsv).text).toBe('MONDAY AGAIN\nWHY ME')
  })

  it('drops low-confidence words, blanks and symbol noise', () => {
    // Real output for an Impact-style caption over a busy background.
    const tsv = [
      HEADER,
      word(1, 1, 95, '     '),
      word(3, 1, 40.97, 'ﬁﬂ'),
      word(3, 1, 87.07, 'IS'),
      word(3, 1, 87.07, 'IT'),
      word(3, 1, 0.19, 'ALWAYS,'),
      word(3, 2, 92, '—|'),
      word(3, 2, -1, '')
    ].join('\n')
    expect(parseTesseractTsv(tsv).text).toBe('IS IT')
  })

  it('reads nothing from empty or broken output', () => {
    expect(parseTesseractTsv('')).toEqual({ text: '', score: 0 })
    expect(parseTesseractTsv('Error opening data file\n')).toEqual({ text: '', score: 0 })
  })

  it('scores longer, more confident reads higher', () => {
    const weak = parseTesseractTsv([HEADER, word(1, 1, 50, 'IS')].join('\n'))
    const strong = parseTesseractTsv(
      [HEADER, word(1, 1, 95, 'MONDAY'), word(1, 1, 95, 'AGAIN')].join('\n')
    )
    expect(strong.score).toBeGreaterThan(weak.score)
    expect(betterRead([weak, strong])).toBe(strong)
    expect(betterRead([strong, weak])).toBe(strong)
    expect(betterRead([])).toEqual({ text: '', score: 0 })
  })
})

describe('bitmapToPgm', () => {
  // BGRA: white, black, mid gray, pure red.
  const bitmap = new Uint8Array([
    255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 255, 0, 0, 255, 255
  ])
  const header = new TextEncoder().encode('P5\n2 2\n255\n')

  it('writes grayscale with a P5 header', () => {
    const pgm = bitmapToPgm(bitmap, 2, 2, false)
    expect(pgm.slice(0, header.length)).toEqual(header)
    expect([...pgm.slice(header.length)]).toEqual([255, 0, 128, 76])
  })

  it('turns near-white pixels black and everything else white for the caption mask', () => {
    expect([...bitmapToPgm(bitmap, 2, 2, true).slice(header.length)]).toEqual([0, 255, 255, 255])
  })
})
