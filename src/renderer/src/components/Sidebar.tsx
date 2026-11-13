import { ChevronDown, ChevronUp, CircleMinus, Clock, Images, Settings, Tag } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { AutoTagStatus, Meme } from '../../../shared/types'
import { shortcutText } from '../lib/accelerator'
import type { Scope } from '../lib/filter'
import { AutoTagNote } from './AutoTagNote'
import { Pill } from './ui'

interface Props {
  memes: Meme[]
  scope: Scope
  onScope: (scope: Scope) => void
  autoTag: AutoTagStatus
  onError: (error: unknown) => void
}

const ROW = 'flex h-7 w-full items-center gap-[9px] rounded-[7px] px-2.5 text-left outline-none'

/** One source-list row. The active row gets the soft highlight. */
function Item(props: {
  icon: ReactNode
  label: string
  count?: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={props.onClick}
      aria-current={props.active}
      className={`${ROW} focus-visible:ring-2 focus-visible:ring-accent/60 ${
        props.active ? 'bg-surface-3' : 'hover:bg-surface-2/70'
      }`}
    >
      {props.icon}
      <span className="flex-1 truncate" title={props.label}>
        {props.label}
      </span>
      {props.count !== undefined && (
        <span className="text-[12px] text-ash tabular-nums">{props.count}</span>
      )}
    </button>
  )
}

/**
 * A tag row in edit mode: an inline rename field and a remove button.
 * `onRename` rejects when the rename fails; the field then shows the current name again.
 */
function EditTagRow(props: {
  tag: string
  count: number
  onRename: (to: string) => Promise<void>
  onDelete: () => void
}) {
  const [text, setText] = useState(props.tag)

  const commit = (): void => {
    const to = text.trim()
    if (to && to !== props.tag) props.onRename(to).catch(() => setText(props.tag))
    else setText(props.tag)
  }

  return (
    <div className={ROW}>
      <Tag size={14} className="shrink-0 text-ash" />
      <input
        value={text}
        aria-label={`Rename ${props.tag}`}
        onChange={(event) => setText(event.target.value.replace(/,/g, ''))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          else if (event.key === 'Escape') setText(props.tag)
        }}
        className="h-6 min-w-0 flex-1 rounded-[5px] bg-control px-1.5 shadow-[inset_0_0_0_1px_var(--hairline-strong)] outline-none focus:shadow-[inset_0_0_0_1px_var(--accent)]"
      />
      <button
        aria-label={`Remove ${props.tag} from ${props.count} memes`}
        title="Remove tag"
        onClick={props.onDelete}
        className="shrink-0 rounded-full text-danger outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <CircleMinus size={15} />
      </button>
    </div>
  )
}

const Heading = ({ children }: { children: ReactNode }) => (
  <h2 className="flex items-center justify-between px-2.5 pt-3.5 pb-[5px] text-[11px] font-semibold text-ash first:pt-0.5">
    {children}
  </h2>
)

const TAG_PREVIEW = 9

/** Left source list: library scopes, tags (with rename and remove), AI status and Settings. */
export function Sidebar({ memes, scope, onScope, autoTag, onError }: Props) {
  // Tags sorted by how many memes use them.
  const tags = useMemo(() => {
    const counts = new Map<string, number>()
    memes.forEach((meme) => meme.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)))
    return [...counts].sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
  }, [memes])
  const [showAllTags, setShowAllTags] = useState(false)
  const [editing, setEditing] = useState(false)
  const isActiveTag = (tag: string): boolean => scope.by === 'tag' && scope.tag === tag
  // Keep the active tag visible even when it is not in the top few.
  const visibleTags = showAllTags
    ? tags
    : tags.filter(([tag], index) => index < TAG_PREVIEW || isActiveTag(tag))
  const hiddenCount = tags.length - visibleTags.length

  // A rename into an existing tag merges them (the main process does that).
  // It shows the error, then rejects so the row can put the old name back.
  const rename = (from: string, to: string): Promise<void> =>
    window.api.renameTag(from, to).then(
      () => {
        if (isActiveTag(from)) onScope({ by: 'tag', tag: to })
      },
      (error: unknown) => {
        onError(error)
        throw error
      }
    )

  const remove = (tag: string, count: number): void => {
    const memesText = count === 1 ? '1 meme' : `${count} memes`
    if (!confirm(`Remove the tag “${tag}” from ${memesText}? The memes stay in your library.`))
      return
    window.api.deleteTag(tag).then(() => {
      if (isActiveTag(tag)) onScope({ by: 'all' })
    }, onError)
  }

  const libraryIcon = 'shrink-0 text-accent'
  return (
    <nav className="flex w-[220px] shrink-0 flex-col border-r border-hairline bg-sidebar">
      <div className="drag-region h-[52px] shrink-0" />
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 pb-3">
        <Heading>Library</Heading>
        <Item
          icon={<Images size={16} className={libraryIcon} />}
          label="All memes"
          count={memes.length}
          active={scope.by === 'all'}
          onClick={() => onScope({ by: 'all' })}
        />
        <Item
          icon={<Clock size={16} className={libraryIcon} />}
          label="Recently used"
          active={scope.by === 'recent'}
          onClick={() => onScope({ by: 'recent' })}
        />

        {tags.length > 0 && (
          <Heading>
            Tags
            <button
              onClick={() => setEditing(!editing)}
              className="rounded font-medium outline-none hover:text-mute focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          </Heading>
        )}
        {visibleTags.map(([tag, count]) =>
          editing ? (
            <EditTagRow
              key={tag}
              tag={tag}
              count={count}
              onRename={(to) => rename(tag, to)}
              onDelete={() => remove(tag, count)}
            />
          ) : (
            <Item
              key={tag}
              icon={
                <Tag
                  size={14}
                  className={isActiveTag(tag) ? 'shrink-0 text-accent' : 'shrink-0 text-ash'}
                />
              }
              label={tag}
              count={count}
              active={isActiveTag(tag)}
              onClick={() => onScope({ by: 'tag', tag })}
            />
          )
        )}
        {(hiddenCount > 0 || showAllTags) && tags.length > TAG_PREVIEW && (
          <button
            onClick={() => setShowAllTags(!showAllTags)}
            className={`${ROW} text-mute hover:bg-surface-2/70 focus-visible:ring-2 focus-visible:ring-accent/60`}
          >
            {showAllTags ? (
              <ChevronUp size={14} className="shrink-0" />
            ) : (
              <ChevronDown size={14} className="shrink-0" />
            )}
            {showAllTags ? 'Show less' : `${hiddenCount} more`}
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <AutoTagNote status={autoTag} onError={onError} />
        </div>
        <Pill
          icon
          size="sm"
          aria-label="Settings"
          title={`Settings (${shortcutText(',', window.api.isMac)})`}
          onClick={() => window.api.openSettings().catch(onError)}
        >
          <Settings size={14} />
        </Pill>
      </div>
    </nav>
  )
}
