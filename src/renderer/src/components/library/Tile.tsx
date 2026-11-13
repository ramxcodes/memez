import { useState } from 'react'
import type { Meme } from '../../../../shared/types'
import { MemeMedia } from '../MemeMedia'
import { KindBadge } from '../ui'

/**
 * One meme in the masonry grid: media only, no title. Click selects, drag copies the file out,
 * right-click opens the meme menu. Videos show their length once it is known.
 */
export function Tile(props: {
  meme: Meme
  selected: boolean
  onSelect: () => void
  onError: (error: unknown) => void
}) {
  const { meme } = props
  const [seconds, setSeconds] = useState<number>()
  return (
    <button
      draggable
      onDragStart={(event) => {
        event.preventDefault()
        window.api.startDrag(meme.id).catch(props.onError)
      }}
      onClick={props.onSelect}
      onContextMenu={() => window.api.showContextMenu(meme.id).catch(props.onError)}
      aria-label={meme.title || 'Untitled meme'}
      aria-pressed={props.selected}
      className="group mb-4 block w-full break-inside-avoid outline-none"
    >
      <div
        className={`media-outline relative overflow-hidden rounded-[10px] bg-surface-2 transition-[filter] group-hover:brightness-[0.96] group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent/60 ${
          props.selected ? 'outline-3 outline-offset-2 outline-accent' : ''
        }`}
      >
        <MemeMedia meme={meme} className="block w-full" onDuration={setSeconds} />
        <KindBadge meme={meme} seconds={seconds} />
      </div>
    </button>
  )
}
