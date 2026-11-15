import { registerHooks } from 'node:module'

// transformers.js on Node does every image step (decode, resize, crop, pad) with sharp, a native
// libvips build. sharp cannot run inside Electron on Linux: the Electron binary links the
// system GLib, so sharp's calls to g_object_unref and friends bind to that copy instead of the
// GLib inside sharp's own libvips. The two type systems do not know each other's objects, and
// the first image freed crashed the process (SIGSEGV, a call through a null pointer in
// g_object_unref; sharp warns "SharpElectronLinux" on load).
// So the app never uses sharp, on any system: Chromium decodes the media (see frames.ts), and
// the few steps the image processors need run here in plain JavaScript, on every system alike.
// `loadTransformers` stubs sharp out and puts these steps in place of the sharp ones.

/** Raw pixels, row by row, `channels` bytes per pixel. The shape of a transformers.js `RawImage`. */
export interface Pixels {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
  channels: number
}

type Resample = 'nearest' | 'bilinear' | 'bicubic' | 'lanczos' | 'box' | 'hamming'

/** The Pillow numbers that preprocessor configs use for `resample`, as transformers.js maps them. */
const RESAMPLE_NAMES: Record<number, Resample> = {
  0: 'nearest',
  1: 'lanczos',
  2: 'bilinear',
  3: 'bicubic',
  4: 'box',
  5: 'hamming'
}

const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))

/** Pillow's filters (libImaging/Resample.c): how far each reaches, and its weight at `x`. */
const FILTERS: Record<
  Exclude<Resample, 'nearest'>,
  { support: number; at: (x: number) => number }
> = {
  box: { support: 0.5, at: (x) => (x > -0.5 && x <= 0.5 ? 1 : 0) },
  bilinear: { support: 1, at: (x) => Math.max(0, 1 - Math.abs(x)) },
  hamming: {
    support: 1,
    at: (x) => (Math.abs(x) < 1 ? sinc(x) * (0.46 + 0.54 * Math.cos(Math.PI * x)) : 0)
  },
  bicubic: {
    support: 2,
    at: (x) => {
      const a = -0.5
      const t = Math.abs(x)
      if (t < 1) return ((a + 2) * t - (a + 3)) * t * t + 1
      if (t < 2) return (((t - 5) * t + 8) * t - 4) * a
      return 0
    }
  },
  lanczos: { support: 3, at: (x) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0) }
}

/**
 * For each output position: the first input position it reads and the weights of the inputs
 * from there. Like Pillow, a shrink widens the filter, so every input pixel counts (no aliasing).
 */
function weights(inSize: number, outSize: number, filter: (typeof FILTERS)[keyof typeof FILTERS]) {
  const scale = inSize / outSize
  const stretch = Math.max(scale, 1)
  const support = filter.support * stretch
  return Array.from({ length: outSize }, (_, out) => {
    const center = (out + 0.5) * scale
    const first = Math.max(Math.trunc(center - support + 0.5), 0)
    const last = Math.min(Math.trunc(center + support + 0.5), inSize)
    const taps = Array.from({ length: last - first }, (_, i) =>
      filter.at((first + i - center + 0.5) / stretch)
    )
    const sum = taps.reduce((a, b) => a + b, 0)
    return { first, taps: sum === 0 ? taps : taps.map((tap) => tap / sum) }
  })
}

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)))

/**
 * `image` scaled to `width` × `height` (whole pixels, at least 1). `resample` is a Pillow number
 * (see RESAMPLE_NAMES) or a name. Same method as Pillow's `Image.resize`, which the models were
 * trained with: two passes, rows then columns.
 */
export function resizePixels(
  image: Pixels,
  width: number,
  height: number,
  resample: number | string = 2
): Pixels {
  const { data, channels } = image
  width = Math.max(1, Math.round(width))
  height = Math.max(1, Math.round(height))
  if (width === image.width && height === image.height) return image
  const name = (typeof resample === 'number' ? RESAMPLE_NAMES[resample] : resample) as Resample
  if (name === 'nearest') {
    const out = new Uint8ClampedArray(width * height * channels)
    for (let y = 0; y < height; y++) {
      const sy = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / height))
      for (let x = 0; x < width; x++) {
        const sx = Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / width))
        const from = (sy * image.width + sx) * channels
        out.set(data.subarray(from, from + channels), (y * width + x) * channels)
      }
    }
    return { data: out, width, height, channels }
  }
  const filter = FILTERS[name]
  if (!filter) throw new Error(`Resampling method ${resample} is not supported.`)

  // Rows: image.width → width, kept as floats for the second pass.
  const columns = weights(image.width, width, filter)
  const wide = new Float32Array(width * image.height * channels)
  for (let y = 0; y < image.height; y++) {
    const row = y * image.width
    for (let x = 0; x < width; x++) {
      const { first, taps } = columns[x]
      for (let c = 0; c < channels; c++) {
        let sum = 0
        for (let i = 0; i < taps.length; i++)
          sum += taps[i] * data[(row + first + i) * channels + c]
        wide[(y * width + x) * channels + c] = sum
      }
    }
  }
  // Columns: image.height → height.
  const rows = weights(image.height, height, filter)
  const out = new Uint8ClampedArray(width * height * channels)
  for (let y = 0; y < height; y++) {
    const { first, taps } = rows[y]
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        let sum = 0
        for (let i = 0; i < taps.length; i++)
          sum += taps[i] * wide[((first + i) * width + x) * channels + c]
        out[(y * width + x) * channels + c] = clampByte(sum)
      }
    }
  }
  return { data: out, width, height, channels }
}

