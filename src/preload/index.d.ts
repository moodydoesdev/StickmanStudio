import type { StudioApi } from './index'

declare global {
  interface Window {
    api: StudioApi
  }
}

export {}
