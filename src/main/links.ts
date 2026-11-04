/** What a `memez://` link asks the app to do. Raycast sends these (see `raycast/src/memez.ts`). */
export type MemezLink = { action: 'add' } | { action: 'used'; id: string }

/**
 * Reads a `memez://` link:
 *   memez://add         add the meme on the clipboard (same as ⌘V in the popup)
 *   memez://used/<id>   the meme was pasted or copied, so it moves up in recent memes
 * Throws on any other link.
 */
export function parseLink(url: string): MemezLink {
  const { protocol, hostname, pathname } = new URL(url)
  if (protocol === 'memez:' && hostname === 'add' && !pathname) return { action: 'add' }
  const id = pathname.slice(1)
  if (protocol === 'memez:' && hostname === 'used' && /^[a-f0-9]{16}$/.test(id))
    return { action: 'used', id }
  throw new Error(`Memez does not know this link: ${url}`)
}
