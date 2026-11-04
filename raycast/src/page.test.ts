import { describe, expect, it } from 'vitest'
import { pageAfter } from './page'

const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
const ids = (page: { data: { id: string }[] }) => page.data.map((item) => item.id)

describe('pageAfter', () => {
  it('pages through all items after the cursor', () => {
    const first = pageAfter(items, undefined, 2)
    expect([ids(first), first.hasMore]).toEqual([['a', 'b'], true])
    const second = pageAfter(items, 'b', 2)
    expect([ids(second), second.hasMore]).toEqual([['c', 'd'], true])
    const last = pageAfter(items, 'd', 2)
    expect([ids(last), last.hasMore]).toEqual([['e'], false])
  })

  it('does not skip or repeat items when one is added before the cursor', () => {
    expect(ids(pageAfter([{ id: 'new' }, ...items], 'b', 2))).toEqual(['c', 'd'])
  })

  it('returns an empty last page when the cursor item is gone', () => {
    expect(pageAfter(items, 'deleted', 2)).toEqual({ data: [], hasMore: false })
  })
})