/**
 * A `width` × `height` window of `image` whose top left corner is at (`left`, `top`) in the
 * image. Parts of the window outside the image are black (opaque when there is alpha), as with
 * sharp's `extend`.
 */
function windowOf(image: Pixels, left: number, top: number, width: number, height: number) {
  const { channels } = image
  const out = new Uint8ClampedArray(width * height * channels)
  if (channels === 4) for (let i = 3; i < out.length; i += 4) out[i] = 255
  const x0 = Math.max(0, -left)
  const x1 = Math.min(width, image.width - left)
  for (let y = Math.max(0, -top); y < Math.min(height, image.height - top); y++) {
    if (x1 <= x0) break
    const from = ((y + top) * image.width + x0 + left) * channels
    out.set(image.data.subarray(from, from + (x1 - x0) * channels), (y * width + x0) * channels)
  }
  return { data: out, width, height, channels }
}

/** `RawImage.crop`: the box from (x_min, y_min) to (x_max, y_max), both included, kept inside the image. */
export function cropPixels(image: Pixels, [xMin, yMin, xMax, yMax]: number[]): Pixels {
  xMin = Math.max(xMin, 0)
  yMin = Math.max(yMin, 0)
  xMax = Math.min(xMax, image.width - 1)
  yMax = Math.min(yMax, image.height - 1)
  if (xMin === 0 && yMin === 0 && xMax === image.width - 1 && yMax === image.height - 1)
    return image
  return windowOf(image, xMin, yMin, xMax - xMin + 1, yMax - yMin + 1)
}

/** `RawImage.pad`: black borders of [left, right, top, bottom] pixels. */
export function padPixels(image: Pixels, [left, right, top, bottom]: number[]): Pixels {
  ;[left, right, top, bottom] = [left, right, top, bottom].map((side) => Math.max(side, 0))
  if (left + right + top + bottom === 0) return image
  return windowOf(image, -left, -top, image.width + left + right, image.height + top + bottom)
}

/** `RawImage.center_crop`: the middle `width` × `height`, with black borders when it is larger. */
export function centerCropPixels(image: Pixels, width: number, height: number): Pixels {
  if (image.width === width && image.height === height) return image
  // Same rounding as transformers.js: floor of the offset, on whichever side is cut or padded.
  const offset = (inner: number, outer: number): number => {
    const half = (inner - outer) / 2
    return half >= 0 ? Math.floor(half) : -Math.floor(-half)
  }
  return windowOf(image, offset(image.width, width), offset(image.height, height), width, height)
}

/** The parts of transformers.js' `RawImage` that the replacements use. */
interface RawImageClass {
  new (
    data: Uint8ClampedArray | Uint8Array,
    width: number,
    height: number,
    channels: 1 | 2 | 3 | 4
  ): Pixels
  prototype: object
}

const patched = new WeakSet<object>()

/** Puts the steps above in place of `RawImage`'s sharp ones. Safe to call more than once. */
export function installPixelOps(RawImage: RawImageClass): void {
  if (patched.has(RawImage)) return
  patched.add(RawImage)
  const wrap = (pixels: Pixels): Pixels =>
    new RawImage(pixels.data, pixels.width, pixels.height, pixels.channels as 1 | 2 | 3 | 4)
  const ops = {
    async resize(this: Pixels, width: number, height: number, options?: { resample?: number }) {
      // transformers.js lets one side be null or -1: that side keeps the aspect ratio.
      const unset = (side: number | null): boolean => side === null || side < 0
      if (unset(width) && unset(height)) return this
      if (unset(width)) width = (height / this.height) * this.width
      if (unset(height)) height = (width / this.width) * this.height
      const out = resizePixels(this, width, height, options?.resample ?? 2)
      return out === this ? this : wrap(out)
    },
    async crop(this: Pixels, box: number[]) {
      const out = cropPixels(this, box)
      return out === this ? this : wrap(out)
    },
    async pad(this: Pixels, sides: number[]) {
      const out = padPixels(this, sides)
      return out === this ? this : wrap(out)
    },
    async center_crop(this: Pixels, width: number, height: number) {
      const out = centerCropPixels(this, width, height)
      return out === this ? this : wrap(out)
    }
  }
  Object.assign(RawImage.prototype, ops)
}

/** What `import sharp from 'sharp'` gives instead: any use is a clear error, never a crash. */
const SHARP_STUB = `data:text/javascript,${encodeURIComponent(
  'export default function sharp() {\n' +
    "  throw new Error('Memez does not use sharp. Decode images with Chromium (see frames.ts).')\n" +
    '}\n'
)}`

let sharpStubbed = false

/**
 * Makes `import 'sharp'` load a stub in this process, so sharp's native code never loads.
 * transformers.js imports sharp when it loads, even when no sharp step runs.
 */
export function stubSharp(): void {
  if (sharpStubbed) return
  sharpStubbed = true
  registerHooks({
    resolve: (specifier, context, next) =>
      specifier === 'sharp' && !context.conditions?.includes('require')
        ? { url: SHARP_STUB, format: 'module', shortCircuit: true }
        : next(specifier, context)
  })
}

/** transformers.js with sharp stubbed out and its image steps in plain JavaScript. */
export async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
  stubSharp()
  const ai = await import('@huggingface/transformers')
  installPixelOps(ai.RawImage as unknown as RawImageClass)
  return ai
}
