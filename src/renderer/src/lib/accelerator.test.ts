import { describe, expect, it } from 'vitest'
import { acceleratorKeys, toAccelerator } from './accelerator'

const press = (
  code: string,
  mods: Partial<Record<'meta' | 'ctrl' | 'alt' | 'shift', boolean>>
) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift
})

describe('toAccelerator', () => {
  it('builds an accelerator from the physical key', () => {
    expect(toAccelerator(press('KeyM', { meta: true, alt: true }))).toBe('Command+Alt+M')
    expect(toAccelerator(press('Space', { ctrl: true }))).toBe('Control+Space')
  })

  it('waits for a normal key with a modifier', () => {
    expect(toAccelerator(press('KeyM', {}))).toBeNull()
    expect(toAccelerator(press('ShiftLeft', { shift: true }))).toBeNull()
  })
})

describe('acceleratorKeys', () => {
  it('uses macOS symbols', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+Space')).toEqual(['⌘', '⇧', 'Space'])
  })
})
