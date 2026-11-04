import { clipboard, net } from 'electron'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { sniffExt } from './media'

/** Downloads the original file behind a link. This keeps GIFs animated. */
export async function downloadMedia(url: string): Promise<Uint8Array> {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http and https links are supported.')
  const response = await net.fetch(url)
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // A page link (not a direct file link) downloads HTML. Reject it here, so callers can fall back.
  if (!sniffExt(bytes)) throw new Error('The link is not an image, GIF or video.')
  return bytes
}

export const readFiles = (paths: string[]): Promise<Uint8Array[]> =>
  Promise.all(paths.map((path) => readFile(path)))

const decodeHtml = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

/** Finds a media link in copied HTML (`<img src>`) or in copied plain text. */
function findLink(html: string, text: string): string | null {
  const src = html.match(/<img[^>]*\ssrc=["']([^"']+)["']/i)?.[1]
  if (src && /^https?:\/\//i.test(src)) return decodeHtml(src)
  const trimmed = text.trim()
  if (/^https?:\/\/\S+$/i.test(trimmed)) return trimmed
  return null
}

/**
 * Reads media from the clipboard, best source first:
 *   1. Files copied in Finder.
 *   2. The original file behind a copied image or link. "Copy image" in a browser gives only
 *      a still PNG, so a GIF loses its animation unless we download the source.
 *   3. The copied image itself.
 */
export async function readClipboardMedia(): Promise<Uint8Array[]> {
  const [item] = await clipboard.read()
  if (!item) throw new Error('The clipboard is empty.')
  const has = (type: string): boolean => item.types.includes(type)

  if (has('text/uri-list')) {
    const uris = (await (await item.getType('text/uri-list')).text()).split(/\r?\n/)
    const paths = uris.filter((uri) => uri.startsWith('file://')).map((uri) => fileURLToPath(uri))
    if (paths.length > 0) return readFiles(paths)
  }

  const html = has('text/html') ? await (await item.getType('text/html')).text() : ''
  const text = has('text/plain') ? await (await item.getType('text/plain')).text() : ''
  const imageType = item.types.find((type) => type.startsWith('image/'))
  const link = findLink(html, text)

  if (link) {
    try {
      return [await downloadMedia(link)]
    } catch (error) {
      // Fall back to the copied image. With no image, the download error is the answer.
      if (!imageType) throw error
      console.warn(`Could not download ${link}, using the copied image instead.`, error)
    }
  }

  if (imageType) {
    const blob = await item.getType(imageType)
    if (blob instanceof Blob) return [new Uint8Array(await blob.arrayBuffer())]
  }

  throw new Error('The clipboard has no image, GIF, video or link.')
}
