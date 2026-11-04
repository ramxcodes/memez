import type { MediaExt } from '../shared/types'

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
  signature.every((byte, i) => bytes[offset + i] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/**
 * Detects the media type from the first bytes of a file.
 * We trust the bytes, not the file name or URL, because links often have no extension.
 * Returns null for anything we do not support.
 */
export function sniffExt(bytes: Uint8Array): MediaExt | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, ascii('GIF8'))) return 'gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp'
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (startsWith(bytes, ascii('ftyp'), 4)) return 'mp4'
  return null
}
