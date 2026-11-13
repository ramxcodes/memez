import { Download, FolderOpen, RotateCw, Sparkles, Tag, Trash2, Type } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { MODELS, type ModelInfo } from '../../../shared/models'
import type { AutoTagStatus, ModelState, Settings } from '../../../shared/types'
import { formatSize } from '../lib/format'
import { useAutoTagStatus } from '../lib/hooks'
import { Card, IconTile, Pill, Row, Switch } from './ui'

const percent = (progress: number): string => `${Math.round(progress * 100)}%`

/** Every catalog model as it is on this device. Follows downloads, deletes and switches. */
function useModels(status: AutoTagStatus, onError: (error: unknown) => void): ModelState[] {
  const [models, setModels] = useState<ModelState[]>([])
  useEffect(() => window.api.onModelsChanged(setModels), [])
  // The auto tagger downloads the active models itself (first launch, Retry). Reload when it
  // starts, finishes or fails, so their size and state are right.
  useEffect(() => {
    window.api.listModels().then(setModels, onError)
  }, [status.model.state, onError])
  return models
}

/** The colored tile of a model's job: a "T" for titles, a tag for tags and search. */
function ModelTile({ model }: { model: ModelInfo }) {
  return model.role === 'caption' ? (
    <IconTile color="blue">
      <Type size={16} />
    </IconTile>
  ) : (
    <IconTile color="teal">
      <Tag size={16} />
    </IconTile>
  )
}

/** One model: tile, name with its jobs, note, then `children` (state and buttons) on the right. */
function ModelRow(props: { model: ModelInfo; progress?: number; children: ReactNode }) {
  const { model, progress } = props
  return (
    <Row>
      <ModelTile model={model} />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">
          {model.name}
          <span className="ml-1.5 inline-flex h-[18px] items-center rounded-full bg-surface-2 px-[7px] align-[1px] text-[11px] font-medium text-mute">
            {model.uses}
          </span>
        </p>
        <p className="mt-px text-[12px] text-mute">{model.note}</p>
        {progress !== undefined && (
          <div className="mt-[7px] h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: percent(progress) }}
            />
          </div>
        )}
      </div>
      {props.children}
    </Row>
  )
}

/**
 * Shows why a control is disabled. A disabled `Pill` gets no pointer events, so its own `title`
 * never shows; the tooltip sits on this wrapper.
 */
const Why = ({ reason, children }: { reason?: string; children: ReactNode }) => (
  <span title={reason} className="inline-flex">
    {children}
  </span>
)

const Size = ({ bytes }: { bytes: number }) => (
  <span className="min-w-[52px] text-right text-[12px] text-mute tabular-nums">
    {formatSize(bytes)}
  </span>
)

const Failed = ({ message }: { message: string }) => (
  <span className="max-w-[200px] truncate text-[12px] text-danger" title={message}>
    {message}
  </span>
)

/**
 * Settings → "Smart titles and tags" (the switch and the active models) and "More models"
 * (download, cancel, use, delete), plus Show models, Re-tag all and Delete all.
 */
