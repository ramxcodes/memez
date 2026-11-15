import { describe, expect, it } from 'vitest'
import { isEmptyCommand, parseCommandLine } from './cli'

const NONE = { links: [], togglePopup: false, show: false, hidden: false, help: false }

describe('parseCommandLine', () => {
  it('reads nothing from a plain launch, packaged or in development', () => {
    expect(parseCommandLine(['/opt/Memez/memez'])).toEqual(NONE)
    expect(parseCommandLine(['/usr/bin/electron', '.'])).toEqual(NONE)
    expect(isEmptyCommand(parseCommandLine(['/opt/Memez/memez']))).toBe(true)
  })

  it('reads the flags a window manager or autostart uses', () => {
    expect(parseCommandLine(['memez', '--toggle-popup'])).toEqual({ ...NONE, togglePopup: true })
    expect(parseCommandLine(['memez', '--show'])).toEqual({ ...NONE, show: true })
    expect(parseCommandLine(['memez', '--hidden'])).toEqual({ ...NONE, hidden: true })
    expect(parseCommandLine(['memez', '--help']).help).toBe(true)
    expect(parseCommandLine(['memez', '--Toggle-Popup']).togglePopup).toBe(true)
  })

  it('finds flags and links among the Chromium switches of a second-instance argv', () => {
    const argv = [
      '/opt/Memez/memez',
      '--allow-file-access-from-files',
      '--enable-features=GlobalShortcutsPortal',
      'memez://add',
      '--toggle-popup'
    ]
    expect(parseCommandLine(argv)).toEqual({ ...NONE, links: ['memez://add'], togglePopup: true })
  })

  it('keeps every memez:// link in order, and only those', () => {
    const command = parseCommandLine([
      'memez',
      'memez://used/0123456789abcdef',
      'https://example.com',
      'MEMEZ://add'
    ])
    expect(command.links).toEqual(['memez://used/0123456789abcdef', 'MEMEZ://add'])
    expect(isEmptyCommand(command)).toBe(false)
  })

  it('does not open the library window for a second launch with --hidden (autostart)', () => {
    expect(isEmptyCommand(parseCommandLine(['memez', '--hidden']))).toBe(false)
  })
})
