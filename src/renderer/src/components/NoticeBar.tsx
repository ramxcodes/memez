import { CircleAlert, CircleCheck } from 'lucide-react'
import type { Notice } from '../lib/hooks'

/** A floating capsule message at the bottom of the window. */
export function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice) return null
  const isError = notice.tone === 'error'
  const Icon = isError ? CircleAlert : CircleCheck
  return (
    <div
      key={notice.text}
      role="status"
      className="toast fixed bottom-5 left-1/2 z-50 flex max-w-[80%] -translate-x-1/2 items-center gap-2 rounded-full bg-control py-2 pr-4 pl-3 font-medium text-body shadow-elev"
    >
      <Icon size={15} className={isError ? 'shrink-0 text-danger' : 'shrink-0 text-success'} />
      <span className="truncate" title={notice.text}>
        {notice.text}
      </span>
    </div>
  )
}
