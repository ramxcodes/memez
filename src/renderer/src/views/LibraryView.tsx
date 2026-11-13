import { Clock, Plus, ScanSearch, SearchX } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { ImportResult, Meme } from '../../../shared/types'
import { Inspector } from '../components/Inspector'
import { SearchPill } from '../components/library/SearchPill'
import { EmptyLibrary, GridMessage } from '../components/library/States'
import { Tile } from '../components/library/Tile'
import { NoticeBar } from '../components/NoticeBar'
import { Sidebar } from '../components/Sidebar'
import { Pill } from '../components/ui'
import { isModHeld, shortcutText } from '../lib/accelerator'
import {
  byIds,
  inScope,
  KIND_FILTERS,
  kindCounts,
  matchesKind,
  scopeTitle,
  searchLabel,
  type KindFilter,
  type Scope,
  type Search
} from '../lib/filter'
import { useAutoTagStatus, useLibrary, useNotice, useSearch } from '../lib/hooks'

const isTextField = (element: Element | null): boolean =>
  element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement

/** Where a drag over the window would drop: add to the library, or search by image. */
type DropTarget = 'none' | 'library' | 'search'

const NO_SEARCH: Search = { by: 'text', text: '' }

/**
 * The main window: sidebar, header with search and kind capsules, the masonry grid and Info.
 * The sidebar scope and the kind capsule apply together, on top of the search.
 */
