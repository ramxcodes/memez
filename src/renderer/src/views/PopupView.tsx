import { CircleCheck, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AutoTagStatus, ImportResult, Meme } from '../../../shared/types'
import { ProgressBar } from '../components/AutoTagNote'
import { MemeMedia } from '../components/MemeMedia'
import { NoticeBar } from '../components/NoticeBar'
import { KindBadge, Keycaps } from '../components/ui'
import { isModHeld, modKey, shortcutText } from '../lib/accelerator'
import { useAutoTagStatus, useLibrary, useNotice, useSearch, useSettings } from '../lib/hooks'
import { byRecentUse } from '../lib/search'

const COLUMNS = 5
const isMac = window.api.isMac
const MOD = modKey(isMac)

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {label}
      <Keycaps keys={keys} />
    </span>
  )
}

/** Memes added from the popup. `null` results mean the import is still running. */
type Added = { results: ImportResult[] | null }

/** One line about memes added with ⌘V: adding, AI work, then done. */
function AddedLine({ added, status }: { added: Added; status: AutoTagStatus }) {
  const working = !added.results || added.results.some((r) => status.pending.includes(r.meme.id))
  const { model } = status
  const text = !added.results
    ? 'Adding…'
    : working && model.state === 'loading'
      ? `Getting AI models ready · ${Math.round(model.progress * 100)}%`
      : working
        ? 'Writing title and tags…'
        : added.results.every((r) => r.duplicate)
          ? 'Already in your library · ↵ to paste'
          : 'Added · ↵ to paste'
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-[18px] pb-2 text-[12px] text-mute">
      <p className="flex items-center gap-1.5">
        {working ? (
          <LoaderCircle size={13} className="animate-spin text-accent" />
        ) : (
          <CircleCheck size={13} className="text-accent" />
        )}
        {text}
      </p>
      {working && model.state === 'loading' && <ProgressBar value={model.progress} />}
    </div>
  )
}

/** One result cell: the media fits inside a rounded cell. Videos show their length. */
function Cell(props: {
  meme: Meme
  index: number
  selected: boolean
  modHeld: boolean
  onHover: () => void
  onPick: () => void
  onError: (error: unknown) => void
}) {
  const { meme, index } = props
  const [seconds, setSeconds] = useState<number>()
  return (
    <button
      id={`result-${index}`}
      draggable
      onDragStart={(event) => {
        event.preventDefault()
        window.api.startDrag(meme.id).catch(props.onError)
      }}
      // Mouse move, not enter: arrow-key scrolling must not change the selection.
      onMouseMove={props.onHover}
      onClick={props.onPick}
      onContextMenu={() => window.api.showContextMenu(meme.id).catch(props.onError)}
      aria-label={meme.title || 'Untitled meme'}
      className={`media-outline relative flex items-center justify-center rounded-[10px] bg-surface-2 p-[5px] ${
        props.selected ? 'outline-[2.5px] outline-offset-1 outline-accent' : ''
      }`}
    >
      <MemeMedia
        meme={meme}
        play={props.selected}
        onDuration={setSeconds}
        className="max-h-full max-w-full rounded-[4px] object-contain"
      />
      <KindBadge meme={meme} seconds={seconds} />
      {props.modHeld && index < 9 && (
        <span className="absolute top-1.5 left-1.5 z-[1] rounded-[5px] bg-scrim px-1 text-[10.5px] font-semibold text-white backdrop-blur-md">
          {shortcutText(String(index + 1), isMac)}
        </span>
      )}
    </button>
  )
}

/**
 * The hotkey window. Type to search, then click or press Enter to paste into the app behind.
 * ⌘1–⌘9 (Ctrl+1–9 off macOS) paste by position, ⌘C copies only, ⌘V adds from the clipboard.
 * Before the user types, recent memes come first.
 */
