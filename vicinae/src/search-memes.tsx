import {
  Action,
  ActionPanel,
  Clipboard,
  Grid,
  Icon,
  Toast,
  environment,
  getPreferenceValues,
  showToast
} from '@vicinae/api'
import { watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { readIndex } from '../../src/main/library'
import { byRecentUse, createSearch } from '../../src/renderer/src/lib/search'
import { mediaFileName, mediaKind, type Meme } from '../../src/shared/types'
import { kindSubtitle, memeCount, sectionTitle } from './item'
import { addFromClipboard, markUsed } from './memez'
import { pageAfter } from './page'
import { videoPoster } from './poster'

interface ExtensionPreferences {
  libraryFolder: string
}

const root = (getPreferenceValues<ExtensionPreferences>().libraryFolder || '~/Memez').replace(
  /^~(?=$|\/)/,
  homedir()
)

// Video posters live in the extension's support folder. The extension never writes to the library.
const posterDir = join(environment.supportPath, 'posters')

export default function SearchMemes() {
  const [query, setQuery] = useState('')
  const [memes, setMemes] = useState<Meme[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [reloadKey, setReloadKey] = useState(0)
  const [libraryVersion, setLibraryVersion] = useState(0)

  const ranked = useMemo(
    () => (query.trim() ? createSearch(memes)(query) : byRecentUse(memes)),
    [memes, query]
  )

  // The app saves library.json after each change (a new meme, a recent use): show it.
  useEffect(() => {
    let cancelled = false
    readIndex(join(root, 'library.json'))
      .then((loaded) => {
        if (cancelled) return
        setMemes(loaded)
        setError(undefined)
        setLibraryVersion((version) => version + 1)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setMemes([])
        setError(reason instanceof Error ? reason.message : String(reason))
        setLibraryVersion((version) => version + 1)
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    try {
      const watcher = watch(root, (_, file) => {
        if (file !== 'library.json') return
        setIsLoading(true)
        setReloadKey((key) => key + 1)
      })
      return () => watcher.close()
    } catch (reason) {
      // No library folder yet: the empty view says so.
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
      return undefined
    }
  }, [])

  return (
    <Results
      // A new query or library version starts again at the first page.
      key={`${query}:${libraryVersion}`}
      ranked={ranked}
      query={query}
      isLoading={isLoading}
      error={error}
      onSearchTextChange={setQuery}
    />
  )
}

function Results({
  ranked,
  query,
  isLoading,
  error,
  onSearchTextChange
}: {
  ranked: Meme[]
  query: string
  isLoading: boolean
  error?: string
  onSearchTextChange: (text: string) => void
}) {
  const [page, setPage] = useState(() => pageAfter(ranked))

  const loadMore = useCallback(() => {
    setPage((current) => {
      const next = pageAfter(ranked, current.data.at(-1)?.id)
      return { data: [...current.data, ...next.data], hasMore: next.hasMore }
    })
  }, [ranked])

  const empty = error
    ? { title: 'Cannot read the library', description: error }
    : query.trim()
      ? { title: 'No memes found' }
      : {
          title: 'No memes yet',
          description: `Copy a meme, then press Cmd/Ctrl+Shift+V. Library: ${root}`
        }

  return (
    <Grid
      columns={4}
      fit={Grid.Fit.Contain}
      isLoading={isLoading}
      filtering={false}
      pagination={{ hasMore: page.hasMore, onLoadMore: loadMore }}
      onSearchTextChange={onSearchTextChange}
      searchBarPlaceholder="Search memes"
    >
      <Grid.EmptyView
        icon={error ? Icon.Warning : Icon.Image}
        {...empty}
        actions={
          <ActionPanel>
            <AddAction />
          </ActionPanel>
        }
      />
      <Grid.Section title={sectionTitle(query)} subtitle={memeCount(ranked.length)}>
        {page.data.map((meme) => (
          <MemeItem key={meme.id} meme={meme} />
        ))}
      </Grid.Section>
    </Grid>
  )
}

/** Cmd+Shift+V: plain Cmd/Ctrl+V types into the search bar. */
function AddAction() {
  return (
    <Action
      title="Add Meme from Clipboard"
      icon={Icon.Plus}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
      onAction={() =>
        addFromClipboard().catch((reason: unknown) =>
          showToast({
            style: Toast.Style.Failure,
            title: 'Cannot open Memez. Is the app installed?',
            message: reason instanceof Error ? reason.message : String(reason)
          })
        )
      }
    />
  )
}

function MemeItem({ meme }: { meme: Meme }) {
  const path = join(root, 'media', mediaFileName(meme))
  const isVideo = mediaKind(meme.ext) === 'video'
  const [poster, setPoster] = useState<string>()

  useEffect(() => {
    if (!isVideo) return
    let cancelled = false
    videoPoster(path, posterDir)
      .then((frame) => {
        if (!cancelled) setPoster(frame)
      })
      .catch(() => {
        // The file icon is enough when ffmpeg or Quick Look cannot read the video.
      })
    return () => {
      cancelled = true
    }
  }, [isVideo, path])

  const image = isVideo ? poster : path

  // Best effort: the paste already worked, so only say so when recent order cannot update.
  const used = () => {
    void markUsed(meme.id).catch((reason: unknown) =>
      showToast({
        style: Toast.Style.Failure,
        title: 'Could not update recent memes',
        message: reason instanceof Error ? reason.message : String(reason)
      })
    )
  }

  const paste = async () => {
    try {
      await Clipboard.paste({ file: path })
      used()
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Could not paste meme',
        message: reason instanceof Error ? reason.message : String(reason)
      })
    }
  }

  const copy = async () => {
    try {
      await Clipboard.copy({ file: path })
      used()
    } catch (reason) {
      await showToast({
        style: Toast.Style.Failure,
        title: 'Could not copy meme',
        message: reason instanceof Error ? reason.message : String(reason)
      })
    }
  }

  return (
    <Grid.Item
      content={image ? { source: image } : { fileIcon: path }}
      title={meme.title || 'Untitled'}
      subtitle={kindSubtitle(meme)}
      keywords={[meme.title, ...meme.tags, meme.ocrText ?? ''].filter(Boolean)}
      actions={
        <ActionPanel>
          <Action title="Paste Meme" icon={Icon.CopyClipboard} onAction={paste} />
          <Action
            title="Copy Meme"
            icon={Icon.CopyClipboard}
            shortcut={{ modifiers: ['cmd'], key: 'c' }}
            onAction={copy}
          />
          {/* Vicinae has no Quick Look: open the meme in its default app instead. */}
          <Action.Open
            title="Open Meme"
            target={path}
            icon={Icon.Eye}
            shortcut={{ modifiers: ['cmd'], key: 'y' }}
          />
          <AddAction />
          <Action.ShowInFinder
            path={path}
            title="Show in File Browser"
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'f' }}
          />
          <Action.CopyToClipboard
            title="Copy Path"
            icon={Icon.Link}
            content={path}
            shortcut={{ modifiers: ['cmd', 'shift'], key: 'c' }}
          />
        </ActionPanel>
      }
    />
  )
}
