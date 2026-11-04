import { CircleAlert, CircleCheck } from 'lucide-react'
import type { Notice } from '../lib/hooks'

/** A floating HUD message at the bottom of the window. */
export function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  const isError = notice.tone === 'error'
  const Icon = isError ? CircleAlert : CircleCheck
  return (
    <div
      key={notice.text}
      className="toast fixed bottom-5 left-1/2 z-50 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full bg-elevated/95 py-2 pr-4 pl-3 shadow-[0_8px_30px_rgba(0,0,0,0.18)] ring-1 ring-separator backdrop-blur-xl"
    >
      <Icon size={16} className={isError ? 'shrink-0 text-danger' : 'shrink-0 text-accent'} />
      <span className="truncate" title={notice.text}>
        {notice.text}
      </span>
    </div>
  )
}
