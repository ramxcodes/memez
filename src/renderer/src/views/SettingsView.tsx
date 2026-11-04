import { CircleAlert, CircleCheck, FolderOpen, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import type { AutoTagStatus, ModelInfo, Settings } from '../../../shared/types'
import { ProgressBar } from '../components/AutoTagNote'
import { HotkeyButton } from '../components/HotkeyButton'
import { NoticeBar } from '../components/NoticeBar'
import { useAutoTagStatus, useLibrary, useNotice, useSettings } from '../lib/hooks'

const megabytes = new Intl.NumberFormat(undefined, {
  style: 'unit',
  unit: 'megabyte',
  maximumFractionDigits: 0
})
const formatSize = (bytes: number): string => megabytes.format(bytes / 1e6)

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="px-1 text-[11px] font-semibold text-secondary">{title}</h2>
      <div className="divide-y divide-separator rounded-[10px] bg-elevated ring-1 ring-separator">
        {children}
      </div>
    </section>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex min-h-11 items-center gap-3 px-3 py-2">{children}</div>
}

function Switch(props: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors ${
        props.checked ? 'bg-accent' : 'bg-control-strong'
      }`}
    >
      <span
        className={`absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow transition-transform ${
          props.checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  )
}

const buttonClass =
  'flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-control px-2.5 hover:bg-control-strong disabled:opacity-50'

/** One line about the models: off, not downloaded, downloading, ready, or failed. */
function ModelLine(props: { settings: Settings; info: ModelInfo | null; status: AutoTagStatus }) {
  const { settings, info } = props
  const { model, pending } = props.status
  if (model.state === 'loading') {
    return (
      <div className="flex flex-1 flex-col gap-1.5">
        <p className="flex justify-between text-secondary">
          <span>{info?.bytes ? 'Loading models' : 'Downloading models'}</span>
          <span className="tabular-nums">{Math.round(model.progress * 100)}%</span>
        </p>
        <ProgressBar value={model.progress} />
      </div>
    )
  }
  if (model.state === 'failed') {
    return (
      <>
        <CircleAlert size={15} className="shrink-0 text-danger" />
        <p className="min-w-0 flex-1 truncate text-secondary" title={model.message}>
          {model.message}
        </p>
        <button onClick={() => window.api.retryAutoTag()} className={buttonClass}>
          Retry
        </button>
      </>
    )
  }
  const text = !info
    ? ''
    : info.bytes === 0
      ? settings.localAi
        ? 'Not downloaded yet'
        : 'Not downloaded. Turn on to download (about 570 MB).'
      : `${formatSize(info.bytes)} on this Mac` +
        (pending.length > 0 ? ` · tagging ${pending.length}` : '')
  return (
    <>
      {info && info.bytes > 0 && <CircleCheck size={15} className="shrink-0 text-accent" />}
      <p className="min-w-0 flex-1 text-secondary">{text}</p>
    </>
  )
}

