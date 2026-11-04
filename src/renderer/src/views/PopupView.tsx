import { CircleCheck, LoaderCircle, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { AutoTagStatus, ImportResult } from '../../../shared/types'
import { ProgressBar } from '../components/AutoTagNote'
import { MemeMedia } from '../components/MemeMedia'
import { NoticeBar } from '../components/NoticeBar'
import { KindBadge, Keycaps } from '../components/ui'
import { useAutoTagStatus, useLibrary, useNotice, useSearch, useSettings } from '../lib/hooks'
import { byRecentUse } from '../lib/search'

const COLUMNS = 6

function Hint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <Keycaps keys={keys} />
      <span>{label}</span>
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
    <div className="flex shrink-0 flex-col gap-1.5 px-4 pb-2 text-[12px] text-secondary">
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

/**
 * The hotkey window. Type to search, then click or press Enter to paste into the app behind.
 * ⌘1–⌘9 paste by position, ⌘C copies only, ⌘V adds the meme on the clipboard.
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
  const [commandHeld, setCommandHeld] = useState(false)
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
        setCommandHeld(false)
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
    setCommandHeld(event.metaKey)
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
    } else if (event.metaKey && position >= 1 && position <= 9) {
      event.preventDefault()
      const meme = results[position - 1]
      if (meme) paste(meme.id)
    } else if (event.key === 'Enter' && current) {
      event.preventDefault()
      if (event.metaKey) window.api.reveal(current.id).catch(fail)
      else paste(current.id)
    } else if (event.metaKey && event.key === 'c' && current && !hasSelectedText()) {
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
      onKeyUp={(event) => setCommandHeld(event.metaKey)}
      className="popup-glass flex h-full flex-col overflow-hidden rounded-[16px] bg-popup"
    >
      <div className="flex h-12 shrink-0 items-center gap-2.5 px-4">
        <Search size={17} className="shrink-0 text-secondary" />
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
          className="min-w-0 flex-1 bg-transparent text-[17px] tracking-tight outline-none"
        />
        <Hint label="Add" keys={['⌘', 'V']} />
      </div>
      {added && <AddedLine added={added} status={status} />}

      <div className="grid flex-1 scroll-py-1.5 auto-rows-[78px] grid-cols-6 content-start gap-1.5 overflow-y-auto px-2.5 pt-1.5 pb-2.5">
        {results.map((meme, index) => (
          <button
            key={meme.id}
            id={`result-${index}`}
            draggable
            onDragStart={(event) => {
              event.preventDefault()
              window.api.startDrag(meme.id).catch(fail)
            }}
            // Mouse move, not enter: arrow-key scrolling must not change the selection.
            onMouseMove={() => setSelected(index)}
            onClick={() => paste(meme.id)}
            onContextMenu={() => window.api.showContextMenu(meme.id).catch(fail)}
            className={`relative overflow-hidden rounded-[9px] bg-tile outline-none ${
              index === selected ? 'ring-[2.5px] ring-accent' : 'ring-1 ring-separator'
            }`}
          >
            <MemeMedia meme={meme} play={index === selected} className="size-full object-cover" />
            <KindBadge meme={meme} />
            {commandHeld && index < 9 && (
              <span className="absolute right-1 bottom-1 rounded-[4px] bg-black/60 px-1 text-[10px] font-semibold text-white backdrop-blur-md">
                ⌘{index + 1}
              </span>
            )}
          </button>
        ))}
        {results.length === 0 && (
          <p className="col-span-6 pt-14 text-center text-secondary">
            {memes.length === 0
              ? 'No memes yet. Copy one and press ⌘V here.'
              : searching
                ? 'Searching…'
                : 'No Results'}
          </p>
        )}
      </div>

      <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-separator px-4 text-[11px] text-secondary">
        <span className="min-w-0 truncate font-medium text-label" title={current?.title}>
          {current ? current.title || 'Untitled' : ''}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          {settings?.pasteMode === 'copy' ? (
            <Hint label="Copy" keys={['↵']} />
          ) : (
            <>
              <Hint label="Paste" keys={['↵']} />
              <Hint label="Copy" keys={['⌘', 'C']} />
            </>
          )}
        </div>
      </footer>
      <NoticeBar notice={notice} />
    </div>
  )
}
