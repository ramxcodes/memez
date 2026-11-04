import { mediaFileName, mediaKind, type Meme } from '../../../shared/types'

/**
 * Shows a meme image, GIF or video from the library folder (served by the `meme://` protocol).
 * `play={false}` shows a video's first frame only, so a long grid does not play them all.
 */
export function MemeMedia(props: { meme: Meme; className?: string; play?: boolean }) {
  const { meme, className, play = true } = props
  const src = `meme://media/${mediaFileName(meme)}`
  return mediaKind(meme.ext) === 'video' ? (
    <video
      key={String(play)}
      src={src}
      className={className}
      autoPlay={play}
      preload="metadata"
      muted
      loop
      playsInline
    />
  ) : (
    <img src={src} className={className} alt={meme.title} draggable={false} loading="lazy" />
  )
}
