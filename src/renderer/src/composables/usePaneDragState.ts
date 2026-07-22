import { reactive } from 'vue'

type PaneDragState = {
  dragging: boolean
  sourcePaneId: string | null
  targetPaneId: string | null
  position: 'top' | 'right' | 'bottom' | 'left' | null
}

const paneDragState = reactive<PaneDragState>({
  dragging: false,
  sourcePaneId: null,
  targetPaneId: null,
  position: null,
})

export function usePaneDragState(): PaneDragState {
  return paneDragState
}
