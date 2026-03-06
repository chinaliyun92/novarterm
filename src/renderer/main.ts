import { createApp } from 'vue'
import 'virtual:uno.css'
import 'xterm/css/xterm.css'
import App from './App.vue'
import type { RendererErrorReport } from '../shared/types/log'

function hasFullElectronApi(candidate: unknown): candidate is ElectronApi {
  if (!candidate || typeof candidate !== 'object') {
    return false
  }

  const api = candidate as Partial<ElectronApi>
  const localFile = api.localFile
  const hasLocalFileApi = Boolean(
    localFile &&
      typeof localFile.list === 'function' &&
      typeof localFile.createFile === 'function' &&
      typeof localFile.createDirectory === 'function' &&
      typeof localFile.rename === 'function' &&
      typeof localFile.delete === 'function',
  )

  return Boolean(api.ping && api.server && api.ssh && api.settings && api.terminal && hasLocalFileApi)
}

function normalizeElectronApiBridge(): void {
  const globalWindow = window as Window & {
    electronAPI?: Partial<ElectronApi>
    __electronAPIBridge?: ElectronApi
  }

  if (hasFullElectronApi(globalWindow.electronAPI)) {
    return
  }

  if (hasFullElectronApi(globalWindow.__electronAPIBridge)) {
    globalWindow.electronAPI = globalWindow.__electronAPIBridge
  }
}

interface RendererLogBridge {
  reportRendererError: (report: RendererErrorReport) => Promise<void>
}

function getRendererLogBridge(): RendererLogBridge | null {
  const api = (window as unknown as { electronAPI?: { log?: RendererLogBridge } }).electronAPI
  return api?.log ?? null
}

function toErrorMessageAndStack(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: reason.message || reason.name || 'unknown error',
      stack: reason.stack,
    }
  }

  if (typeof reason === 'string') {
    return { message: reason }
  }

  try {
    return { message: JSON.stringify(reason) }
  } catch {
    return { message: String(reason) }
  }
}

function reportRendererError(report: RendererErrorReport): void {
  const bridge = getRendererLogBridge()
  if (!bridge?.reportRendererError) {
    console.error('[renderer][log] reportRendererError bridge unavailable', report)
    return
  }

  void bridge.reportRendererError(report).catch((error: unknown) => {
    console.error('[renderer][log] failed to report renderer error', error)
  })
}

function registerGlobalErrorHandlers(): void {
  window.onerror = (message, source, lineno, colno, error) => {
    const normalizedMessage =
      typeof message === 'string'
        ? message
        : message instanceof Event
          ? `event:${message.type}`
          : String(message)

    reportRendererError({
      kind: 'error',
      message: normalizedMessage,
      source: source ?? undefined,
      lineno: typeof lineno === 'number' ? lineno : undefined,
      colno: typeof colno === 'number' ? colno : undefined,
      stack: error?.stack,
    })

    return false
  }

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const normalized = toErrorMessageAndStack(event.reason)
    reportRendererError({
      kind: 'unhandledrejection',
      message: normalized.message,
      stack: normalized.stack,
    })
  })
}

registerGlobalErrorHandlers()
normalizeElectronApiBridge()

createApp(App).mount('#app')
