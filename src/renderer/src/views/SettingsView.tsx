import {
  Archive,
  CircleAlert,
  Clipboard,
  Download,
  FolderOpen,
  Images,
  Search,
  Upload
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { BackupRow } from '../components/settings/BackupRow'
import { HotkeyRow } from '../components/settings/HotkeyRow'
import { ModelsSection } from '../components/ModelsSection'
import { NoticeBar } from '../components/NoticeBar'
import { Card, IconTile, Pill, Row, Segmented } from '../components/ui'
import { useLibrary, useNotice, useSettings } from '../lib/hooks'

const PASTE_MODES = [
  { value: 'paste', label: 'Paste it' },
  { value: 'copy', label: 'Copy it' }
] as const

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[13px] font-semibold">{title}</h2>
      <Card>{children}</Card>
    </section>
  )
}

/** Title and status line of a Settings row. */
function RowText({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="font-medium">{title}</p>
      {children && <p className="text-[12px] text-mute">{children}</p>}
    </div>
  )
}

/** The Settings window (⌘,): quick search, local AI models, library and backup, Raycast. */
export function SettingsView() {
  const { notice, show, fail } = useNotice()
  const settings = useSettings()
  const memes = useLibrary(fail)
  const [folder, setFolder] = useState('')
  const [canPaste, setCanPaste] = useState(true)
  // null until known, and while installing or removing.
  const [raycast, setRaycast] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.getLibraryFolder().then(setFolder, fail)
  }, [fail])

  useEffect(() => {
    if (window.api.isMac) window.api.isRaycastInstalled().then(setRaycast, fail)
  }, [fail])

  // The user grants paste access in System Settings, then comes back here: check again.
  useEffect(() => {
    const check = (): void => {
      window.api.canPaste().then(setCanPaste, fail)
    }
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [fail])

  if (!settings) return null

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

  const toggleRaycast = async (installed: boolean): Promise<void> => {
    setRaycast(null)
    try {
      await (installed ? window.api.removeRaycast() : window.api.installRaycast())
      show(installed ? 'Removed from Raycast.' : 'Installed. In Raycast, type "Search Memes".')
    } catch (error) {
      fail(error)
    }
    window.api.isRaycastInstalled().then(setRaycast, fail)
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Room for the macOS window buttons; drags the window everywhere. */}
      <div className="drag-region h-11 shrink-0" />

      <div className="flex flex-1 flex-col gap-[22px] overflow-y-auto px-7 pt-1 pb-7">
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.022em]">Settings</h1>

        <Section title="Quick search">
          <HotkeyRow onError={fail} />
          {/* Linux and Windows can only copy (see the paste handler in main/index.ts). */}
          {window.api.isMac && (
            <Row>
              <IconTile color="orange">
                <Clipboard size={16} />
              </IconTile>
              <RowText title="When you pick a meme">Pasting needs accessibility access.</RowText>
              <Segmented
                label="When you pick a meme"
                options={PASTE_MODES}
                value={settings.pasteMode}
                onChange={(pasteMode) => window.api.updateSettings({ pasteMode }).catch(fail)}
              />
            </Row>
          )}
          {window.api.isMac && settings.pasteMode === 'paste' && !canPaste && (
            <Row>
              <span className="flex size-7 shrink-0 items-center justify-center">
                <CircleAlert size={18} className="text-danger" />
              </span>
              <p className="min-w-0 flex-1 text-[12px] text-mute">
                To paste for you, Memez needs Accessibility access. Until then it only copies. If
                Memez is already on in that list, remove it with − and add it again.
              </p>
              <Pill size="sm" onClick={() => window.api.openPasteAccess().catch(fail)}>
                Allow…
              </Pill>
            </Row>
          )}
        </Section>

        <ModelsSection settings={settings} onError={fail} onInfo={show} />

        <Section title="Library and backup">
          <Row>
            <IconTile color="gray">
              <Images size={16} />
            </IconTile>
            <RowText title={`${memes.length} ${memes.length === 1 ? 'meme' : 'memes'}`}>
              {folder}
            </RowText>
            <Pill size="sm" onClick={() => window.api.showFolder('library').catch(fail)}>
              <FolderOpen size={13} /> Show
            </Pill>
          </Row>
          <BackupRow settings={settings} onError={fail} />
          <Row>
            <IconTile color="green">
              <Archive size={16} />
            </IconTile>
            <RowText title="Move to another computer">
              One zip with every meme, title and tag.
            </RowText>
            <Pill size="sm" onClick={() => exportZip().catch(fail)}>
              <Upload size={13} /> Export
            </Pill>
            <Pill size="sm" onClick={() => importZip().catch(fail)}>
              <Download size={13} /> Import
            </Pill>
          </Row>
        </Section>

        {window.api.isMac && (
          <Section title="Raycast">
            <Row>
              <IconTile color="red">
                <Search size={16} />
              </IconTile>
              <RowText title="Search and add memes from Raycast">
                {raycast
                  ? 'Installed. Type "Search Memes" in Raycast.'
                  : 'Adds "Search Memes" and "Add Meme from Clipboard".'}
              </RowText>
              <Pill
                size="sm"
                onClick={() => raycast !== null && void toggleRaycast(raycast)}
                disabled={raycast === null}
                title={raycast === null ? 'Checking Raycast…' : undefined}
              >
                {raycast ? 'Remove' : 'Install'}
              </Pill>
            </Row>
          </Section>
        )}
      </div>
      <NoticeBar notice={notice} />
    </div>
  )
}
