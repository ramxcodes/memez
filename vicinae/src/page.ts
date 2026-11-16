export const PAGE_SIZE = 50

/**
 * One page of `items`: the ones after the item with id `cursor`, or the first page with no cursor.
 * A cursor works when the list changes between pages, as long as that item is still there.
 * If it is gone, the page is empty. The grid reloads from the first page when the library changes.
 */
export function pageAfter<T extends { id: string }>(items: T[], cursor?: string, size = PAGE_SIZE) {
  const start = cursor === undefined ? 0 : items.findIndex((item) => item.id === cursor) + 1
  if (start === 0 && cursor !== undefined) return { data: [], hasMore: false }
  return { data: items.slice(start, start + size), hasMore: start + size < items.length }
}