export function LibraryView() {
  const { notice, show, fail } = useNotice()
  const memes = useLibrary(fail)
  // Here, not in Info, so a new Info panel knows at once that the AI is still writing.
  const autoTag = useAutoTagStatus()
  const [scope, setScope] = useState<Scope>({ by: 'all' })
  const [kind, setKind] = useState<KindFilter>('all')
  const [search, setSearch] = useState<Search>(NO_SEARCH)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drop, setDrop] = useState<DropTarget>('none')
  const searchInput = useRef<HTMLInputElement>(null)

  const scoped = useMemo(() => inScope(memes, scope), [memes, scope])
  const textSearch = useSearch(scoped, search.by === 'text' ? search.text : '')
  const searched = useMemo(
    () =>
      search.by === 'text'
        ? textSearch.results
        : search.by === 'pending'
          ? []
          : byIds(scoped, search.ids),
    [search, textSearch.results, scoped]
  )
  const counts = useMemo(() => kindCounts(searched), [searched])
  const shown = useMemo(() => searched.filter((meme) => matchesKind(meme, kind)), [searched, kind])
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

  /**
   * Runs a similar or image search. Its chip shows at once; the answer replaces it only if the
   * user has not typed or started another search in the meantime.
   */
  const lookUp = (
    request: Promise<string[]>,
    done: (ids: string[]) => Extract<Search, { ids: string[] }>
  ): void => {
    const pending: Search = { by: 'pending', label: searchLabel(done([])) }
    const settle = (next: Search): void =>
      setSearch((current) => (current === pending ? next : current))
    setSearch(pending)
    request.then(
      (ids) => settle(done(ids)),
      (error) => {
        settle(NO_SEARCH)
        fail(error)
      }
    )
  }

  const findSimilar = (meme: Meme): void =>
    lookUp(window.api.findSimilar(meme.id), (ids) => ({ by: 'similar', to: meme, ids }))

  // ⌘V (Ctrl+V) outside a text field adds what is on the clipboard. ⌘F (Ctrl+F) goes to search.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      if (isTextField(document.activeElement)) return
      event.preventDefault()
      pasteFromClipboard()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isModHeld(event, window.api.isMac) && event.key === 'f') {
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

  // A drop anywhere but the search pill adds files, or a link from a browser.
  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDrop('none')
    const paths = [...event.dataTransfer.files].map(window.api.pathForFile).filter(Boolean)
    // Images dragged from a browser have no file on disk, only a link.
    const link =
      event.dataTransfer.getData('text/uri-list').split(/\r?\n/)[0] ||
      event.dataTransfer.getData('text/plain')
    if (paths.length > 0) window.api.importFiles(paths).then(afterImport, fail)
    else if (link) window.api.importUrl(link).then((result) => afterImport([result]), fail)
    else show('Nothing to add from this drop', 'error')
  }

  const onSearchDrop = (event: DragEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    setDrop('none')
    const file = [...event.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    const path = file ? window.api.pathForFile(file) : ''
    if (!file || !path) return show('Drop an image file here to search by image', 'error')
    lookUp(window.api.searchByImage(path), (ids) => ({ by: 'image', name: file.name, ids }))
  }

  const noMatch = <GridMessage title="Nothing here" text="No memes match this filter." />

  const gridContent = (): ReactNode => {
    if (memes.length === 0) return <EmptyLibrary onPaste={pasteFromClipboard} />
    if (search.by === 'pending' || (shown.length === 0 && textSearch.searching))
      return <GridMessage title="Searching…" />
    if (shown.length > 0)
      return (
        <div className="columns-[190px] gap-4">
          {shown.map((meme) => (
            <Tile
              key={meme.id}
              meme={meme}
              selected={meme.id === selectedId}
              onSelect={() => setSelectedId(meme.id)}
              onError={fail}
            />
          ))}
        </div>
      )
    // The search found memes, but the kind capsule hides them all.
    if (searched.length > 0) return noMatch
    if (search.by !== 'text')
      return (
        <GridMessage
          icon={<ScanSearch size={32} strokeWidth={1.5} />}
          title="No similar memes"
          text="Try another meme or image."
        />
      )
    if (search.text.trim())
      return (
        <GridMessage
          icon={<SearchX size={32} strokeWidth={1.5} />}
          title="No results"
          text="Try another word or a tag."
        />
      )
    if (scope.by === 'recent' && kind === 'all')
      return (
        <GridMessage
          icon={<Clock size={32} strokeWidth={1.5} />}
          title="Nothing used yet"
          text="Memes you copy or paste show up here."
        />
      )
    return noMatch
  }

  return (
    <div
      className="flex h-full"
      onDragOver={(event) => {
        event.preventDefault()
        setDrop('library')
      }}
      onDragLeave={(event) => {
        // Only when the drag leaves the window, not when it moves between children.
        const to = event.relatedTarget
        if (!(to instanceof Node && event.currentTarget.contains(to))) setDrop('none')
      }}
      onDrop={onDrop}
    >
      <Sidebar memes={memes} scope={scope} onScope={setScope} autoTag={autoTag} onError={fail} />

      <div className="flex min-w-0 flex-1 flex-col bg-canvas">
        <header className="drag-region flex shrink-0 flex-col gap-3.5 border-b border-hairline px-6 py-3.5">
          <div className="flex h-[30px] items-center gap-2.5">
            <h1 className="min-w-0 flex-1 truncate text-[26px] leading-[1.15] font-bold tracking-[-0.022em]">
              {scopeTitle(scope)}
            </h1>
            <SearchPill
              search={search}
              onSearch={setSearch}
              ref={searchInput}
              dropOver={drop === 'search'}
              onDragOver={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setDrop('search')
              }}
              onDrop={onSearchDrop}
            />
            <Pill
              onClick={pasteFromClipboard}
              title={`Paste from clipboard (${shortcutText('V', window.api.isMac)})`}
            >
              <Plus size={15} />
              Add
            </Pill>
          </div>
          <div role="group" aria-label="Kind" className="flex items-center gap-1.5">
            {KIND_FILTERS.map((filter) => (
              <Pill
                key={filter.kind}
                size="sm"
                variant={kind === filter.kind ? 'on' : 'plain'}
                aria-pressed={kind === filter.kind}
                onClick={() => setKind(filter.kind)}
              >
                {filter.label}
                <span className="opacity-55 tabular-nums">{counts[filter.kind]}</span>
              </Pill>
            ))}
          </div>
        </header>

        <div className="relative flex min-h-0 flex-1">
          <main className="flex-1 overflow-y-auto px-6 pt-5">{gridContent()}</main>

          {selected && (
            <Inspector
              key={selected.id}
              meme={selected}
              tagging={autoTag.pending.includes(selected.id)}
              aiError={autoTag.failed.find((failure) => failure.id === selected.id)?.message}
              onClose={() => setSelectedId(null)}
              onFindSimilar={() => findSimilar(selected)}
              onInfo={show}
              onError={fail}
            />
          )}

          {drop === 'library' && (
            <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-canvas/80 text-[15px] font-semibold text-accent">
              <Plus size={28} />
              Drop to add to Memez
            </div>
          )}
        </div>
      </div>

      <NoticeBar notice={notice} />
    </div>
  )
}
