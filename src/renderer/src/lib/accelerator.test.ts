import { describe, expect, it } from 'vitest'
import { acceleratorKeys, isModHeld, shortcutText, toAccelerator } from './accelerator'

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
  it('uses symbols on macOS', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+Space', true)).toEqual(['⌘', '⇧', 'Space'])
    expect(acceleratorKeys('Control+Alt+M', true)).toEqual(['⌃', '⌥', 'M'])
  })

  it('uses key names on Linux and Windows', () => {
    expect(acceleratorKeys('CommandOrControl+Shift+M', false)).toEqual(['Ctrl', 'Shift', 'M'])
    expect(acceleratorKeys('Command+Alt+M', false)).toEqual(['Super', 'Alt', 'M'])
  })
})

describe('shortcutText', () => {
  it('joins with + only off macOS', () => {
    expect([shortcutText('V', true), shortcutText(',', false)]).toEqual(['⌘V', 'Ctrl+,'])
  })
})

describe('isModHeld', () => {
  it('reads ⌘ on macOS and Ctrl elsewhere', () => {
    const ctrl = { metaKey: false, ctrlKey: true }
    expect(isModHeld(ctrl, true)).toBe(false)
    expect(isModHeld(ctrl, false)).toBe(true)
  })
})
