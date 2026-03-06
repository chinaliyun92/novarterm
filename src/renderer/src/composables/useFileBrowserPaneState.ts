import { reactive } from 'vue'

interface OpenFileBrowserPanePayload {
  sessionId: string
  path: string
}

interface FileBrowserPaneState {
  visible: boolean
  sourceSessionId: string | null
  path: string | null
  requestId: number
}

function createFileBrowserPaneState() {
  const state = reactive<FileBrowserPaneState>({
    visible: false,
    sourceSessionId: null,
    path: null,
    requestId: 0,
  })

  function open(payload: OpenFileBrowserPanePayload): void {
    const sessionId = payload.sessionId.trim()
    const path = payload.path.trim()
    if (!sessionId || !path) {
      return
    }

    state.visible = true
    state.sourceSessionId = sessionId
    state.path = path
    state.requestId += 1
  }

  function close(): void {
    state.visible = false
  }

  function updatePath(path: string): void {
    const normalized = path.trim()
    if (!normalized) {
      return
    }
    state.path = normalized
  }

  return {
    state,
    open,
    close,
    updatePath,
  }
}

const fileBrowserPaneState = createFileBrowserPaneState()

export function useFileBrowserPaneState() {
  return fileBrowserPaneState
}
