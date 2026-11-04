import { dataMode, type DataMode } from '../lib/worstCase'

const MODES: { mode: DataMode; label: string }[] = [
  { mode: 'real', label: 'Real data' },
  { mode: 'worst', label: 'Worst case' },
  { mode: 'one', label: 'One' },
  { mode: 'empty', label: 'Empty' }
]

/** Dev-only switch for the test data in worstCase.ts. Plain on purpose: it is not app UI. */
export function DataModeSwitch() {
  const current = dataMode()
  const go = (mode: DataMode): void => {
    const url = new URL(window.location.href)
    if (mode === 'real') url.searchParams.delete('data')
    else url.searchParams.set('data', mode)
    window.location.replace(url)
  }
  return (
    <div className="fixed bottom-3 left-1/2 z-[100] flex -translate-x-1/2 gap-0.5 rounded-full bg-neutral-200 p-0.5 font-sans text-[11px] text-neutral-700 shadow">
      {MODES.map(({ mode, label }) => (
        <button
          key={mode}
          onClick={() => go(mode)}
          className={`rounded-full px-2.5 py-1 ${mode === current ? 'bg-white shadow-sm' : ''}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
