import { mediaKind, type MediaKind, type Meme } from '../../../shared/types'
import { byRecentUse } from './search'

/** Where the library looks, picked in the sidebar. */
export type Scope = { by: 'all' } | { by: 'recent' } | { by: 'tag'; tag: string }

/** Which media kind the header capsules show. It applies on top of the scope. */
export type KindFilter = 'all' | MediaKind

/**
 * What the search pill holds: typed text, or the result of "Find similar" or a dropped image.
 * `pending` is a similar or image search that waits for its answer; `label` is its chip text.
 */
export type Search =
  | { by: 'text'; text: string }
  | { by: 'similar'; to: Meme; ids: string[] }
  | { by: 'image'; name: string; ids: string[] }
  | { by: 'pending'; label: string }

export const KIND_FILTERS: readonly { kind: KindFilter; label: string }[] = [
  { kind: 'all', label: 'All' },
  { kind: 'image', label: 'Images' },
  { kind: 'gif', label: 'Animated' },
  { kind: 'video', label: 'Videos' }
]

/** The chip text in the search pill for a search that is not typed text. */
export function searchLabel(search: Exclude<Search, { by: 'text' }>): string {
  switch (search.by) {
    case 'similar':
      return `Similar to “${search.to.title || 'Untitled'}”`
    case 'image':
      return `Like ${search.name}`
    case 'pending':
      return search.label
  }
}

/** The memes of a scope. "Recently used" keeps only used memes, last used first. */
export function inScope(memes: Meme[], scope: Scope): Meme[] {
  switch (scope.by) {
    case 'all':
      return memes
    case 'recent':
      return byRecentUse(memes.filter((meme) => meme.usedAt))
    case 'tag':
      return memes.filter((meme) => meme.tags.includes(scope.tag))
  }
}

/** The memes with these ids, in the order of `ids`. Ids not in `memes` drop out. */
export function byIds(memes: Meme[], ids: string[]): Meme[] {
  const byId = new Map(memes.map((meme) => [meme.id, meme]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export const matchesKind = (meme: Meme, kind: KindFilter): boolean =>
  kind === 'all' || mediaKind(meme.ext) === kind

/** How many memes of each kind, for the capsule counts. */
export function kindCounts(memes: Meme[]): Record<KindFilter, number> {
  const counts = { all: memes.length, image: 0, gif: 0, video: 0 }
  for (const meme of memes) counts[mediaKind(meme.ext)]++
  return counts
}

/** The large header title. A tag keeps its stored text; only its first letter is capitalized. */
export function scopeTitle(scope: Scope): string {
  switch (scope.by) {
    case 'all':
      return 'All memes'
    case 'recent':
      return 'Recently used'
    case 'tag':
      return scope.tag.charAt(0).toLocaleUpperCase() + scope.tag.slice(1)
  }
}
