import { describe, expect, it } from 'vitest'
import { DEFAULT_MODELS } from '../shared/models'
import { parseSettings } from './settings'

describe('parseSettings', () => {
  it('loads an old file without backup or models, and keeps its hotkey', () => {
    const settings = parseSettings({ hotkey: 'Alt+Space', localAi: false, pasteMode: 'copy' })

    expect(settings).toEqual({
      hotkey: 'Alt+Space',
      localAi: false,
      pasteMode: 'copy',
      backup: { state: 'off' },
      models: DEFAULT_MODELS
    })
  })

  it('keeps a removed (null) hotkey', () => {
    expect(parseSettings({ hotkey: null }).hotkey).toBeNull()
  })

  it('replaces bad values with defaults', () => {
    const settings = parseSettings({
      hotkey: 42,
      localAi: 'yes',
      pasteMode: 'drop',
      backup: { state: 'on' },
      lastBackup: { state: 'done', at: '2026-11-13T09:41:00Z' },
      models: { caption: 'clip-vit-l-14', clip: 'gpt-9' }
    })

    expect(settings).toEqual(parseSettings(undefined))
    expect(settings.lastBackup).toBeUndefined()
  })

  it('keeps a valid backup, last result and models', () => {
    const raw = {
      backup: { state: 'on', folder: '/backups/Memez' },
      lastBackup: { state: 'failed', at: '2026-11-13T09:41:00Z', message: 'Disk full' },
      models: { caption: 'florence-2-large', clip: 'clip-vit-l-14' }
    }

    expect(parseSettings(raw)).toMatchObject(raw)
  })

  it('returns a fresh copy each time', () => {
    const first = parseSettings(null)
    first.models.caption = 'florence-2-large'

    expect(parseSettings(null).models.caption).toBe('florence-2-base')
  })
})
