import { ClipboardPaste } from 'lucide-react'
import type { ReactNode } from 'react'
import { modKey } from '../../lib/accelerator'
import { IconTile, Keycaps, Pill } from '../ui'

/** First run: the library has no memes. Its one primary button adds from the clipboard. */
export function EmptyLibrary({ onPaste }: { onPaste: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
      <span className="mb-1 scale-150">
        <IconTile color="blue">
          <ClipboardPaste size={16} />
        </IconTile>
      </span>
      <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Start your meme library</h2>
      <p className="max-w-72 text-mute">
        Copy any image, animated meme or video, then press{' '}
        <Keycaps keys={[modKey(window.api.isMac), 'V']} /> here. You can also drop files into this
        window.
      </p>
      <Pill variant="primary" className="mt-2" onClick={onPaste}>
        Paste from clipboard
      </Pill>
    </div>
  )
}

/** A centered message in the grid area: no results, searching, nothing in this scope. */
export function GridMessage(props: { icon?: ReactNode; title: string; text?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 pb-12 text-center">
      {props.icon && <span className="mb-1 text-ash">{props.icon}</span>}
      <p className="text-[15px] font-semibold text-ink">{props.title}</p>
      {props.text && <p className="text-mute">{props.text}</p>}
    </div>
  )
}
