/**
 * What a command line asks Memez to do. A window manager key can run `memez --toggle-popup`,
 * and the system opens `memez://` links on Linux and Windows by starting `memez <link>`.
 * When Memez already runs, the new process hands its command line to the running one
 * (`second-instance`) and quits.
 */
export interface Command {
  /** `memez://` links, in order. See links.ts. */
  links: string[]
  /** `--toggle-popup`: show the hotkey popup, or hide it when it shows. */
  togglePopup: boolean
  /** `--show`: show the library window. */
  show: boolean
  /** `--hidden`: start without the library window (for autostart). First launch only. */
  hidden: boolean
  /** `--help`: print the usage and quit. */
  help: boolean
}

export const CLI_HELP = `Usage: memez [options] [memez://link]

  --toggle-popup   Show or hide the meme search popup (bind this to a key)
  --show           Show the library window
  --hidden         Start in the background, without the library window
  --help           Print this help
  memez://add      Add the meme on the clipboard`

/**
 * Reads a command line. `argv` is the whole `process.argv` (or the `second-instance` argv), so
 * it holds the executable, maybe the app folder in development, and Chromium switches that
 * Electron adds. Only the flags above and `memez://` links count; everything else is ignored.
 */
export function parseCommandLine(argv: readonly string[]): Command {
  const flags = new Set(argv.map((arg) => arg.toLowerCase()))
  return {
    links: argv.filter((arg) => /^memez:/i.test(arg)),
    togglePopup: flags.has('--toggle-popup'),
    show: flags.has('--show'),
    hidden: flags.has('--hidden'),
    help: flags.has('--help') || flags.has('-h')
  }
}

/**
 * True when the command asks for nothing: a plain second launch shows the library window.
 * `--hidden` is not nothing: an autostart while Memez runs must not open a window.
 */
export const isEmptyCommand = (command: Command): boolean =>
  command.links.length === 0 && !command.togglePopup && !command.show && !command.hidden
