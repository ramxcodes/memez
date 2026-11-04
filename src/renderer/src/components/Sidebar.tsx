import { Download, Film, Hash, ImagePlay, Images, LayoutGrid, Settings, Upload } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { Meme } from '../../../shared/types'
import { KIND_LABELS, matchesFilter, type Filter } from '../lib/filter'
import { useAutoTagStatus } from '../lib/hooks'
import { AutoTagNote } from './AutoTagNote'
import { HotkeyButton } from './HotkeyButton'

interface Props {
  memes: Meme[]
  filter: Filter
  onFilter: (filter: Filter) => void
  onImport: () => void
  onExport: () => void
  onError: (error: unknown) => void
}

const KINDS = [
  { kind: 'all', Icon: LayoutGrid },
  { kind: 'image', Icon: Images },
  { kind: 'gif', Icon: ImagePlay },
  { kind: 'video', Icon: Film }
] as const

function Item(props: {
  icon: ReactNode
  label: string
  count?: number
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={props.onClick}
      className={`flex h-7 w-full items-center gap-2 rounded-md px-2 text-left ${
        props.active ? 'bg-control-strong' : 'hover:bg-control'
      }`}
    >
      <span className={props.active ? 'text-accent' : 'text-secondary'}>{props.icon}</span>
      <span className="flex-1 truncate" title={props.label}>
        {props.label}
      </span>
      {props.count !== undefined && (
        <span className="text-[12px] text-tertiary tabular-nums">{props.count}</span>
      )}
    </button>
  )
}

const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className="mt-5 mb-1 flex items-center justify-between px-2 text-[11px] font-semibold text-tertiary">
    {children}
  </h2>
)

const TAG_PREVIEW = 8

/** Left column: media kinds, tags, AI status, hotkey and import/export. */
export function Sidebar({ memes, filter, onFilter, onImport, onExport, onError }: Props) {
  // Tags sorted by how many memes use them.
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    memes.forEach((meme) => meme.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  }, [memes])
  const [showAllTags, setShowAllTags] = useState(false)
  const autoTag = useAutoTagStatus()
  // Keep the active tag visible even when it is not in the top few.
  const visibleTags = showAllTags
    ? tags
    : tags.filter(([tag], index) => index < TAG_PREVIEW || filter === `tag:${tag}`)

  return (
    <nav className="flex w-[228px] shrink-0 flex-col border-r border-separator bg-sidebar">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex-1 overflow-y-auto px-2.5 pb-3">
        <Heading>Library</Heading>
        {KINDS.map(({ kind, Icon }) => (
          <Item
            key={kind}
            icon={<Icon size={15} />}
            label={KIND_LABELS[kind]}
            count={memes.filter((meme) => matchesFilter(meme, kind)).length}
            active={filter === kind}
            onClick={() => onFilter(kind)}
          />
        ))}

        {tags.length > 0 && (
          <Heading>
            Tags
            {tags.length > TAG_PREVIEW && (
              <button
                onClick={() => setShowAllTags(!showAllTags)}
                className="font-medium hover:text-secondary"
              >
                {showAllTags ? 'Show Less' : 'Show All'}
              </button>
            )}
          </Heading>
        )}
        {visibleTags.map(([tag, count]) => (
          <Item
            key={tag}
            icon={<Hash size={14} />}
            label={tag}
            count={count}
            active={filter === `tag:${tag}`}
            onClick={() => onFilter(`tag:${tag}`)}
          />
        ))}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-separator p-2.5">
        <AutoTagNote status={autoTag} />
        <HotkeyButton onError={onError} />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <button
            onClick={onImport}
            className="flex h-7 items-center justify-center gap-1.5 rounded-md text-secondary hover:bg-control hover:text-label"
          >
            <Download size={14} /> Import
          </button>
          <button
            onClick={onExport}
            className="flex h-7 items-center justify-center gap-1.5 rounded-md text-secondary hover:bg-control hover:text-label"
          >
            <Upload size={14} /> Export
          </button>
          <button
            onClick={() => void window.api.openSettings()}
            title="Settings (⌘,)"
            aria-label="Settings"
            className="flex size-7 items-center justify-center rounded-md text-secondary hover:bg-control hover:text-label"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </nav>
  )
}
