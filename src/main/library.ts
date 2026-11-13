import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mediaFileName, type ImportResult, type Meme, type MemePatch } from '../shared/types'
import { sniffExt } from './media'

interface LibraryFile {
  version: 1
  memes: Meme[]
}

export type Library = Awaited<ReturnType<typeof openLibrary>>

/** Lowercase, trim, drop `#`, remove empty and repeated tags. */
export function normalizeTags(tags: string[]): string[] {
  const clean = tags.map((tag) => tag.trim().replace(/^#+/, '').toLowerCase()).filter(Boolean)
  return [...new Set(clean)]
}

/** Reads the memes in `library.json`. No file gives `[]`; a bad file throws. Raycast uses it too. */
export async function readIndex(indexPath: string): Promise<Meme[]> {
  let raw: string
  try {
    raw = await readFile(indexPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  // Never fall back to an empty library here: the next save would erase the user's data.
  const parsed = JSON.parse(raw) as Partial<LibraryFile>
  if (!Array.isArray(parsed.memes)) throw new Error(`${indexPath} is not a valid library file`)
  return parsed.memes
}

/** Writes to a temp file, then renames it, so a crash never leaves a half-written file. */
export async function writeAtomic(path: string, content: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp`
  await writeFile(tmp, content)
  await rename(tmp, path)
}

/**
 * Opens (or creates) a meme library in `root`:
 *   root/library.json   titles, tags, OCR text
 *   root/media/<id>.<ext>
 * All changes go through this object. It keeps the list in memory and saves after each change.
 */
export async function openLibrary(root: string) {
  const mediaDir = join(root, 'media')
  const indexPath = join(root, 'library.json')
  await mkdir(mediaDir, { recursive: true })

  let memes = await readIndex(indexPath)
  let lastWrite: Promise<void> = Promise.resolve()

  // Saves run one after another so an older snapshot never overwrites a newer one.
  const save = (): Promise<void> => {
    const content = JSON.stringify({ version: 1, memes } satisfies LibraryFile, null, 2)
    lastWrite = lastWrite.catch(() => undefined).then(() => writeAtomic(indexPath, content))
    return lastWrite
  }

  const find = (id: string): Meme | undefined => memes.find((meme) => meme.id === id)

  const get = (id: string): Meme => {
    const meme = find(id)
    if (!meme) throw new Error('This meme is no longer in the library.')
    return meme
  }

  /**
   * Adds new tags and fills an empty title. Never removes data the user already typed.
   * `titleSource` says who wrote `patch.title`; it is kept only when that title is used.
   */
  const merge = (meme: Meme, patch: MemePatch, titleSource?: Meme['titleSource']): void => {
    if (!meme.title && patch.title) {
      meme.title = patch.title.trim()
      if (meme.title && titleSource) meme.titleSource = titleSource
    }
    if (patch.tags) meme.tags = normalizeTags([...meme.tags, ...patch.tags])
  }

  /** Changes the tags of every meme that has `tag`, with one save. No meme has it: no save. */
  const editTag = async (tag: string, edit: (tags: string[]) => string[]): Promise<void> => {
    const tagged = memes.filter((meme) => meme.tags.includes(tag))
    if (tagged.length === 0) return
    tagged.forEach((meme) => (meme.tags = normalizeTags(edit(meme.tags))))
    await save()
  }

  return {
    mediaDir,

    list: (): Meme[] => memes.map((meme) => ({ ...meme, tags: [...meme.tags] })),

    get,

    pathOf: (meme: Meme): string => join(mediaDir, mediaFileName(meme)),

    /**
     * Stores the file bytes. If the same bytes are already stored, merges `patch` into that meme.
     * `titleSource` says who wrote `patch.title` (a zip import keeps it).
     */
    async add(
      bytes: Uint8Array,
      patch: MemePatch = {},
      titleSource?: Meme['titleSource']
    ): Promise<ImportResult> {
      const ext = sniffExt(bytes)
      if (!ext) throw new Error('Unsupported file. Use PNG, JPG, WebP, GIF, MP4 or WebM.')
      const id = createHash('sha256').update(bytes).digest('hex').slice(0, 16)

      // Write the file before the index, so the index never points to a missing file.
      if (!find(id)) await writeFile(join(mediaDir, mediaFileName({ id, ext })), bytes)

      // Check again after the await: the same file can arrive twice at the same time.
      const existing = find(id)
      if (existing) {
        merge(existing, patch, titleSource)
        await save()
        return { meme: { ...existing }, duplicate: true }
      }

      const meme: Meme = {
        id,
        ext,
        title: patch.title?.trim() ?? '',
        tags: normalizeTags(patch.tags ?? []),
        addedAt: new Date().toISOString()
      }
      if (meme.title && titleSource) meme.titleSource = titleSource
      memes = [meme, ...memes]
      await save()
      return { meme: { ...meme }, duplicate: false }
    },

    async update(id: string, patch: MemePatch): Promise<Meme> {
      const meme = get(id)
      if (patch.title !== undefined) {
        meme.title = patch.title.trim()
        if (meme.title) meme.titleSource = 'user'
        else delete meme.titleSource
      }
      if (patch.tags !== undefined) meme.tags = normalizeTags(patch.tags)
      await save()
      return { ...meme }
    },

    async setOcrText(id: string, text: string): Promise<void> {
      const meme = find(id)
      if (!meme) return // Deleted while OCR was running.
      meme.ocrText = text
      await save()
    },

    /**
     * Saves the AI suggestion and marks the meme as done, so it never runs again on its own.
     * `fill` uses the same rule as a duplicate import: fills an empty title, only adds tags.
     * `retag` ("Re-tag all") also replaces a title the AI wrote. Never one the user typed.
     */
    async applyAutoTags(
      id: string,
      suggestion: Required<MemePatch>,
      mode: 'fill' | 'retag' = 'fill'
    ): Promise<void> {
      const meme = find(id)
      if (!meme) return // Deleted while the model was running.
      if (mode === 'retag' && meme.titleSource === 'ai') meme.title = ''
      const untitled = !meme.title
      merge(meme, suggestion)
      if (untitled && meme.title) meme.titleSource = 'ai'
      meme.autoTagged = true
      await save()
    },

    /**
     * Renames a tag on every meme, with one save. Renaming into an existing tag merges them.
     * An unknown tag does nothing. An empty new name throws.
     */
    async renameTag(from: string, to: string): Promise<void> {
      const [name] = normalizeTags([to])
      if (!name) throw new Error('A tag needs a name.')
      const [old = ''] = normalizeTags([from])
      await editTag(old, (tags) => tags.map((tag) => (tag === old ? name : tag)))
    },

    /** Removes a tag from every meme, with one save. An unknown tag does nothing. */
    async deleteTag(tag: string): Promise<void> {
      const [name = ''] = normalizeTags([tag])
      await editTag(name, (tags) => tags.filter((other) => other !== name))
    },

    async markUsed(id: string): Promise<void> {
      get(id).usedAt = new Date().toISOString()
      await save()
    },

    async remove(id: string): Promise<void> {
      const meme = get(id)
      memes = memes.filter((other) => other.id !== id)
      // Remove from the index first. A leftover file is harmless; a missing one is not.
      await save()
      await rm(join(mediaDir, mediaFileName(meme)), { force: true })
    }
  }
}
