import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
const { addBinding, hasBinding, keyTaken, removeBinding, KEY } = await import('./omarchy')

const USER_FILE = '-- my bindings\no.bind("SUPER + SHIFT + R", "SSH", "alacritty -e ssh box")\n'

describe('Omarchy key binding', () => {
  it('adds one marked binding to the user bindings', () => {
    const next = addBinding(USER_FILE)
    expect(next.startsWith(USER_FILE)).toBe(true)
    expect(next).toContain(`o.bind("${KEY}", "Memez", { panel = "memez" })`)
    expect(addBinding(next)).toBe(next)
  })

  it('removes exactly what it added', () => {
    expect(removeBinding(addBinding(USER_FILE))).toBe(USER_FILE)
    expect(removeBinding(addBinding(''))).toBe('')
  })

  it('handles a file without a trailing newline', () => {
    const text = 'o.bind("SUPER + E", nil, "nautilus")'
    expect(removeBinding(addBinding(text))).toBe(text + '\n')
  })

  it('keeps a binding the user wrote by hand', () => {
    const own = 'o.bind("SUPER + G", "Memes", { panel = "memez" })\n'
    expect(hasBinding(own)).toBe(true)
    expect(addBinding(own)).toBe(own)
    expect(removeBinding(own)).toBe(own)
  })

  it('sees when Super+Ctrl+M is already taken', () => {
    expect(keyTaken([{ modmask: 68, key: 'M' }])).toBe(true)
    expect(keyTaken([{ modmask: 64, key: 'M' }, { modmask: 68, key: 'V' }])).toBe(false)
  })
})
