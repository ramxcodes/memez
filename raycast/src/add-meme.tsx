import { showHUD } from '@raycast/api'
import { showFailureToast } from '@raycast/utils'
import { addFromClipboard } from './memez'

/** Command: adds the image, GIF, video or link on the clipboard to Memez. */
export default async function AddMeme() {
  try {
    await addFromClipboard()
    await showHUD('Adding to Memez…')
  } catch (error) {
    await showFailureToast(error, { title: 'Cannot open Memez. Is the app installed?' })
  }
}
