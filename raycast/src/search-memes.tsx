import { Action, ActionPanel, environment, getPreferenceValues, Grid, Icon } from '@raycast/api'
import { showFailureToast, usePromise } from '@raycast/utils'
import { watch } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { useEffect, useState } from 'react'
import { readIndex } from '../../src/main/library'
import { byRecentUse, createSearch } from '../../src/renderer/src/lib/search'
import { mediaFileName, mediaKind, type Meme } from '../../src/shared/types'
import { kindSubtitle, memeCount, sectionTitle } from './item'
import { addFromClipboard, markUsed } from './memez'
import { pageAfter } from './page'
import { videoPoster } from './poster'

// The library folder from the extension preferences. `~` means the home folder.
const root = getPreferenceValues<Preferences.SearchMemes>().libraryFolder.replace(
  /^~(?=$|\/)/,
  homedir()
)
// Video first frames live in the extension's own folder: the extension never writes to the library.
const posterDir = join(environment.supportPath, 'posters')

/** Ranks memes like the popup: recent first before typing, then fuzzy search. */
async function rankedMemes(query: string): Promise<Meme[]> {
  const memes = await readIndex(join(root, 'library.json'))
  return query.trim() ? createSearch(memes)(query) : byRecentUse(memes)
}

/**
 * Raycast version of the hotkey popup. It reads the Memez library and never writes to it, so it
 * works when the app is closed. Changes (add, recent use) go to the app as `memez://` links.
 * Search by meaning needs the app. Memes load 50 at a time; the cursor is the last meme's id.
 */
export default function SearchMemes() {
  const [query, setQuery] = useState('')
  // Memes that match, across all pages. Shown next to the section title.
  const [total, setTotal] = useState(0)
  // A bad library.json throws here. Raycast shows a toast, and the grid shows the error.
  const {
    data: memes = [],
    isLoading,
    error,
    pagination,
    revalidate
  } = usePromise(
    (query: string) =>
      async ({ lastItem }: { lastItem?: Meme }) => {
        const ranked = await rankedMemes(query)
        setTotal(ranked.length)
        return pageAfter(ranked, lastItem?.id)
      },
    [query]
  )

  // The app saves library.json after each change (a new meme, a recent use): show it.
  useEffect(() => {
    try {
      const watcher = watch(root, (_, file) => file === 'library.json' && revalidate())
      return () => watcher.close()
    } catch (error) {
      // No library folder yet: the empty view says so.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }, [revalidate])

  const empty = error
    ? { title: 'Cannot read the library', description: error.message }
    : query.trim()
      ? { title: 'No memes found' }
      : { title: 'No memes yet', description: `Copy a meme, then press ⌘⇧V. Library: ${root}` }

  return (
    <Grid
      columns={4}
      fit={Grid.Fit.Contain}
      isLoading={isLoading}
      pagination={pagination}
      filtering={false}
      onSearchTextChange={setQuery}
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
      <Grid.Section title={sectionTitle(query)} subtitle={memeCount(total)}>
        {memes.map((meme) => (
          <MemeItem key={meme.id} meme={meme} />
        ))}
      </Grid.Section>
    </Grid>
  )
}

/** ⌘⇧V: plain ⌘V types into the search bar. */
function AddAction() {
  return (
    <Action
      title="Add Meme from Clipboard"
      icon={Icon.Plus}
      shortcut={{ modifiers: ['cmd', 'shift'], key: 'v' }}
      onAction={() =>
        addFromClipboard().catch((error) =>
          showFailureToast(error, { title: 'Cannot open Memez. Is the app installed?' })
        )
      }
    />
  )
}

function MemeItem({ meme }: { meme: Meme }) {
  const path = join(root, 'media', mediaFileName(meme))
  const isVideo = mediaKind(meme.ext) === 'video'
  // Quick Look cannot read WebM: those tiles keep the file icon and have no Quick Look.
  const isWebm = meme.ext === 'webm'
  // Raycast cannot play videos, so an MP4 tile shows its first frame (the file icon until it loads).
  const { data: poster } = usePromise(videoPoster, [path, posterDir], {
    execute: meme.ext === 'mp4',
    failureToastOptions: { title: 'Could not show a video frame' }
  })
  const image = isVideo ? poster : path
  // Best effort: the paste already worked, so only say so when recent order cannot update.
  const used = () =>
    void markUsed(meme.id).catch((error) =>
      showFailureToast(error, { title: 'Could not update recent memes' })
    )
  return (
    <Grid.Item
      content={image ? { source: image } : { fileIcon: path }}
      title={meme.title || 'Untitled'}
      subtitle={kindSubtitle(meme)}
      quickLook={isWebm ? undefined : { path, name: meme.title }}
      actions={
        <ActionPanel>
          <Action.Paste
            title="Paste Meme"
            icon={Icon.Clipboard}
            content={{ file: path }}
            onPaste={used}
          />
          <Action.CopyToClipboard
            title="Copy Meme"
            icon={Icon.CopyClipboard}
            content={{ file: path }}
            onCopy={used}
          />
          {/* ⌘Y plays an MP4, or shows an image large, in macOS Quick Look. */}
          {!isWebm && (
            <Action.ToggleQuickLook icon={Icon.Eye} shortcut={{ modifiers: ['cmd'], key: 'y' }} />
          )}
          <AddAction />
          <Action.ShowInFinder
            path={path}
            icon={Icon.Finder}
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
