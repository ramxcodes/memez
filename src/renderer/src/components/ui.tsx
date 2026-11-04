import { mediaKind, type Meme } from '../../../shared/types'

/** Small key labels, like ⌘ ⇧ M, drawn as keyboard caps. */
export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-0.5">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] bg-control-strong px-1 font-sans text-[11px] font-medium text-secondary"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

/** "GIF" or "MP4" label on a tile. Nothing for still images. */
export function KindBadge({ meme }: { meme: Meme }) {
  if (mediaKind(meme.ext) === 'image') return null
  return (
    <span className="absolute top-2 left-2 rounded-[5px] bg-black/55 px-1.5 py-[2px] text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur-md">
      {meme.ext}
    </span>
  )
}
