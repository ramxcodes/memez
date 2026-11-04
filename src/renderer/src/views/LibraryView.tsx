import { ClipboardPaste, Plus, Search, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import type { ImportResult, Meme } from '../../../shared/types'
import { Inspector } from '../components/Inspector'
import { MemeMedia } from '../components/MemeMedia'
import { NoticeBar } from '../components/NoticeBar'
import { Sidebar } from '../components/Sidebar'
import { KindBadge, Keycaps } from '../components/ui'
import { filterLabel, matchesFilter, type Filter } from '../lib/filter'
import { useLibrary, useNotice, useSearch } from '../lib/hooks'

const isTextField = (element: Element | null): boolean =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement

function EmptyState({ onPaste }: { onPaste: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <div className="mb-2 flex size-16 items-center justify-center rounded-[18px] bg-gradient-to-b from-accent/90 to-accent text-white shadow-lg">
        <ClipboardPaste size={28} />
      </div>
      <h2 className="text-[17px] font-semibold">Start your meme library</h2>
      <p className="max-w-72 text-secondary">
        Copy any image, GIF or video, then press <Keycaps keys={['⌘', 'V']} /> here. You can also
        drop files into this window.
      </p>
      <button
        onClick={onPaste}
        className="mt-2 h-8 rounded-md bg-accent px-4 font-medium text-white shadow-sm hover:brightness-110"
      >
        Paste from Clipboard
      </button>
    </div>
  )
}

function Tile(props: {
  meme: Meme
  selected: boolean
  onSelect: () => void
  onError: (error: unknown) => void
}) {
  const { meme } = props
  return (
    <button
      draggable
      onDragStart={(event) => {
        event.preventDefault()
        window.api.startDrag(meme.id).catch(props.onError)
      }}
      onClick={props.onSelect}
      onContextMenu={() => window.api.showContextMenu(meme.id).catch(props.onError)}
      className="group mb-5 block w-full break-inside-avoid text-left outline-none"
    >
      <div
        className={`relative overflow-hidden rounded-[10px] bg-tile shadow-[0_1px_2px_rgba(0,0,0,0.08)] ring-1 ring-separator transition duration-150 group-hover:shadow-[0_6px_20px_rgba(0,0,0,0.14)] ${
          props.selected ? 'ring-[3px] ring-accent' : ''
        }`}
      >
        <MemeMedia meme={meme} className="block w-full" />
        <KindBadge meme={meme} />
      </div>
      <p
        title={meme.title || undefined}
        className={`mt-2 line-clamp-2 px-0.5 text-[12px] leading-snug font-medium break-words ${
          meme.title ? '' : 'text-tertiary'
        }`}
      >
        {meme.title || 'Untitled'}
      </p>
    </button>
  )
}

/** The main window: sidebar, toolbar with search, meme grid and the info panel. */
export function LibraryView() {
  const { notice, show, fail } = useNotice()
  const memes = useLibrary(fail)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const searchInput = useRef<HTMLInputElement>(null)
  const { results: searched, searching } = useSearch(memes, query)
  const results = useMemo(
    () => searched.filter((meme) => matchesFilter(meme, filter)),
    [searched, filter]
  )
  const selected = memes.find((meme) => meme.id === selectedId)

  // One new meme opens the info panel so the user can title and tag it at once.
  const afterImport = (results: ImportResult[]): void => {
    if (results.length === 1) {
      setSelectedId(results[0].meme.id)
      show(results[0].duplicate ? 'Already in your library' : 'Added to your library')
    } else {
      const added = results.filter((result) => !result.duplicate).length
      show(`Added ${added} memes, ${results.length - added} already in your library`)
    }
  }

  const pasteFromClipboard = (): void => {
    window.api.importClipboard().then(afterImport, fail)
  }

  // ⌘V outside a text field adds what is on the clipboard. ⌘F goes to search.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextField(document.activeElement)) return
      event.preventDefault()
      pasteFromClipboard()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault()
        searchInput.current?.focus()
      }
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('keydown', onKeyDown)
    }
  })

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDropping(false)
    const paths = [...event.dataTransfer.files].map(window.api.pathForFile).filter(Boolean)
    // Images dragged from a browser have no file on disk, only a link.
    const link =
      event.dataTransfer.getData('text/uri-list').split(/\r?\n/)[0] ||
      event.dataTransfer.getData('text/plain')
    if (paths.length > 0) window.api.importFiles(paths).then(afterImport, fail)
    else if (link) window.api.importUrl(link).then((result) => afterImport([result]), fail)
    else show('Nothing to add from this drop', 'error')
  }

  const exportZip = async (): Promise<void> => {
    const path = await window.api.exportZip()
    if (path) show(`Exported to ${path}`)
  }

  const importZip = async (): Promise<void> => {
    const result = await window.api.importZip()
    if (!result) return
    const skipped = result.skipped > 0 ? `, ${result.skipped} skipped` : ''
    show(
      `Imported ${result.added} new, ${result.merged} merged${skipped}`,
      result.skipped ? 'error' : 'info'
    )
  }

  return (
    <div
      className="flex h-full"
      onDragOver={(event) => {
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={(event) => event.currentTarget === event.target && setDropping(false)}
      onDrop={onDrop}
    >
      <Sidebar
        memes={memes}
        filter={filter}
        onFilter={setFilter}
        onImport={() => importZip().catch(fail)}
        onExport={() => exportZip().catch(fail)}
        onError={fail}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-window">
        <header className="drag-region flex h-[52px] shrink-0 items-center gap-3 border-b border-separator px-5">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] leading-tight font-semibold">
              {filterLabel(filter)}
            </h1>
            <p className="text-[11px] leading-tight text-secondary">
              {results.length} {results.length === 1 ? 'meme' : 'memes'}
            </p>
          </div>
          <label className="flex h-7 w-64 items-center gap-1.5 rounded-md bg-control px-2 focus-within:ring-2 focus-within:ring-accent/60">
            <Search size={14} className="shrink-0 text-secondary" />
            <input
              ref={searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Escape' && setQuery('')}
              placeholder="Search titles, tags, text"
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            {!query && <Keycaps keys={['⌘', 'F']} />}
          </label>
          <button
            onClick={pasteFromClipboard}
            title="Paste from clipboard (⌘V)"
            className="flex size-7 items-center justify-center rounded-md text-secondary hover:bg-control hover:text-label"
          >
            <Plus size={18} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="flex-1 overflow-y-auto px-5 pt-5">
            {memes.length === 0 ? (
              <EmptyState onPaste={pasteFromClipboard} />
            ) : results.length === 0 && searching ? (
              <p className="pt-24 text-center text-secondary">Searching…</p>
            ) : results.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-secondary">
                <SearchX size={32} strokeWidth={1.5} className="text-tertiary" />
                <p className="text-[15px] font-semibold text-label">No Results</p>
                <p>Try another word or a tag.</p>
              </div>
            ) : (
              <div className="columns-[210px] gap-5">
                {results.map((meme) => (
                  <Tile
                    key={meme.id}
                    meme={meme}
                    selected={meme.id === selectedId}
                    onSelect={() => setSelectedId(meme.id)}
                    onError={fail}
                  />
                ))}
              </div>
            )}
          </main>

          {selected && (
            <Inspector
              key={selected.id}
              meme={selected}
              onClose={() => setSelectedId(null)}
              onInfo={show}
              onError={fail}
            />
          )}
        </div>
      </div>

      {dropping && (
        <div className="pointer-events-none fixed inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-accent/10 text-[15px] font-semibold text-accent backdrop-blur-sm">
          <Plus size={28} />
          Drop to add to Memez
        </div>
      )}
      <NoticeBar notice={notice} />
    </div>
  )
}
