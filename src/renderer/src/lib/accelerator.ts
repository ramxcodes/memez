const NAMED_KEYS: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

// Uses `code` (the physical key), not `key`: with Option held, `key` gives symbols like "µ".
function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^F\d{1,2}$/.test(code)) return code
  return NAMED_KEYS[code] ?? null
}

type KeyPress = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * Turns a key press into an Electron accelerator, like `Command+Shift+M`.
 * Returns null until the user presses a normal key with at least one modifier,
 * because a global shortcut without a modifier would block that key in every app.
 */
export function toAccelerator(event: KeyPress): string | null {
  const key = keyName(event.code)
  const modifiers = [
    event.metaKey ? 'Command' : '',
    event.ctrlKey ? 'Control' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : ''
  ].filter(Boolean)
  if (!key || modifiers.length === 0) return null
  return [...modifiers, key].join('+')
}

const MAC_KEYS: Record<string, string> = {
  CommandOrControl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Shift: '⇧'
}

// Linux and Windows name the keys. Electron's `Command` is the Super (Windows) key there.
const OTHER_KEYS: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  Command: 'Super',
  Control: 'Ctrl'
}

/** `Command+Shift+M` → `['⌘', '⇧', 'M']` on macOS, `['Super', 'Shift', 'M']` elsewhere. One per keycap. */
export const acceleratorKeys = (accelerator: string, isMac: boolean): string[] =>
  accelerator.split('+').map((part) => (isMac ? MAC_KEYS : OTHER_KEYS)[part] ?? part)

/** The main shortcut key, for hints like ⌘F: ⌘ on macOS, Ctrl elsewhere. */
export const modKey = (isMac: boolean): string => (isMac ? '⌘' : 'Ctrl')

/** A shortcut as text, for tooltips: "⌘V" on macOS, "Ctrl+V" elsewhere. */
export const shortcutText = (key: string, isMac: boolean): string =>
  isMac ? `⌘${key}` : `Ctrl+${key}`

/** True when the main shortcut key is held: ⌘ on macOS, Ctrl elsewhere. */
export const isModHeld = (
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>,
  isMac: boolean
): boolean => (isMac ? event.metaKey : event.ctrlKey)
