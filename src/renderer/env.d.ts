/// <reference types="vite/client" />

import type { DevLaunchrApi } from '../preload'

declare global {
  interface Window {
    devlaunchr: DevLaunchrApi
  }
}

export {}

declare module '*.png' {
  const src: string
  export default src
}