export function PopupView() {
  const { notice, fail } = useNotice()
  const memes = useLibrary(fail)
  const status = useAutoTagStatus()
  const recent = useMemo(() => byRecentUse(memes), [memes])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [added, setAdded] = useState<Added | null>(null)
  const [modHeld, setModHeld] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const settings = useSettings()
  const { results: searched, searching } = useSearch(memes, query)
  const results = query.trim() ? searched : recent
  const current = results[selected]

  // Start fresh each time the popup opens.
  useEffect(
    () =>
      window.api.onPopupShown(() => {
        setQuery('')
        setSelected(0)
        setAdded(null)
        setModHeld(false)
        input.current?.focus()
      }),
    []
  )

  useEffect(() => {
    document.getElementById(`result-${selected}`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const paste = (id: string): void => {
    window.api.paste(id).catch(fail)
  }

  const copyAndClose = async (id: string): Promise<void> => {
    try {
      await window.api.copy(id)
      await window.api.hidePopup()
    } catch (error) {
      fail(error)
    }
  }

  // A new meme is the most recent one, so it is first. A duplicate keeps its place.
  const addFromClipboard = async (): Promise<void> => {
    setAdded({ results: null })
    setQuery('')
    try {
      const results = await window.api.importClipboard()
      setAdded({ results })
      const first = results[0]
      const index = first.duplicate ? recent.findIndex((m) => m.id === first.meme.id) : 0
      setSelected(Math.max(index, 0))
    } catch (error) {
      setAdded(null)
      fail(error)
    }
  }

  // ⌘V with an image, file or link adds it. Plain text goes into the search field as usual.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData
      if (!data) return
      const hasMedia =
        data.types.includes('Files') || data.types.some((t) => t.startsWith('image/'))
      const isLink = /^https?:\/\/\S+$/i.test(data.getData('text/plain').trim())
      if (!hasMedia && !isLink) return
      event.preventDefault()
      void addFromClipboard()
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  // ⌘C with text selected in the search field copies that text, as usual.
  const hasSelectedText = (): boolean =>
    input.current !== null && input.current.selectionStart !== input.current.selectionEnd

  const onKeyDown = (event: KeyboardEvent): void => {
    const mod = isModHeld(event, isMac)
    setModHeld(mod)
    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
      ArrowDown: COLUMNS,
      ArrowUp: -COLUMNS
    }
    const position = Number(event.key)
    if (event.key in moves) {
      event.preventDefault()
      setSelected((index) => Math.min(Math.max(index + moves[event.key], 0), results.length - 1))
    } else if (mod && position >= 1 && position <= 9) {
      event.preventDefault()
      const meme = results[position - 1]
      if (meme) paste(meme.id)
    } else if (event.key === 'Enter' && current) {
      event.preventDefault()
      if (mod) window.api.reveal(current.id).catch(fail)
      else paste(current.id)
    } else if (mod && event.key === 'c' && current && !hasSelectedText()) {
      event.preventDefault()
      void copyAndClose(current.id)
    } else if (event.key === 'Escape') {
      // First Escape clears the search, the next one closes, like Spotlight.
      if (query) {
        setQuery('')
        setSelected(0)
      } else void window.api.hidePopup()
    }
  }

  return (
    <div
      onKeyDown={onKeyDown}
      onKeyUp={(event) => setModHeld(isModHeld(event, isMac))}
      className="flex h-full flex-col overflow-hidden rounded-[18px] bg-popup text-ink shadow-popup ring-1 ring-hairline-strong ring-inset"
    >
      <div className="flex h-[54px] shrink-0 items-center gap-3 px-[18px]">
        <Search size={19} className="shrink-0 text-mute" />
        <input
          ref={input}
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
            setAdded(null)
          }}
          placeholder="Search memes"
          className="min-w-0 flex-1 bg-transparent text-[19px] tracking-[-0.015em] outline-none"
        />
        <button
          onClick={() => void addFromClipboard()}
          title="Add the meme on the clipboard"
          className="rounded-md text-[12px] text-mute outline-none hover:text-body focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Hint label="Add" keys={[MOD, 'V']} />
        </button>
      </div>
      {added && <AddedLine added={added} status={status} />}

      <div className="grid flex-1 scroll-py-1 auto-rows-[96px] grid-cols-5 content-start gap-2 overflow-y-auto px-3 pt-1 pb-3">
        {results.map((meme, index) => (
          <Cell
            key={meme.id}
            meme={meme}
            index={index}
            selected={index === selected}
            modHeld={modHeld}
            onHover={() => setSelected(index)}
            onPick={() => paste(meme.id)}
            onError={fail}
          />
        ))}
        {results.length === 0 && (
          <p className="col-span-5 pt-14 text-center text-mute">
            {memes.length === 0 ? (
              <>
                No memes yet. Copy one and press <Keycaps keys={[MOD, 'V']} /> here.
              </>
            ) : searching ? (
              'Searching…'
            ) : (
              'No results'
            )}
          </p>
        )}
      </div>

      <footer className="flex h-[42px] shrink-0 items-center gap-3.5 border-t border-hairline px-4 text-[12px] text-mute">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink"
          title={current?.title}
        >
          {current ? current.title || 'Untitled' : ''}
        </span>
        <div className="flex shrink-0 items-center gap-3.5">
          {settings?.pasteMode === 'copy' ? (
            <Hint label="Copy" keys={['↵']} />
          ) : (
            <>
              <Hint label="Paste" keys={['↵']} />
              <Hint label="Copy" keys={[MOD, 'C']} />
            </>
          )}
        </div>
      </footer>
      <NoticeBar notice={notice} />
    </div>
  )
}
