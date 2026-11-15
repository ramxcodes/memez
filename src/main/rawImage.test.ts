import { describe, expect, it } from 'vitest'
import {
  centerCropPixels,
  cropPixels,
  loadTransformers,
  padPixels,
  resizePixels,
  type Pixels
} from './rawImage'

/** A one-channel image from rows of values. */
const gray = (rows: number[][]): Pixels => ({
  data: new Uint8ClampedArray(rows.flat()),
  width: rows[0].length,
  height: rows.length,
  channels: 1
})

/** The rows of a one-channel image. */
const rowsOf = ({ data, width, height }: Pixels): number[][] =>
  Array.from({ length: height }, (_, y) => [...data.subarray(y * width, (y + 1) * width)])

describe('resizePixels', () => {
  it('returns the same image when the size does not change', () => {
    const image = gray([[1, 2]])
    expect(resizePixels(image, 2, 1, 3)).toBe(image)
  })

  it('averages every input pixel when it shrinks (no aliasing), like Pillow', () => {
    expect(
      rowsOf(
        resizePixels(
          gray([
            [0, 100],
            [200, 40]
          ]),
          1,
          1,
          'bilinear'
        )
      )
    ).toEqual([[85]])
    // Bicubic over a hard edge: dark stays dark, light stays light, nothing goes out of range.
    const [row] = rowsOf(resizePixels(gray([[0, 0, 0, 0, 255, 255, 255, 255]]), 2, 1, 3))
    expect(row[0]).toBeLessThan(40)
    expect(row[1]).toBeGreaterThan(215)
    expect(row[0] + row[1]).toBe(255)
  })

  it('keeps a flat colour flat when it grows or shrinks, for every method', () => {
    const flat = gray(Array.from({ length: 5 }, () => [77, 77, 77, 77, 77, 77, 77]))
    for (const resample of [0, 1, 2, 3, 4, 5]) {
      for (const [width, height] of [
        [3, 2],
        [20, 11]
      ]) {
        const out = resizePixels(flat, width, height, resample)
        expect([out.width, out.height]).toEqual([width, height])
        expect(new Set(out.data)).toEqual(new Set([77]))
      }
    }
  })

  it('keeps the colour channels apart', () => {
    const red = {
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0]),
      width: 2,
      height: 1,
      channels: 3
    }
    expect([...resizePixels(red, 5, 3, 3).data.subarray(0, 6)]).toEqual([255, 0, 0, 255, 0, 0])
  })

  it('takes the nearest pixel with method 0', () => {
    expect(rowsOf(resizePixels(gray([[10, 20, 30, 40]]), 2, 1, 0))).toEqual([[20, 40]])
  })
})

describe('cropPixels, padPixels and centerCropPixels', () => {
  const image = gray([
    [1, 2, 3, 4],
    [5, 6, 7, 8]
  ])

  it('crops a box with both corners included, kept inside the image', () => {
    expect(rowsOf(cropPixels(image, [1, 0, 2, 1]))).toEqual([
      [2, 3],
      [6, 7]
    ])
    expect(rowsOf(cropPixels(image, [2, 1, 9, 9]))).toEqual([[7, 8]])
    expect(cropPixels(image, [0, 0, 3, 1])).toBe(image)
  })

  it('pads with black on each side', () => {
    expect(rowsOf(padPixels(gray([[9]]), [1, 2, 0, 1]))).toEqual([
      [0, 9, 0, 0],
      [0, 0, 0, 0]
    ])
    expect(padPixels(image, [0, 0, 0, 0])).toBe(image)
  })

  it('pads with opaque black when the image has alpha', () => {
    const rgba = { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1, channels: 4 }
    expect([...padPixels(rgba, [1, 0, 0, 0]).data]).toEqual([0, 0, 0, 255, 1, 2, 3, 4])
  })

  it('center crops: cuts the larger side and pads the smaller one, like transformers.js', () => {
    expect(rowsOf(centerCropPixels(image, 2, 2))).toEqual([
      [2, 3],
      [6, 7]
    ])
    expect(rowsOf(centerCropPixels(image, 2, 4))).toEqual([
      [0, 0],
      [2, 3],
      [6, 7],
      [0, 0]
    ])
    // Odd differences: the extra pixel is cut or padded on the right and the bottom.
    expect(rowsOf(centerCropPixels(gray([[1, 2, 3, 4, 5]]), 2, 1))).toEqual([[2, 3]])
    expect(rowsOf(centerCropPixels(gray([[1, 2]]), 5, 1))).toEqual([[0, 1, 2, 0, 0]])
    expect(centerCropPixels(image, 4, 2)).toBe(image)
  })
})

describe('loadTransformers', () => {
  /** A 300 × 200 RGB picture with a gradient. */
  const picture = async () => {
    const ai = await loadTransformers()
    const data = new Uint8ClampedArray(300 * 200 * 3).map((_, i) => i % 251)
    return { ai, image: new ai.RawImage(data, 300, 200, 3) }
  }

  it('runs the CLIP image steps (resize, center crop) without sharp', async () => {
    const { ai, image } = await picture()
    // The CLIP preprocessor_config.json. A variable: the typings lack some of its keys.
    const config = {
      do_resize: true,
      size: { shortest_edge: 224 },
      resample: 3,
      do_center_crop: true,
      crop_size: { height: 224, width: 224 },
      do_rescale: true,
      rescale_factor: 1 / 255,
      do_normalize: true,
      image_mean: [0.5, 0.5, 0.5],
      image_std: [0.5, 0.5, 0.5],
      do_convert_rgb: true
    }
    const { pixel_values } = await new ai.CLIPImageProcessor(config)(image)
    expect(pixel_values.dims).toEqual([1, 3, 224, 224])
  })

  it('runs the Florence-2 image step (stretch to 768 × 768) without sharp', async () => {
    const { ai, image } = await picture()
    const resized = await image.resize(768, 768, { resample: 3 })
    expect([resized.width, resized.height, resized.channels]).toEqual([768, 768, 3])
    expect(resized).toBeInstanceOf(ai.RawImage)
  })

  it('never loads sharp: a sharp step is a clear error, not a native crash', async () => {
    const { ai } = await picture()
    await expect(ai.RawImage.read(new Blob([new Uint8Array([1, 2, 3])]))).rejects.toThrow(
      'Memez does not use sharp'
    )
  })
})
