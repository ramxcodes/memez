import { CircleAlert, Sparkles } from 'lucide-react'
import type { AutoTagStatus } from '../../../shared/types'

/** Thin progress bar. `value` goes from 0 to 1. */
export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-control-strong">
      <div
        className="h-full rounded-full bg-accent transition-[width]"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  )
}

/**
 * One line about the local AI: model download progress, memes still to tag, or a failure with
 * a retry button. Shows nothing when there is no work.
 */
export function AutoTagNote({ status }: { status: AutoTagStatus }) {
  const { model, pending } = status

  if (model.state === 'failed') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-control p-2 text-[12px]">
        <CircleAlert size={14} className="mt-px shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <p className="font-medium">AI tagging is off</p>
          <p className="truncate text-secondary" title={model.message}>
            {model.message}
          </p>
        </div>
        <button
          onClick={() => window.api.retryAutoTag()}
          className="shrink-0 font-medium text-accent hover:brightness-110"
        >
          Retry
        </button>
      </div>
    )
  }

  if (model.state === 'loading') {
    return (
      <div className="flex flex-col gap-1.5 rounded-md bg-control p-2 text-[12px]">
        <p className="flex items-center gap-2">
          <Sparkles size={14} className="shrink-0 text-accent" />
          <span className="flex-1">Getting AI models ready</span>
          <span className="text-secondary tabular-nums">{Math.round(model.progress * 100)}%</span>
        </p>
        <ProgressBar value={model.progress} />
      </div>
    )
  }

  if (pending.length === 0) return null
  return (
    <p className="flex items-center gap-2 px-2 text-[12px] text-secondary">
      <Sparkles size={14} className="shrink-0 animate-pulse text-accent" />
      Tagging {pending.length} {pending.length === 1 ? 'meme' : 'memes'}…
    </p>
  )
}
