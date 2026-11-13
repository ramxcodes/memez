/** iCloud Drive's folder on macOS, relative to the home folder. */
export const ICLOUD_DRIVE = 'Library/Mobile Documents/com~apple~CloudDocs'

/** True when `folder` is in iCloud Drive. Settings then says "Back up to iCloud Drive". */
export const isICloudFolder = (folder: string): boolean =>
  folder.includes('/Mobile Documents/com~apple~CloudDocs')
