import { ImageUp, Search as SearchIcon, X } from 'lucide-react'
import type { DragEvent, Ref } from 'react'
import { modKey } from '../../lib/accelerator'
import { searchLabel, type Search } from '../../lib/filter'
import { Keycaps } from '../ui'

/**
 * The header search field. It holds typed text, or a removable chip for "Find similar" and
 * image searches; typing replaces the chip. Dropping an image file on it searches by image.
 * `dropOver` is true while a drag is over it.
 */
export function SearchPill(props: {
  search: Search
  onSearch: (search: Search) => void
  /** The text field, so ⌘F can focus it. */
  ref: Ref<HTMLInputElement>
  dropOver: boolean
  onDragOver: (event: DragEvent) => void
  onDrop: (event: DragEvent) => void
}) {
  const { search, onSearch, ref, dropOver, onDragOver, onDrop } = props
  const text = search.by === 'text' ? search.text : ''
  const clear = (): void => onSearch({ by: 'text', text: '' })

  return (
    <label
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`relative flex h-[30px] w-[250px] shrink-0 items-center gap-2 rounded-full bg-surface-2 pr-[5px] pl-[11px] text-ash focus-within:ring-2 focus-within:ring-accent/60 ${
        dropOver ? 'ring-2 ring-accent' : ''
      }`}
    >
      <SearchIcon size={15} className="shrink-0" />
      {search.by !== 'text' && (
        <span className="inline-flex h-5 max-w-[150px] shrink-0 items-center gap-1 rounded-full bg-control pr-0.5 pl-2 text-[12px] font-medium text-body shadow-elev">
          <span className="truncate" title={searchLabel(search)}>
            {searchLabel(search)}
          </span>
          <button
            type="button"
            aria-label="Clear search"
            onClick={clear}
            className="shrink-0 rounded-full p-0.5 text-ash hover:bg-surface-2 hover:text-body"
          >
            <X size={11} strokeWidth={2.2} />
          </button>
        </span>
      )}
      <input
        ref={ref}
        value={text}
        onChange={(event) => onSearch({ by: 'text', text: event.target.value })}
        onKeyDown={(event) => event.key === 'Escape' && clear()}
        placeholder={search.by === 'text' ? 'Search or drop an image' : ''}
        aria-label="Search memes"
        className="min-w-0 flex-1 bg-transparent text-ink outline-none"
      />
      {search.by === 'text' && !text && <Keycaps keys={[modKey(window.api.isMac), 'F']} />}
      {/* A layer, not a swap: the field must stay under the pointer for the drop to land. */}
      {dropOver && (
        <span className="pointer-events-none absolute inset-0 flex items-center gap-2 rounded-full bg-surface-2 pl-[11px] font-medium text-accent">
          <ImageUp size={15} className="shrink-0" />
          Drop to search by image
        </span>
      )}
    </label>
  )
}
