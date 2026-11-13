import { describe, expect, it } from 'vitest'
import { formatDuration, formatSize } from './format'

describe('formatDuration', () => {
  it('writes minutes and two-digit seconds', () => {
    expect(formatDuration(12.4)).toBe('0:12')
    expect(formatDuration(59.6)).toBe('1:00')
    expect(formatDuration(605)).toBe('10:05')
  })
})

describe('formatSize', () => {
  it('writes whole megabytes', () => {
    expect(formatSize(181_600_000)).toBe('182 MB')
  })

  it('uses kilobytes below 1 MB, so a small backup never reads 0 MB', () => {
    expect(formatSize(215_287)).toBe('215 kB')
  })
})
