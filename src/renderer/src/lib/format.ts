/** "0:12" from seconds. */
export const formatDuration = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

const unit = (name: 'kilobyte' | 'megabyte') =>
  new Intl.NumberFormat('en', { style: 'unit', unit: name, maximumFractionDigits: 0 })
const kilobytes = unit('kilobyte')
const megabytes = unit('megabyte')

/** "182 MB", or "215 kB" below 1 MB, so a small backup never reads "0 MB". Like Finder, 1 MB = 1,000,000 bytes. */
export const formatSize = (bytes: number): string =>
  bytes < 1e6 ? kilobytes.format(bytes / 1e3) : megabytes.format(bytes / 1e6)
