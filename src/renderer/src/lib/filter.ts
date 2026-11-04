import { mediaKind, type MediaKind, type Meme } from '../../../shared/types'

type TagFilter = `tag:${string}`

/** What the library shows: everything, one media kind, or one tag. */
export type Filter = 'all' | MediaKind | TagFilter

export const KIND_LABELS: Record<'all' | MediaKind, string> = {
  all: 'All Memes',
  image: 'Images',
  gif: 'GIFs',
  video: 'Videos'
}

const isTagFilter = (filter: Filter): filter is TagFilter => filter.startsWith('tag:')

export function matchesFilter(meme: Meme, filter: Filter): boolean {
  if (isTagFilter(filter)) return meme.tags.includes(filter.slice(4))
  return filter === 'all' || mediaKind(meme.ext) === filter
}

export const filterLabel = (filter: Filter): string =>
  isTagFilter(filter) ? `#${filter.slice(4)}` : KIND_LABELS[filter]
