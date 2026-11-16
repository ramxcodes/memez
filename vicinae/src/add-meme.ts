import { Toast, showToast } from '@vicinae/api'
import { addFromClipboard } from './memez'

/** Command: adds the image, GIF, video or link on the clipboard to Memez. */
export default async function AddMeme() {
  try {
    await addFromClipboard()
    await showToast({
      style: Toast.Style.Success,
      title: 'Adding to Memez',
      message: 'Memez will show a notification when it is done.'
    })
  } catch (reason) {
    await showToast({
      style: Toast.Style.Failure,
      title: 'Cannot open Memez. Is the app installed?',
      message: reason instanceof Error ? reason.message : String(reason)
    })
  }
}
