import { mediaFileName, mediaKind, type Meme } from '../../../shared/types'

/**
 * Shows a meme image, GIF or video from the library folder (served by the `meme://` protocol).
 * `play={false}` shows a video's first frame only, so a long grid does not play them all.
 * `onDuration` gets a video's length in seconds once its metadata loads. A file with no stored
 * length (some WebM) reports Infinity or NaN, so it gets no call.
 */
export function MemeMedia(props: {
  meme: Meme
  className?: string
  play?: boolean
  onDuration?: (seconds: number) => void
}) {
  const { meme, className, play = true, onDuration } = props
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
      onLoadedMetadata={(event) => {
        const seconds = event.currentTarget.duration
        if (Number.isFinite(seconds) && seconds > 0) onDuration?.(seconds)
      }}
    />
  ) : (
    <img src={src} className={className} alt={meme.title} draggable={false} loading="lazy" />
  )
}
