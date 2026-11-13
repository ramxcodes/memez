import { Plus, X } from 'lucide-react'
import { useState } from 'react'
import { Pill } from './ui'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
}

/** The dashed "Add tag" capsule: a button until clicked, then a text field. */
type Adding = { state: 'idle' } | { state: 'typing'; text: string }

/**
 * Tags as capsules with a remove button, then "Add tag". In the field, Enter or a comma adds
 * the tag and keeps the field open for the next one; blur adds and closes; Escape cancels.
 */
export function TagInput({ tags, onChange }: Props) {
  const [adding, setAdding] = useState<Adding>({ state: 'idle' })

  // "a, b" adds two tags. Tags already on the meme are not added twice.
  const commit = (text: string): void => {
    const added = text
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    if (added.length > 0) onChange([...new Set([...tags, ...added])])
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          title={tag}
          className="inline-flex h-[26px] max-w-full items-center gap-1 rounded-full bg-control pr-1.5 pl-2.5 text-[12px] font-medium text-body shadow-elev"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((other) => other !== tag))}
            className="shrink-0 rounded-full p-0.5 text-ash outline-none hover:bg-surface-2 hover:text-body focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <X size={11} strokeWidth={2.2} />
          </button>
        </span>
      ))}
      {adding.state === 'typing' ? (
        <input
          autoFocus
          value={adding.text}
          onChange={(event) => setAdding({ state: 'typing', text: event.target.value })}
          // Reads the field itself: Escape empties it first, in case removing it also blurs.
          onBlur={(event) => {
            commit(event.currentTarget.value)
            setAdding({ state: 'idle' })
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              commit(adding.text)
              setAdding({ state: 'typing', text: '' })
            } else if (event.key === 'Escape') {
              // Cancel the tag only; the Info panel stays open.
              event.stopPropagation()
              event.currentTarget.value = ''
              setAdding({ state: 'idle' })
            }
          }}
          aria-label="New tag"
          placeholder="Tag name"
          className="h-[26px] w-28 rounded-full border border-dashed border-accent bg-control px-2.5 text-[12px] outline-none"
        />
      ) : (
        <Pill variant="dashed" size="sm" onClick={() => setAdding({ state: 'typing', text: '' })}>
          <Plus size={12} />
          Add tag
        </Pill>
      )}
    </div>
  )
}
