import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutoTagStatus, Meme, Settings } from '../../../shared/types'
import { createSearch } from './search'
import { applyDataMode, dataMode } from './worstCase'

/**
 * The full meme list. Reloads each time the main process reports a change.
 * `onError` must be stable (for example `fail` from `useNotice`).
 */
export function useLibrary(onError: (error: unknown) => void): Meme[] {
  const [memes, setMemes] = useState<Meme[]>([])

  useEffect(() => {
    // Dev builds can swap in worst-case data (`?data=worst`) to test the UI. See worstCase.ts.
    const mode = import.meta.env.DEV ? dataMode() : 'real'
    const load = (): void => {
      window.api.list().then((memes) => setMemes(applyDataMode(memes, mode)), onError)
    }
    load()
    return window.api.onLibraryChanged(load)
  }, [onError])

  return memes
}

/**
 * Search results for `query`. Text matches (title, tags, OCR) come at once; memes that match
 * by meaning (local AI) are added after them a moment later, so nothing the user sees moves.
 * An empty query gives every meme. `searching` is true until the meaning search answers.
 */
export function useSearch(memes: Meme[], query: string): { results: Meme[]; searching: boolean } {
  const search = useMemo(() => createSearch(memes), [memes])
  const [semantic, setSemantic] = useState<{ query: string; ids: string[] }>({
    query: '',
    ids: []
  })
  const trimmed = query.trim()

  useEffect(() => {
    if (!trimmed) return
    let stale = false
    // Wait for a short pause in typing, so we do not run the model on every key.
    const timer = setTimeout(() => {
      window.api.semanticSearch(trimmed).then(
        (ids) => !stale && setSemantic({ query: trimmed, ids }),
        (error) => console.warn('Semantic search failed', error)
      )
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [trimmed])

  return useMemo(() => {
    const text = search(query)
    if (!trimmed) return { results: text, searching: false }
    if (semantic.query !== trimmed) return { results: text, searching: true }
    const shown = new Set(text.map((meme) => meme.id))
    const byId = new Map(memes.map((meme) => [meme.id, meme]))
    const extra = semantic.ids.filter((id) => !shown.has(id)).flatMap((id) => byId.get(id) ?? [])
    return { results: [...text, ...extra], searching: false }
  }, [search, query, trimmed, semantic, memes])
}

/** Device settings. `null` until loaded. Follows changes made in any window. */
export function useSettings(): Settings | null {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    const load = (): void => {
      window.api.getSettings().then(setSettings, console.warn)
    }
    load()
    return window.api.onSettingsChanged(load)
  }, [])

  return settings
}

/** AI model state and the memes still waiting for a title and tags. */
export function useAutoTagStatus(): AutoTagStatus {
  const [status, setStatus] = useState<AutoTagStatus>({ model: { state: 'idle' }, pending: [] })

  useEffect(() => {
    const unsubscribe = window.api.onAutoTagStatus(setStatus)
    window.api.getAutoTagStatus().then(setStatus, console.warn)
    return unsubscribe
  }, [])

  return status
}

export interface Notice {
  text: string
  tone: 'info' | 'error'
}

// IPC errors arrive as "Error invoking remote method 'x': Error: <message>". Keep the message.
const errorText = (error: unknown): string =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  )

/** A short message at the bottom of the window. Errors stay longer than info. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const show = useCallback((text: string, tone: Notice['tone'] = 'info') => {
    clearTimeout(timer.current)
    setNotice({ text, tone })
    timer.current = setTimeout(() => setNotice(null), tone === 'error' ? 6000 : 2500)
  }, [])

  const fail = useCallback((error: unknown) => show(errorText(error), 'error'), [show])

  return { notice, show, fail }
}