/** The Settings window (⌘,): local AI models, popup behavior and the library folder. */
export function SettingsView() {
  const { notice, show, fail } = useNotice()
  const settings = useSettings()
  const memes = useLibrary(fail)
  const status = useAutoTagStatus()
  const [info, setInfo] = useState<ModelInfo | null>(null)
  const [canPaste, setCanPaste] = useState(true)
  // null until known, and while installing or removing.
  const [raycast, setRaycast] = useState<boolean | null>(null)

  useEffect(() => {
    window.api.isRaycastInstalled().then(setRaycast, fail)
  }, [fail])

  // Model size changes after a download or a delete, so reload it when the state changes.
  useEffect(() => {
    window.api.getModelInfo().then(setInfo, fail)
  }, [status.model.state, settings?.localAi, fail])

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
  const update = (patch: Partial<Settings>): void => {
    window.api.updateSettings(patch).catch(fail)
  }

  const deleteModels = async (): Promise<void> => {
    const size = info ? ` (${formatSize(info.bytes)})` : ''
    if (!confirm(`Delete the AI models${size}? Local AI turns off. You can download them again.`))
      return
    try {
      await window.api.deleteModels()
      setInfo(await window.api.getModelInfo())
    } catch (error) {
      fail(error)
    }
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

  const busy = status.model.state === 'loading' || status.pending.length > 0

  return (
    <div className="flex h-full flex-col bg-window">
      <header className="drag-region flex h-[52px] shrink-0 items-center justify-center">
        <h1 className="text-[13px] font-semibold">Settings</h1>
      </header>

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 pb-5">
        <Section title="Local AI">
          <Row>
            <Sparkles size={16} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Titles, tags and search by meaning</p>
              <p className="text-[12px] text-secondary">Runs on this Mac. Nothing is uploaded.</p>
            </div>
            <Switch
              label="Local AI"
              checked={settings.localAi}
              onChange={(localAi) => update({ localAi })}
            />
          </Row>
          <Row>
            <ModelLine settings={settings} info={info} status={status} />
          </Row>
          {info !== null && info.bytes > 0 && (
            <Row>
              <button
                onClick={() => window.api.showFolder('models').catch(fail)}
                className={buttonClass}
              >
                <FolderOpen size={14} /> {window.api.isMac ? 'Show in Finder' : 'Show Folder'}
              </button>
              <span className="flex-1" />
              <button
                onClick={() => void deleteModels()}
                disabled={busy}
                title={busy ? 'Wait until the AI is done.' : undefined}
                className={`${buttonClass} text-danger`}
              >
                <Trash2 size={14} /> Delete Models…
              </button>
            </Row>
          )}
        </Section>

        <Section title="Quick Search">
          <div className="px-1 py-1">
            <HotkeyButton onError={fail} />
          </div>
          <Row>
            <p className="flex-1">Picking a meme</p>
            <div className="flex rounded-md bg-control p-0.5 text-[12px]">
              {(['paste', 'copy'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => update({ pasteMode: mode })}
                  className={`h-6 rounded-[5px] px-3 ${
                    settings.pasteMode === mode
                      ? 'bg-elevated font-medium shadow-sm'
                      : 'text-secondary'
                  }`}
                >
                  {mode === 'paste' ? 'Pastes it' : 'Copies it'}
                </button>
              ))}
            </div>
          </Row>
          {settings.pasteMode === 'paste' && !canPaste && (
            <Row>
              <CircleAlert size={15} className="shrink-0 text-danger" />
              <p className="min-w-0 flex-1 text-[12px] text-secondary">
                To paste for you, Memez needs Accessibility access. Until then it only copies. If
                Memez is already on in that list, remove it with − and add it again.
              </p>
              <button
                onClick={() => window.api.openPasteAccess().catch(fail)}
                className={buttonClass}
              >
                Allow…
              </button>
            </Row>
          )}
        </Section>

        {window.api.isMac && (
          <Section title="Raycast">
            <Row>
              <div className="min-w-0 flex-1">
                <p>Search and add memes from Raycast</p>
                <p className="text-[12px] text-secondary">
                  {raycast
                    ? 'Installed. Type "Search Memes" in Raycast.'
                    : 'Adds "Search Memes" and "Add Meme from Clipboard".'}
                </p>
              </div>
              <button
                onClick={() => raycast !== null && void toggleRaycast(raycast)}
                disabled={raycast === null}
                className={buttonClass}
              >
                {raycast ? 'Remove' : 'Install'}
              </button>
            </Row>
          </Section>
        )}

        <Section title="Library">
          <Row>
            <div className="min-w-0 flex-1">
              <p>
                {memes.length} {memes.length === 1 ? 'meme' : 'memes'}
              </p>
              <p className="text-[12px] text-secondary">Your memes stay in this folder.</p>
            </div>
            <button
              onClick={() => window.api.showFolder('library').catch(fail)}
              className={buttonClass}
            >
              <FolderOpen size={14} /> {window.api.isMac ? 'Show in Finder' : 'Show Folder'}
            </button>
          </Row>
        </Section>
      </div>
      <NoticeBar notice={notice} />
    </div>
  )
}
