export type RendererErrorKind = 'error' | 'unhandledrejection'

export interface RendererErrorReport {
  kind: RendererErrorKind
  message: string
  source?: string
  lineno?: number
  colno?: number
  stack?: string
}
