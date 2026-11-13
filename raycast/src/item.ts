import { mediaKind, type Meme } from '../../src/shared/types'

const KIND_SUBTITLES = { image: undefined, gif: 'Animated', video: 'Video' } as const

/** Grid subtitle: the kind for animated memes and videos, nothing for still images. */
export const kindSubtitle = (meme: Pick<Meme, 'ext'>): string | undefined =>
  KIND_SUBTITLES[mediaKind(meme.ext)]

/** Section header: recent memes come first before the user types. */
export const sectionTitle = (query: string): string => (query.trim() ? 'Results' : 'Recently used')

export const memeCount = (count: number): string => `${count} ${count === 1 ? 'meme' : 'memes'}`
