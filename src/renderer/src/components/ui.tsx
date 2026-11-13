import { Repeat, Video } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { mediaKind, type Meme } from '../../../shared/types'
import { formatDuration } from '../lib/format'

/**
 * The shared pieces of the Memez look (Doop "memez-design-system"): Lafda capsule buttons on an
 * Apple surface, Apple Settings cards, Raycast keycaps. Sentence case everywhere, never uppercase.
 */

const cx = (...classes: (string | false | undefined)[]): string => classes.filter(Boolean).join(' ')

const PILL_VARIANTS = {
  /** A plain capsule. Most buttons. */
  plain: 'bg-control text-body shadow-elev hover:bg-surface-2',
  /** The one blue button per view (Copy in Info). */
  primary: 'pill-primary hover:brightness-110 active:brightness-95',
  danger: 'bg-control text-danger shadow-elev hover:bg-surface-2',
  /** Active filter: a dark filled capsule. */
  on: 'bg-ink text-canvas',
  ghost: 'text-body shadow-[inset_0_0_0_1px_var(--hairline-strong)] hover:bg-surface-2',
  dashed: 'border border-dashed border-hairline-strong text-body hover:bg-surface-2'
}

type PillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof PILL_VARIANTS
  size?: 'md' | 'sm'
} & ({ icon: true; 'aria-label': string } | { icon?: false })

/** A capsule button. `icon` makes it round and needs an `aria-label`. */
export function Pill({ variant = 'plain', size = 'md', icon, className, ...props }: PillProps) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-medium whitespace-nowrap transition-[background-color,filter] outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-45',
        size === 'md' ? 'h-[30px] gap-[7px] text-[13px]' : 'h-[26px] gap-[5px] text-[12px]',
        icon ? (size === 'md' ? 'w-[30px]' : 'w-[26px]') : size === 'md' ? 'px-[13px]' : 'px-2.5',
        PILL_VARIANTS[variant],
        className
      )}
    />
  )
}

/** Several icon buttons in one capsule, like the Info footer. Put `PillDivider` between groups. */
export function PillGroup({ children }: { children: ReactNode }) {
  return (
    <div className="inline-flex h-[30px] items-center rounded-full bg-control px-[3px] text-body shadow-elev">
      {children}
    </div>
  )
}

export function PillGroupButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { 'aria-label': string }) {
  return (
    <button
      type="button"
      title={props['aria-label']}
      {...props}
      className={cx(
        'inline-flex h-6 min-w-7 items-center justify-center rounded-full px-2 outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-40',
        className
      )}
    />
  )
}

export const PillDivider = () => <span className="mx-[3px] h-3.5 w-px bg-hairline-strong" />

/** Apple segmented control for a two- or three-way choice. */
export function Segmented<T extends string>(props: {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={props.label}
      className="inline-flex rounded-full bg-surface-2 p-0.5"
    >
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          onClick={() => props.onChange(option.value)}
          className={cx(
            'inline-flex h-6 items-center rounded-full px-3 text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
            option.value === props.value ? 'bg-control text-ink shadow-elev' : 'text-mute'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Apple on/off switch. */
export function Switch(props: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
      className={cx(
        'relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-45',
        props.checked ? 'bg-success' : 'bg-surface-3'
      )}
    >
      <span
        className={cx(
          'absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25),0_0_0_0.5px_rgba(0,0,0,0.06)] transition-transform',
          props.checked && 'translate-x-4'
        )}
      />
    </button>
  )
}

/** Raycast-style keycaps, one per key: `['⌘', 'F']`. */
export function Keycaps({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex gap-[3px]">
      {keys.map((key) => (
        <kbd
          key={key}
          className="inline-flex h-[19px] min-w-[19px] items-center justify-center rounded-[5px] bg-control px-[5px] font-sans text-[11px] font-medium text-mute shadow-elev"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

/** Apple Settings grouped list. Rows get a divider inset to the text. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl bg-control shadow-card [&>*+*]:relative [&>*+*]:before:absolute [&>*+*]:before:top-0 [&>*+*]:before:right-0 [&>*+*]:before:left-[54px] [&>*+*]:before:border-t [&>*+*]:before:border-hairline">
      {children}
    </div>
  )
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex min-h-12 items-center gap-3 px-3.5 py-[9px]', className)}>
      {children}
    </div>
  )
}

const TILE_COLORS = {
  blue: 'from-[#3d9bff] to-[#0a6cff]',
  purple: 'from-[#c56cf0] to-[#8e3fd6]',
  indigo: 'from-[#7a7cff] to-[#4f4ad6]',
  orange: 'from-[#ffa53d] to-[#f07b0a]',
  green: 'from-[#46d36b] to-[#22a447]',
  teal: 'from-[#4cc9e0] to-[#1594b8]',
  gray: 'from-[#a3a3a8] to-[#7a7a80]',
  red: 'from-[#ff6b6b] to-[#e0383e]'
}

/** The colored square icon at the start of a Settings row. Pass a 16px lucide icon. */
export function IconTile({
  color,
  children
}: {
  color: keyof typeof TILE_COLORS
  children: ReactNode
}) {
  return (
    <span
      className={cx(
        'icon-tile flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-gradient-to-b text-white',
        TILE_COLORS[color]
      )}
    >
      {children}
    </span>
  )
}

/**
 * Bottom-right badge on a media tile: a loop for animated memes, a camera plus the length for
 * videos. Nothing for still images. `seconds` is unknown until the video's metadata loads.
 */
export function KindBadge({ meme, seconds }: { meme: Meme; seconds?: number }) {
  const kind = mediaKind(meme.ext)
  if (kind === 'image') return null
  return (
    <span
      role="img"
      aria-label={kind === 'gif' ? 'Animated' : 'Video'}
      className="absolute right-1.5 bottom-1.5 z-[1] inline-flex h-[18px] items-center gap-[3px] rounded-full bg-scrim px-1.5 text-[10.5px] font-semibold text-white tabular-nums backdrop-blur-md"
    >
      {kind === 'gif' ? (
        <Repeat size={11} strokeWidth={2.2} />
      ) : (
        <Video size={11} strokeWidth={2.2} />
      )}
      {kind === 'video' && seconds !== undefined && formatDuration(seconds)}
    </span>
  )
}
