import { Copy, FolderOpen, ScanSearch, Sparkles, Trash2, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { mediaKind, type Meme, type MemePatch } from '../../../shared/types'
import { formatDuration } from '../lib/format'
import { shownTitle, titleToSave, type TitleField } from '../lib/titleField'
import { textInImage } from './library/info'
import { MemeMedia } from './MemeMedia'
import { TagInput } from './TagInput'
import { Pill, PillDivider, PillGroup, PillGroupButton } from './ui'

interface Props {
  meme: Meme
  /** True while the AI writes this meme's title and tags. */
  tagging: boolean
  onClose: () => void
  onFindSimilar: () => void
  onInfo: (text: string) => void
  onError: (error: unknown) => void
}

const KIND_NAMES = { image: 'Still image', gif: 'Animated', video: 'Video' }
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function Section({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-[7px]">
      <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-mute">{label}</h3>
      {children}
    </section>
  )
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="flex justify-between gap-4">
      <span className="text-mute">{label}</span>
      <span className="truncate text-body">{children}</span>
    </p>
  )
}

/**
 * Right-side info panel for one meme, like the Finder and Photos inspectors.
 * Changes save on their own: the title on blur or Enter, tags at once.
 * The AI can fill the title while the panel is open, so the field shows `meme.title` unless
 * the user is editing it.
 */
export function Inspector({ meme, tagging, onClose, onFindSimilar, onInfo, onError }: Props) {
  const [titleField, setTitleField] = useState<TitleField>({ state: 'idle' })
  const [seconds, setSeconds] = useState<number>()
  const kind = mediaKind(meme.ext)
  const ocr = textInImage(meme, window.api.isMac)
  const showFile = window.api.isMac ? 'Show in Finder' : 'Show in folder'

  const save = (patch: MemePatch): void => {
    window.api.update(meme.id, patch).catch(onError)
  }

  const saveTitle = (): void => {
    const title = titleToSave(titleField, meme.title)
    if (title !== null) save({ title })
    setTitleField({ state: 'idle' })
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
      className="flex w-[300px] shrink-0 flex-col border-l border-hairline bg-canvas"
    >
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-between px-4">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">Info</h2>
        <Pill icon size="sm" aria-label="Close info" onClick={onClose}>
          <X size={13} />
        </Pill>
      </header>

      <div className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-4 pb-4">
        <div className="media-outline relative shrink-0 overflow-hidden rounded-xl bg-surface-2">
          <MemeMedia
            meme={meme}
            className="mx-auto block max-h-64 w-full object-contain"
            onDuration={setSeconds}
          />
        </div>

        <Section
          label={
            <>
              Title
              {meme.titleSource === 'ai' && (
                <span
                  title="Written by the local AI"
                  className="inline-flex items-center gap-[3px] text-[11px] font-medium text-accent"
                >
                  <Sparkles size={11} />
                  auto
                </span>
              )}
            </>
          }
        >
          <textarea
            rows={1}
            autoFocus={!meme.title && !tagging}
            value={shownTitle(titleField, meme.title)}
            onChange={(event) => setTitleField({ state: 'editing', text: event.target.value })}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              // A title is one line: Enter saves instead of adding a line break.
              if (event.key !== 'Enter') return
              event.preventDefault()
              event.currentTarget.blur()
            }}
            placeholder={tagging ? 'Writing a title…' : 'Untitled'}
            aria-label="Title"
            className="field-sizing-content max-h-24 min-h-8 resize-none rounded-lg bg-control px-2.5 py-1.5 text-[13px] leading-5 font-medium text-ink shadow-[inset_0_0_0_1px_var(--hairline-strong)] outline-none focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--accent)_30%,transparent),inset_0_0_0_1px_var(--accent)]"
          />
        </Section>

        <Section label="Tags">
          <TagInput tags={meme.tags} onChange={(tags) => save({ tags })} />
          {tagging && <p className="text-[11px] text-ash">Suggesting tags…</p>}
        </Section>

        {ocr !== null && (
          <Section label="Text in image">
            <p className="text-[12px] leading-relaxed break-words whitespace-pre-line text-mute select-text">
              {ocr}
            </p>
          </Section>
        )}

        <div className="flex flex-col gap-1.5 text-[12px]">
          <MetaRow label="Kind">
            {KIND_NAMES[kind]}
            {kind === 'video' && seconds !== undefined && ` · ${formatDuration(seconds)}`}
          </MetaRow>
          <MetaRow label="Added">{dateFormat.format(new Date(meme.addedAt))}</MetaRow>
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2 px-4 pt-3.5 pb-4">
        <Pill
          variant="primary"
          className="flex-1"
          onClick={() =>
            window.api.copy(meme.id).then(() => onInfo('Copied to clipboard'), onError)
          }
        >
          <Copy size={15} />
          Copy
        </Pill>
        <PillGroup>
          <PillGroupButton
            aria-label={showFile}
            onClick={() => window.api.reveal(meme.id).catch(onError)}
          >
            <FolderOpen size={15} />
          </PillGroupButton>
          {/* A disabled button gets no hover, so the reason sits on a wrapper. */}
          <span
            className="inline-flex"
            title={
              kind === 'video' ? 'Find similar works for images and animated memes' : undefined
            }
          >
            <PillGroupButton
              aria-label="Find similar"
              disabled={kind === 'video'}
              onClick={onFindSimilar}
            >
              <ScanSearch size={15} />
            </PillGroupButton>
          </span>
          <PillDivider />
          <PillGroupButton aria-label="Delete" className="text-danger" onClick={remove}>
            <Trash2 size={15} />
          </PillGroupButton>
        </PillGroup>
      </footer>
    </aside>
  )
}
