import { describe, expect, it } from 'vitest'
import { choosePasteTool, findExecutable, launchCommand, linuxSession, pasteToolFor } from './linux'

describe('linuxSession', () => {
  it('prefers Wayland, then X11, and is null off Linux', () => {
    expect(linuxSession({ WAYLAND_DISPLAY: 'wayland-1', DISPLAY: ':0' }, 'linux')).toBe('wayland')
    expect(linuxSession({ XDG_SESSION_TYPE: 'wayland' }, 'linux')).toBe('wayland')
    expect(linuxSession({ DISPLAY: ':0' }, 'linux')).toBe('x11')
    expect(linuxSession({}, 'linux')).toBeNull()
    expect(linuxSession({ WAYLAND_DISPLAY: 'wayland-1' }, 'darwin')).toBeNull()
  })
})

describe('findExecutable', () => {
  it('returns the first match on PATH', () => {
    const env = { PATH: '/nope:/usr/local/bin:/usr/bin' }
    const canRun = (path: string): boolean =>
      path === '/usr/bin/wtype' || path === '/usr/local/bin/x'
    expect(findExecutable('wtype', env, canRun)).toBe('/usr/bin/wtype')
    expect(findExecutable('x', env, canRun)).toBe('/usr/local/bin/x')
    expect(findExecutable('xdotool', env, canRun)).toBeNull()
    expect(findExecutable('wtype', {}, canRun)).toBeNull()
  })
})

describe('choosePasteTool', () => {
  const installed =
    (...names: string[]) =>
    (name: string): string | null =>
      names.includes(name) ? `/usr/bin/${name}` : null

  it('uses wtype with Shift+Insert on Wayland', () => {
    expect(choosePasteTool('wayland', installed('wtype', 'xdotool'))).toEqual({
      name: 'wtype',
      path: '/usr/bin/wtype',
      args: ['-M', 'shift', '-k', 'Insert', '-m', 'shift']
    })
  })

  it('uses xdotool on X11', () => {
    expect(choosePasteTool('x11', installed('wtype', 'xdotool'))).toEqual({
      name: 'xdotool',
      path: '/usr/bin/xdotool',
      args: ['key', '--clearmodifiers', 'shift+Insert']
    })
  })

  it('does not use the other session’s tool, so the hint names the right one', () => {
    // xdotool on Wayland only reaches XWayland windows.
    expect(choosePasteTool('wayland', installed('xdotool'))).toBeNull()
    expect(choosePasteTool('x11', installed('wtype'))).toBeNull()
    expect(choosePasteTool(null, installed('wtype', 'xdotool'))).toBeNull()
    expect(pasteToolFor('wayland')).toBe('wtype')
    expect(pasteToolFor('x11')).toBe('xdotool')
    expect(pasteToolFor(null)).toBeNull()
  })
})

describe('launchCommand', () => {
  const app = { packaged: true, execPath: '/opt/Memez/memez', appPath: '/opt/Memez/resources/app' }

  it('uses memez from PATH when it is there', () => {
    expect(launchCommand('--toggle-popup', app, {}, '/usr/bin/memez')).toBe('memez --toggle-popup')
    expect(launchCommand('--toggle-popup', app, {}, null)).toBe('/opt/Memez/memez --toggle-popup')
  })

  it('uses the AppImage path when this app runs from it, quoted when needed', () => {
    const mounted = { ...app, execPath: '/tmp/.mount_MemezX/memez' }
    const env = { APPIMAGE: "/home/me/Apps/Me mez's.AppImage", APPDIR: '/tmp/.mount_MemezX' }
    expect(launchCommand('--toggle-popup', mounted, env, '/usr/bin/memez')).toBe(
      `'/home/me/Apps/Me mez'\\''s.AppImage' --toggle-popup`
    )
  })

  it('ignores APPIMAGE inherited from another AppImage that started this one', () => {
    const env = { APPIMAGE: '/home/me/Other.AppImage', APPDIR: '/tmp/.mount_Other' }
    expect(launchCommand('--toggle-popup', app, env, null)).toBe('/opt/Memez/memez --toggle-popup')
  })

  it('runs Electron with the app folder in development', () => {
    expect(
      launchCommand(
        '--toggle-popup',
        { packaged: false, execPath: '/src/node_modules/electron/dist/electron', appPath: '/src' },
        { APPIMAGE: '/home/me/Other.AppImage', APPDIR: '/tmp/.mount_Other' },
        '/usr/bin/memez'
      )
    ).toBe('/src/node_modules/electron/dist/electron /src --toggle-popup')
  })
})