export function ModelsSection(props: {
  settings: Settings
  onError: (error: unknown) => void
  onInfo: (text: string) => void
}) {
  const { settings, onError, onInfo } = props
  const status = useAutoTagStatus()
  const models = useModels(status, onError)
  const totalBytes = models.reduce((sum, model) => sum + model.bytes, 0)
  const busy = status.model.state === 'loading' || status.pending.length > 0
  const busyReason = busy ? 'Wait until the AI is done.' : undefined

  /** Runs an IPC call; shows `done` when it works and the error when it fails. */
  const act = (call: () => Promise<unknown>, done?: string): void => {
    call().then(() => done && onInfo(done), onError)
  }

  const remove = (model: ModelInfo, active: boolean): void => {
    const off = active ? ' Smart titles and tags turn off.' : ''
    if (!confirm(`Delete ${model.name}?${off} You can download it again.`)) return
    act(() => window.api.deleteModel(model.id), `Deleted ${model.name}.`)
  }

  const deleteButton = (model: ModelInfo, active: boolean) => (
    <Why reason={busyReason}>
      <Pill
        variant="danger"
        size="sm"
        icon
        aria-label={`Delete ${model.name}`}
        title={`Delete ${model.name}`}
        disabled={busy}
        onClick={() => remove(model, active)}
      >
        <Trash2 size={13} />
      </Pill>
    </Why>
  )

  /** State on the right of an active model. Its download runs in the auto tagger. */
  const activeState = (state: ModelState) => {
    const { download } = state
    if (download.state === 'ready') {
      return (
        <span className="inline-flex items-center gap-1 text-[12px] text-mute">
          <i className="size-[7px] rounded-full bg-success" />
          Ready
        </span>
      )
    }
    if (download.state === 'failed') return <Failed message={download.message} />
    if (status.model.state === 'loading' && settings.localAi) {
      return (
        <span className="text-[12px] text-mute tabular-nums">
          Downloading {percent(status.model.progress)}
        </span>
      )
    }
    if (status.model.state === 'failed' && settings.localAi) {
      return (
        <>
          <Failed message={status.model.message} />
          <Pill size="sm" onClick={() => act(() => window.api.retryAutoTag())}>
            Retry
          </Pill>
        </>
      )
    }
    return <span className="text-[12px] text-mute">Not downloaded</span>
  }

  /** State and buttons on the right of a model that is not active. */
  const otherState = (model: ModelInfo, state: ModelState) => {
    const { download } = state
    switch (download.state) {
      case 'none':
        return (
          <>
            <Size bytes={model.approxBytes} />
            <Pill
              size="sm"
              onClick={() => act(() => window.api.downloadModel(model.id))}
              title={`Download ${model.name}, then use it`}
            >
              <Download size={13} />
              Get
            </Pill>
          </>
        )
      case 'downloading':
        return (
          <>
            <span className="min-w-[52px] text-right text-[12px] text-mute tabular-nums">
              {percent(download.progress)}
            </span>
            <Pill size="sm" onClick={() => act(() => window.api.cancelDownload(model.id))}>
              Cancel
            </Pill>
          </>
        )
      case 'cancelling':
        return <span className="text-[12px] text-mute">Cancelling…</span>
      case 'ready':
        return (
          <>
            <Size bytes={state.bytes} />
            <Pill
              size="sm"
              onClick={() => act(() => window.api.useModel(model.id), `Using ${model.name} now.`)}
            >
              Use
            </Pill>
            {deleteButton(model, false)}
          </>
        )
      case 'failed':
        return (
          <>
            <Failed message={download.message} />
            <Pill size="sm" onClick={() => act(() => window.api.downloadModel(model.id))}>
              Retry
            </Pill>
          </>
        )
    }
  }

  const retagAll = (): void => {
    if (!confirm('Write new titles and tags for every meme? Titles you wrote stay.')) return
    act(() => window.api.retagAll(), 'Re-tagging every meme. This can take a while.')
  }

  const deleteAll = (): void => {
    const size = formatSize(totalBytes)
    if (!confirm(`Delete all models (${size})? Smart titles and tags turn off.`)) return
    act(() => window.api.deleteModels(), 'Deleted the models.')
  }

  const byId = new Map(models.map((model) => [model.id, model]))
  const rows = MODELS.flatMap((model) => {
    const state = byId.get(model.id)
    return state ? [{ model, state }] : []
  })
  const active = rows.filter(({ state }) => state.active)
  const others = rows.filter(({ state }) => !state.active)

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between px-1">
        <h2 className="text-[13px] font-semibold text-ink">Smart titles and tags</h2>
        {totalBytes > 0 && (
          <p className="text-[12px] text-mute tabular-nums">
            {formatSize(totalBytes)} on this computer
          </p>
        )}
      </div>
      <Card>
        <Row>
          <IconTile color="purple">
            <Sparkles size={16} />
          </IconTile>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-ink">Name, tag and read every meme</p>
            <p className="mt-px text-[12px] text-mute">
              Runs on this computer. Nothing is uploaded.
            </p>
          </div>
          <Switch
            label="Smart titles and tags"
            checked={settings.localAi}
            onChange={(localAi) => act(() => window.api.updateSettings({ localAi }))}
          />
        </Row>
        {active.map(({ model, state }) => (
          <ModelRow key={model.id} model={model}>
            {activeState(state)}
            <Size bytes={state.bytes > 0 ? state.bytes : model.approxBytes} />
            {state.bytes > 0 && deleteButton(model, true)}
          </ModelRow>
        ))}
      </Card>

      {others.length > 0 && (
        <>
          <h2 className="mt-1.5 px-1 text-[13px] font-semibold text-ink">More models</h2>
          <Card>
            {others.map(({ model, state }) => (
              <ModelRow
                key={model.id}
                model={model}
                progress={
                  state.download.state === 'downloading' ? state.download.progress : undefined
                }
              >
                {otherState(model, state)}
              </ModelRow>
            ))}
          </Card>
        </>
      )}

      <div className="flex gap-2 pt-0.5">
        <Why reason={totalBytes === 0 ? 'No models on this computer yet.' : undefined}>
          <Pill
            size="sm"
            disabled={totalBytes === 0}
            onClick={() => act(() => window.api.showFolder('models'))}
          >
            <FolderOpen size={13} />
            Show models
          </Pill>
        </Why>
        <Why reason={settings.localAi ? undefined : 'Turn on smart titles and tags first.'}>
          <Pill size="sm" disabled={!settings.localAi} onClick={retagAll}>
            <RotateCw size={13} />
            Re-tag all memes
          </Pill>
        </Why>
        <span className="flex-1" />
        <Why reason={totalBytes === 0 ? 'No models on this computer.' : busyReason}>
          <Pill variant="danger" size="sm" disabled={totalBytes === 0 || busy} onClick={deleteAll}>
            <Trash2 size={13} />
            Delete all models…
          </Pill>
        </Why>
      </div>
    </section>
  )
}
