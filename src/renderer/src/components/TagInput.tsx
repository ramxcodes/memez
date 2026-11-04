import { X } from 'lucide-react'
import { useState } from 'react'

interface Props {
  tags: string[]
  onChange: (tags: string[]) => void
}

/** Tags as chips. Enter or comma adds a tag; Backspace in the empty field removes the last one. */
export function TagInput({ tags, onChange }: Props) {
  const [draft, setDraft] = useState('')

  const commit = (): void => {
    const added = draft
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
    setDraft('')
    if (added.length > 0) onChange([...tags, ...added])
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md bg-control px-1.5 py-1 focus-within:ring-2 focus-within:ring-accent/60">
      {tags.map((tag) => (
        <span
          key={tag}
          title={tag}
          className="inline-flex h-6 max-w-full items-center gap-0.5 rounded-full bg-accent/12 pr-1 pl-2.5 text-[12px] font-medium text-accent"
        >
          <span className="truncate">{tag}</span>
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((other) => other !== tag))}
            className="shrink-0 rounded-full p-0.5 opacity-60 hover:bg-accent/15 hover:opacity-100"
          >
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Backspace' && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        className="h-6 min-w-16 flex-1 bg-transparent px-1 outline-none"
      />
    </div>
  )
}
