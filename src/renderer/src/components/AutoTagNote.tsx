import { CircleAlert, Sparkles } from 'lucide-react'
import type { AutoTagStatus } from '../../../shared/types'

/** Thin progress bar. `value` goes from 0 to 1. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  )
}

/**
 * One line about the local AI, for the sidebar footer: model download progress, memes still to
 * tag, or a failure with Retry. Shows nothing when there is no work.
 */
export function AutoTagNote({
  status,
  onError
}: {
  status: AutoTagStatus
  onError: (error: unknown) => void
}) {
  const { model, pending } = status

  if (model.state === 'failed') {
    return (
      <p className="flex min-w-0 items-center gap-[7px] text-[12px] text-mute">
        <CircleAlert size={14} className="shrink-0 text-danger" />
        <span className="truncate" title={model.message}>
          AI tagging failed
        </span>
        <button
          onClick={() => window.api.retryAutoTag().catch(onError)}
          className="shrink-0 font-medium text-accent hover:brightness-110"
        >
          Retry
        </button>
      </p>
    )
  }

  if (model.state === 'loading') {
    const percent = Math.round(model.progress * 100)
    return (
      <div className="flex min-w-0 flex-col gap-1.5 text-[12px] text-mute">
        <p className="flex items-center gap-[7px]">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="flex-1 truncate">Getting AI ready</span>
          <span className="tabular-nums">{percent}%</span>
        </p>
        <ProgressBar value={model.progress} />
      </div>
    )
  }

  if (pending.length === 0) return null
  return (
    <p className="flex min-w-0 items-center gap-[7px] text-[12px] text-mute">
      <Sparkles size={14} className="shrink-0 animate-pulse text-accent" />
      <span className="truncate">
        Tagging {pending.length} {pending.length === 1 ? 'meme' : 'memes'}…
      </span>
    </p>
  )
}
