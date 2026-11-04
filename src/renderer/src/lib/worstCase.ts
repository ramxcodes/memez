import type { Meme } from '../../../shared/types'

/**
 * Dev-only test data for the UI. Open a window with `?data=worst`, `?data=one` or `?data=empty`
 * to see it with realistic worst-case values instead of the real library. Never ships: the
 * caller checks `import.meta.env.DEV`. Media files stay real, only the text changes.
 */
export type DataMode = 'real' | 'worst' | 'one' | 'empty'

export const dataMode = (): DataMode => {
  const mode = new URLSearchParams(window.location.search).get('data')
  return mode === 'worst' || mode === 'one' || mode === 'empty' ? mode : 'real'
}

// Each row breaks something different, as real data does.
const WORST: Partial<Meme>[] = [
  // Long AI caption (Florence-2 really writes these).
  { title: "A series of images of a person's head with blue and red lights", tags: [] },
  // Long title the user typed, many tags, one very long tag.
  {
    title:
      'When the PM says the deadline moved to tomorrow but the API is still down and QA is on leave',
    tags: [
      'work', 'deadline', 'panic', 'office', 'monday', 'boss', 'stress', 'meeting', 'qa',
      'when-the-deployment-fails-on-friday-evening', 'sad', 'tired'
    ] // prettier-ignore
  },
  { title: 'k', tags: ['k'] },
  { title: '', tags: [] },
  { title: 'जब बॉस कहे कि बस पाँच मिनट की मीटिंग है', tags: ['हिंदी', 'मीटिंग'] },
  { title: '猫がジャンプして失敗する瞬間', tags: ['猫'] },
  { title: '😭😭😭', tags: ['😭', 'crying'] },
  {
    title: 'Tiếng Việt: Ổn định',
    tags: ['vietnamese'],
    ocrText:
      'ME: I will sleep early tonight\nALSO ME AT 3 AM: watching a 2 hour video about how ' +
      'bridges are built in a country I will never visit, reading every comment, and then ' +
      'opening another tab because the algorithm knows exactly what I want'
  }
]

/** Replaces the real list for the dev data modes. */
export function applyDataMode(memes: Meme[], mode: DataMode): Meme[] {
  if (mode === 'empty') return []
  if (mode === 'one') return memes.slice(0, 1)
  if (mode === 'worst') return memes.map((meme, i) => ({ ...meme, ...WORST[i % WORST.length] }))
  return memes
}
