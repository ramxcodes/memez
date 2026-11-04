import type { MemezApi } from '../shared/types'

declare global {
  interface Window {
    api: MemezApi
  }
}
