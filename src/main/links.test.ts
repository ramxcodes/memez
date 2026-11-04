import { describe, expect, it } from 'vitest'
import { parseLink } from './links'

describe('parseLink', () => {
  it('reads add and used links', () => {
    expect(parseLink('memez://add')).toEqual({ action: 'add' })
    expect(parseLink('memez://used/0123456789abcdef')).toEqual({
      action: 'used',
      id: '0123456789abcdef'
    })
  })

  it.each([
    'memez://delete/0123456789abcdef',
    'memez://used/../library.json',
    'memez://used/',
    'memez://add/extra',
    'https://add'
  ])('rejects %s', (url) => {
    expect(() => parseLink(url)).toThrow('does not know this link')
  })
})
