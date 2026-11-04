import { Copy, FolderOpen, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { mediaKind, type Meme, type MemePatch } from '../../../shared/types'
import { useAutoTagStatus } from '../lib/hooks'
import { MemeMedia } from './MemeMedia'
import { TagInput } from './TagInput'

interface Props {
  meme: Meme
  onClose: () => void
  onInfo: (text: string) => void
  onError: (error: unknown) => void
}

const KIND_NAMES = { image: 'Image', gif: 'Animated GIF', video: 'Video' }
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-[11px] font-semibold text-secondary">{label}</h3>
      {children}
    </section>
  )
}

/**
 * Right-side info panel for one meme, like the Finder and Photos inspectors.
 * Changes save on their own: the title on blur or Enter, tags at once.
 * The AI can fill the title while the panel is open, so the field shows `meme.title` unless
 * the user is editing it.
 */
export function Inspector({ meme, onClose, onInfo, onError }: Props) {
  // `start` is the title when editing began. Blur saves only if the user changed it.
  const [draft, setDraft] = useState<{ start: string; text: string } | null>(null)
  const tagging = useAutoTagStatus().pending.includes(meme.id)
  const kind = mediaKind(meme.ext)

  const save = (patch: MemePatch): void => {
    window.api.update(meme.id, patch).catch(onError)
  }

  const saveTitle = (): void => {
    if (draft && draft.text.trim() !== draft.start.trim()) save({ title: draft.text })
    setDraft(null)
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete “${meme.title || 'this meme'}”? The file is removed from the library.`))
      return
    try {
      await window.api.remove(meme.id)
      onClose()
    } catch (error) {
      onError(error)
    }
  }

  return (
    <aside
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
      className="flex w-[300px] shrink-0 flex-col border-l border-separator bg-window"
    >
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between px-4">
        <h2 className="text-[13px] font-semibold">Info</h2>
        <button
          onClick={onClose}
          aria-label="Close info"
          className="rounded-md p-1 text-secondary hover:bg-control hover:text-label"
        >
          <X size={15} />
        </button>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        <div className="overflow-hidden rounded-xl bg-tile ring-1 ring-separator">
          <MemeMedia meme={meme} className="mx-auto max-h-64 w-full object-contain" />
        </div>

        <Section label="Title">
          <textarea
            rows={1}
            autoFocus={!meme.title && !tagging}
            value={draft?.text ?? meme.title}
            onFocus={() => setDraft({ start: meme.title, text: meme.title })}
            onChange={(event) =>
              setDraft({ start: draft?.start ?? meme.title, text: event.target.value })
            }
            onBlur={saveTitle}
            onKeyDown={(event) => {
              // A title is one line: Enter saves instead of adding a line break.
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.currentTarget.blur()
            }}
            placeholder={tagging ? 'Writing a title…' : 'Untitled'}
            className="field-sizing-content max-h-24 min-h-8 resize-none rounded-md bg-control px-2.5 py-1.5 text-[13px] leading-5 font-medium outline-none focus:ring-2 focus:ring-accent/60"
          />
        </Section>

        <Section label="Tags">
          <TagInput tags={meme.tags} onChange={(tags) => save({ tags })} />
          {tagging && <p className="text-[11px] text-tertiary">Suggesting tags…</p>}
        </Section>

        {kind !== 'video' && (
          <Section label="Text in Image">
            <p className="text-[12px] leading-relaxed text-secondary select-text">
              {meme.ocrText === undefined ? 'Reading text…' : meme.ocrText || 'No text found.'}
            </p>
          </Section>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          <dt className="text-secondary">Kind</dt>
          <dd className="text-right">
            {KIND_NAMES[kind]} · {meme.ext.toUpperCase()}
          </dd>
          <dt className="text-secondary">Added</dt>
          <dd className="text-right">{dateFormat.format(new Date(meme.addedAt))}</dd>
        </dl>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t border-separator p-4">
        <button
          onClick={() =>
            window.api.copy(meme.id).then(() => onInfo('Copied to clipboard'), onError)
          }
          className="flex h-8 items-center justify-center gap-2 rounded-md bg-accent font-medium text-white shadow-sm hover:brightness-110 active:brightness-95"
        >
          <Copy size={14} /> Copy
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => window.api.reveal(meme.id).catch(onError)}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-control hover:bg-control-strong"
          >
            <FolderOpen size={14} /> {window.api.isMac ? 'Show in Finder' : 'Show File'}
          </button>
          <button
            onClick={remove}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-control text-danger hover:bg-control-strong"
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </footer>
    </aside>
  )
}
