import { readFile } from 'node:fs/promises'
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { MEDIA_EXTS, mediaFileName, type Meme, type ZipImportResult } from '../shared/types'
import type { Library } from './library'

const INDEX_NAME = 'library.json'

/** Builds a zip with `library.json` and `media/<file>`, the same layout as the library folder. */
export async function exportZip(library: Library): Promise<Uint8Array> {
  const memes = library.list()
  const files: Zippable = {
    [INDEX_NAME]: strToU8(JSON.stringify({ version: 1, memes }, null, 2))
  }
  for (const meme of memes) {
    // Level 0: media files are already compressed, so only store them.
    files[`media/${mediaFileName(meme)}`] = [await readFile(library.pathOf(meme)), { level: 0 }]
  }
  return zipSync(files)
}

/** Checks a `library.json` entry from a zip. The zip may come from anywhere, so trust nothing. */
const isMemeEntry = (value: unknown): value is Meme => {
  if (typeof value !== 'object' || value === null) return false
  const { id, ext, title, tags } = value as Record<string, unknown>
  return (
    typeof id === 'string' &&
    /^[a-f0-9]{16}$/.test(id) &&
    MEDIA_EXTS.some((known) => known === ext) &&
    typeof title === 'string' &&
    Array.isArray(tags) &&
    tags.every((tag) => typeof tag === 'string')
  )
}

/** Who wrote an entry's title. Anything but `'ai'` or `'user'` counts as unknown. */
const titleSourceOf = (entry: Meme): Meme['titleSource'] =>
  entry.titleSource === 'ai' || entry.titleSource === 'user' ? entry.titleSource : undefined

/**
 * Merges a zip made by `exportZip` into the library.
 * Files already in the library (same bytes) keep their data and get the new tags added.
 */
export async function importZip(library: Library, zip: Uint8Array): Promise<ZipImportResult> {
  const files = unzipSync(zip)
  const index = files[INDEX_NAME]
  if (!index) throw new Error('This zip is not a Memez export (library.json is missing).')

  const parsed = JSON.parse(strFromU8(index)) as { memes?: unknown }
  if (!Array.isArray(parsed.memes)) throw new Error('This zip has an invalid library.json.')

  const result: ZipImportResult = { added: 0, merged: 0, skipped: 0 }
  for (const entry of parsed.memes) {
    const bytes = isMemeEntry(entry) ? files[`media/${mediaFileName(entry)}`] : undefined
    if (!isMemeEntry(entry) || !bytes) {
      result.skipped++
      continue
    }

    const { meme, duplicate } = await library.add(
      bytes,
      { title: entry.title, tags: entry.tags },
      titleSourceOf(entry)
    )
    if (duplicate) {
      result.merged++
    } else {
      result.added++
      // Keep OCR text from the other device, so we do not run OCR again.
      if (typeof entry.ocrText === 'string') await library.setOcrText(meme.id, entry.ocrText)
      // Its title and tags already hold the AI suggestion (maybe edited), so do not add it again.
      if (entry.autoTagged === true) await library.applyAutoTags(meme.id, { title: '', tags: [] })
    }
  }
  return result
}
