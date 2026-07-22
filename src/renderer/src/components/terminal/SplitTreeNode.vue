<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n } from '../../composables/useI18n'
import { usePaneDragState } from '../../composables/usePaneDragState'
import { useServerSidebarState } from '../../composables/useServerSidebarState'
import { useTerminalWorkspaceState } from '../../composables/useTerminalWorkspaceState'
import type { ServerRecord } from '../../types/server'
import type { SplitLayoutBranchNode, SplitLayoutLeafNode, SplitLayoutNode, TerminalSession } from '../../types/terminal'
import LocalFileBrowser from '../file/LocalFileBrowser.vue'
import RemoteFileBrowser from '../file/RemoteFileBrowser.vue'
import XtermTerminal from './XtermTerminal.vue'

defineOptions({
  name: 'SplitTreeNode',
})

const props = defineProps<{
  node: SplitLayoutNode
  focusedPaneId: string | null
  activeSessionId: string | null
  sessionMap: Record<string, TerminalSession>
}>()

const emit = defineEmits<{
  (event: 'focus-pane', paneId: string): void
  (event: 'update-branch-ratio', payload: { branchId: string; splitRatio: number; final: boolean }): void
  (event: 'update-file-pane-path', payload: { sessionId: string; path: string }): void
  (event: 'request-close-focused'): void
}>()

const branchHostEl = ref<HTMLElement | null>(null)
const dragPreviewRatio = ref<number | null>(null)
const DRAG_MIN_RATIO = 0.05
const DRAG_MAX_RATIO = 0.95
const MIN_PANE_SIZE_PX = 120
const DRAG_EPSILON = 0.001
const FILE_PANE_LOCAL_SOURCE_VALUE = 'local'
const FILE_PANE_REMOTE_UNBOUND_SOURCE_VALUE = '__remote_unbound__'
const FILE_PANE_LOADING_SOURCE_VALUE = '__loading__'
const FILE_PANE_SERVER_SOURCE_PREFIX = 'server:'
let removeDragListeners: (() => void) | null = null

const i18n = useI18n()
const globalMessage = useGlobalMessage()
const serverState = useServerSidebarState()
const workspace = useTerminalWorkspaceState()
const dragState = usePaneDragState()
const switchingFilePaneSessionId = ref<string | null>(null)

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

function emitFocusPane(paneId: string): void {
  emit('focus-pane', paneId)
}

function emitUpdateBranchRatio(payload: { branchId: string; splitRatio: number; final: boolean }): void {
  emit('update-branch-ratio', payload)
}

function emitUpdateFilePanePath(payload: { sessionId: string; path: string }): void {
  emit('update-file-pane-path', payload)
}

function requestCloseFocused(): void {
  emit('request-close-focused')
}

function resetDragState(): void {
  dragState.dragging = false
  dragState.sourcePaneId = null
  dragState.targetPaneId = null
  dragState.position = null
}

function handlePaneHeaderDragStart(event: DragEvent, paneId: string): void {
  dragState.dragging = true
  dragState.sourcePaneId = paneId
  dragState.targetPaneId = null
  dragState.position = null
  console.log('[pane-drag] start', { sourcePaneId: paneId })
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', paneId)
  }
}

function handlePaneHeaderDragEnd(): void {
  console.log('[pane-drag] end', {
    sourcePaneId: dragState.sourcePaneId,
    targetPaneId: dragState.targetPaneId,
    position: dragState.position,
  })
  resetDragState()
}

function resolveNearestEdge(event: DragEvent, element: HTMLElement): 'top' | 'right' | 'bottom' | 'left' {
  const rect = element.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const leftDist = localX
  const rightDist = rect.width - localX
  const topDist = localY
  const bottomDist = rect.height - localY
  const minDist = Math.min(leftDist, rightDist, topDist, bottomDist)

  if (minDist === topDist) {
    return 'top'
  }
  if (minDist === rightDist) {
    return 'right'
  }
  if (minDist === bottomDist) {
    return 'bottom'
  }
  return 'left'
}

function handlePaneDragOver(event: DragEvent, paneId: string): void {
  if (!dragState.dragging || dragState.sourcePaneId === paneId) {
    return
  }

  event.preventDefault()
  const nextPosition = resolveNearestEdge(event, event.currentTarget as HTMLElement)
  if (dragState.targetPaneId !== paneId || dragState.position !== nextPosition) {
    console.log('[pane-drag] over', { targetPaneId: paneId, position: nextPosition })
  }
  dragState.targetPaneId = paneId
  dragState.position = nextPosition
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handlePaneDragLeave(event: DragEvent, paneId: string): void {
  const current = event.currentTarget as HTMLElement | null
  const related = event.relatedTarget as HTMLElement | null
  if (current && related && current.contains(related)) {
    return
  }
  if (dragState.targetPaneId === paneId) {
    dragState.targetPaneId = null
    dragState.position = null
  }
}

function handlePaneDrop(event: DragEvent, paneId: string): void {
  if (!dragState.dragging || dragState.sourcePaneId === paneId) {
    return
  }
  event.preventDefault()
  const sourcePaneId = dragState.sourcePaneId
  const position = dragState.position
  resetDragState()
  if (!sourcePaneId || !position) {
    return
  }
  workspace.movePane(sourcePaneId, paneId, position)
}
function isLeafFocused(node: SplitLayoutNode): boolean {
  if (node.type !== 'leaf') {
    return false
  }

  if (props.focusedPaneId && props.focusedPaneId === node.id) {
    return true
  }

  return Boolean(props.activeSessionId && props.activeSessionId === node.sessionId)
}

function resolvePaneLabel(session: TerminalSession | undefined): string {
  if (!session) {
    return t('terminal.pane.label.local')
  }

  if (session.kind === 'file') {
    const path = resolveFilePanePath(session)
    const prefix =
      session.filePaneSourceKind === 'ssh'
        ? t('terminal.pane.label.remote')
        : t('terminal.pane.label.local')
    return `${prefix}:${path || '/'}`
  }

  const host = session.sshHost?.trim() ?? ''
  if (host) {
    return `ssh:${host}`
  }

  const shell = session.localShellName?.trim().toLowerCase() ?? ''
  if (shell === 'zsh') {
    return 'zsh'
  }
  if (shell === 'bash') {
    return 'bash'
  }

  return t('terminal.pane.label.local')
}

function isFilePaneSession(session: TerminalSession | undefined): boolean {
  return session?.kind === 'file'
}

function isTerminalPaneSession(session: TerminalSession | undefined): boolean {
  return Boolean(session && session.kind !== 'file')
}

function resolveFilePanePath(session: TerminalSession | undefined): string | null {
  const value = session?.filePanePath?.trim() ?? ''
  return value || null
}

function resolveFilePaneSourceKind(session: TerminalSession | undefined): 'local' | 'ssh' {
  return session?.filePaneSourceKind === 'ssh' ? 'ssh' : 'local'
}

function resolveFilePaneSourceSessionId(session: TerminalSession | undefined): string | null {
  const value = session?.filePaneSourceSessionId?.trim() ?? ''
  return value || null
}

function formatErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallback
}

function toServerSourceValue(serverId: number): string {
  return `${FILE_PANE_SERVER_SOURCE_PREFIX}${serverId}`
}

function parseServerSourceValue(value: string): number | null {
  if (!value.startsWith(FILE_PANE_SERVER_SOURCE_PREFIX)) {
    return null
  }

  const candidate = Number.parseInt(value.slice(FILE_PANE_SERVER_SOURCE_PREFIX.length), 10)
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return null
  }

  return candidate
}

function resolveRemoteStartPath(server: ServerRecord): string {
  const path = server.defaultDirectory?.trim() ?? ''
  return path || '/'
}

function formatFilePaneServerLabel(server: ServerRecord): string {
  return `${server.name} (${server.username}@${server.host})`
}


function resolveFilePaneSelectedSourceValue(session: TerminalSession | undefined, paneSessionId: string): string {
  if (!isFilePaneSession(session) || resolveFilePaneSourceKind(session) !== 'ssh') {
    return FILE_PANE_LOCAL_SOURCE_VALUE
  }

  const sourceSessionId = resolveFilePaneSourceSessionId(session) ?? paneSessionId
  const boundServer = serverState.getSessionBoundServer(sourceSessionId)
  if (!boundServer) {
    return FILE_PANE_REMOTE_UNBOUND_SOURCE_VALUE
  }

  return toServerSourceValue(boundServer.id)
}

function isFilePaneSourceSwitching(sessionId: string): boolean {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return false
  }

  return switchingFilePaneSessionId.value === normalizedSessionId || serverState.isSessionBusy(normalizedSessionId)
}

const filePaneServerOptions = computed<ServerRecord[]>(() => {
  return [...serverState.servers.value].sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    if (byName !== 0) {
      return byName
    }
    return left.host.localeCompare(right.host)
  })
})

async function switchFilePaneSource(sessionId: string, sourceValue: string): Promise<void> {
  const normalizedSessionId = sessionId.trim()
  if (!normalizedSessionId) {
    return
  }

  if (sourceValue === FILE_PANE_LOCAL_SOURCE_VALUE) {
    workspace.updateSession(normalizedSessionId, {
      filePaneSourceKind: 'local',
      filePaneSourceSessionId: null,
      filePanePath: '/',
      sshHost: null,
    })
    return
  }

  if (sourceValue === FILE_PANE_REMOTE_UNBOUND_SOURCE_VALUE || sourceValue === FILE_PANE_LOADING_SOURCE_VALUE) {
    return
  }

  const serverId = parseServerSourceValue(sourceValue)
  if (!serverId) {
    return
  }

  const server = serverState.servers.value.find((item) => item.id === serverId)
  if (!server) {
    globalMessage.error(t('terminal.filePane.sourceServerMissing'), { replace: true })
    return
  }

  if (switchingFilePaneSessionId.value === normalizedSessionId) {
    return
  }

  switchingFilePaneSessionId.value = normalizedSessionId
  try {
    await serverState.connectSession(normalizedSessionId, server.id)
    workspace.updateSession(normalizedSessionId, {
      filePaneSourceKind: 'ssh',
      filePaneSourceSessionId: normalizedSessionId,
      filePanePath: resolveRemoteStartPath(server),
      sshHost: server.host,
    })
  } catch (error) {
    globalMessage.error(
      t('terminal.filePane.sourceSwitchFailed', {
        detail: formatErrorMessage(error, t('terminal.filePane.sourceSwitchFailedFallback')),
      }),
      { replace: true },
    )
  } finally {
    if (switchingFilePaneSessionId.value === normalizedSessionId) {
      switchingFilePaneSessionId.value = null
    }
  }
}

async function handleFilePaneSourceChange(sessionId: string, event: Event): Promise<void> {
  const target = event.target as HTMLSelectElement | null
  if (!target) {
    return
  }

  await switchFilePaneSource(sessionId, target.value)
  const session = props.sessionMap[sessionId]
  target.value = resolveFilePaneSelectedSourceValue(session, sessionId)
}

function handleFilePanePathChange(sessionId: string, path: string): void {
  emitUpdateFilePanePath({ sessionId, path })
}

const selfHostedLeafNode = computed<SplitLayoutLeafNode | null>(() => {
  return props.node.type === 'leaf' ? props.node : null
})

const delegatedBranchNode = computed<SplitLayoutBranchNode | null>(() => {
  return props.node.type === 'branch' ? props.node : null
})

const selfHostedSession = computed<TerminalSession | undefined>(() => {
  const leaf = selfHostedLeafNode.value
  if (!leaf) {
    return undefined
  }

  return props.sessionMap[leaf.sessionId]
})

const dropIndicatorPosition = computed<'top' | 'left' | 'right' | 'bottom' | null>(() => {
  const leafId = selfHostedLeafNode.value?.id ?? null
  if (
    Boolean(leafId) &&
    dragState.dragging &&
    dragState.targetPaneId === leafId &&
    isTerminalPaneSession(selfHostedSession.value)
  ) {
    if (
      dragState.position === 'top' ||
      dragState.position === 'left' ||
      dragState.position === 'right' ||
      dragState.position === 'bottom'
    ) {
      return dragState.position
    }
  }

  return null
})


watch(
  () => isFilePaneSession(selfHostedSession.value),
  (isFilePane) => {
    if (!isFilePane) {
      return
    }

    void serverState.ensureLoaded().catch((error) => {
      globalMessage.error(
        t('terminal.filePane.sourceLoadFailed', {
          detail: formatErrorMessage(error, t('terminal.filePane.sourceLoadFailedFallback')),
        }),
        { replace: true },
      )
    })
  },
  { immediate: true },
)

function resolveBranchSplitRatio(node: SplitLayoutNode): number {
  if (node.type !== 'branch') {
    return 0.5
  }

  const candidate = node.splitRatio
  if (!Number.isFinite(candidate)) {
    return 0.5
  }

  return Math.max(DRAG_MIN_RATIO, Math.min(DRAG_MAX_RATIO, candidate as number))
}

const firstPaneStyle = computed<CSSProperties>(() => {
  if (props.node.type !== 'branch') {
    return {}
  }

  const ratio = dragPreviewRatio.value ?? resolveBranchSplitRatio(props.node)
  const firstTrack = `${(ratio * 100).toFixed(2)}%`
  const dividerTrack = '4px'
  const secondTrack = 'minmax(0, 1fr)'
  if (props.node.direction === 'vertical') {
    return {
      gridTemplateRows: `${firstTrack} ${dividerTrack} ${secondTrack}`,
    }
  }

  return {
    gridTemplateColumns: `${firstTrack} ${dividerTrack} ${secondTrack}`,
  }
})

function clampDragRatio(ratio: number, majorSize: number): number {
  if (!Number.isFinite(ratio)) {
    return 0.5
  }

  if (!Number.isFinite(majorSize) || majorSize <= 0) {
    return Math.max(DRAG_MIN_RATIO, Math.min(DRAG_MAX_RATIO, ratio))
  }

  const dynamicMin = Math.max(DRAG_MIN_RATIO, Math.min(0.45, MIN_PANE_SIZE_PX / majorSize))
  const dynamicMax = Math.min(DRAG_MAX_RATIO, Math.max(0.55, 1 - dynamicMin))
  if (dynamicMin >= dynamicMax) {
    return Math.max(DRAG_MIN_RATIO, Math.min(DRAG_MAX_RATIO, ratio))
  }

  return Math.max(dynamicMin, Math.min(dynamicMax, ratio))
}

function resolvePointerRatio(event: PointerEvent, hostRect: DOMRect, direction: 'horizontal' | 'vertical'): number {
  if (direction === 'vertical') {
    const y = event.clientY - hostRect.top
    return clampDragRatio(y / hostRect.height, hostRect.height)
  }

  const x = event.clientX - hostRect.left
  return clampDragRatio(x / hostRect.width, hostRect.width)
}

function isRenderableNode(node: unknown): node is SplitLayoutNode {
  if (!node || typeof node !== 'object') {
    return false
  }

  const candidate = node as {
    type?: unknown
    id?: unknown
    sessionId?: unknown
    direction?: unknown
    first?: unknown
    second?: unknown
  }
  if (typeof candidate.id !== 'string' || !candidate.id) {
    return false
  }
  if (candidate.type === 'leaf') {
    return typeof candidate.sessionId === 'string' && candidate.sessionId.length > 0
  }
  if (candidate.type === 'branch') {
    const directionValid = candidate.direction === 'horizontal' || candidate.direction === 'vertical'
    return directionValid && isRenderableNode(candidate.first) && isRenderableNode(candidate.second)
  }
  return false
}

const branchFirstNode = computed<SplitLayoutNode | null>(() => {
  if (!delegatedBranchNode.value) {
    return null
  }
  return isRenderableNode(delegatedBranchNode.value.first) ? delegatedBranchNode.value.first : null
})

const branchSecondNode = computed<SplitLayoutNode | null>(() => {
  if (!delegatedBranchNode.value) {
    return null
  }
  return isRenderableNode(delegatedBranchNode.value.second) ? delegatedBranchNode.value.second : null
})

function stopResizeDrag(): void {
  removeDragListeners?.()
  removeDragListeners = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  dragPreviewRatio.value = null
}

function startResizeDrag(event: PointerEvent): void {
  if (props.node.type !== 'branch') {
    return
  }

  const host = branchHostEl.value
  if (!host) {
    return
  }

  event.preventDefault()
  event.stopPropagation()

  const direction = props.node.direction
  let lastEmittedRatio = resolveBranchSplitRatio(props.node)
  dragPreviewRatio.value = lastEmittedRatio
  const dragCursor = direction === 'vertical' ? 'row-resize' : 'col-resize'

  const updateRatioFromPointer = (pointerEvent: PointerEvent, final: boolean): void => {
    const rect = host.getBoundingClientRect()
    const nextRatio = resolvePointerRatio(pointerEvent, rect, direction)
    if (Math.abs(nextRatio - lastEmittedRatio) < DRAG_EPSILON && !final) {
      return
    }
    lastEmittedRatio = nextRatio
    dragPreviewRatio.value = nextRatio

    if (final) {
      emitUpdateBranchRatio({
        branchId: props.node.id,
        splitRatio: nextRatio,
        final: true,
      })
    }
  }

  document.body.style.cursor = dragCursor
  document.body.style.userSelect = 'none'

  const onPointerMove = (pointerEvent: PointerEvent): void => {
    updateRatioFromPointer(pointerEvent, false)
  }

  const onPointerUp = (pointerEvent: PointerEvent): void => {
    updateRatioFromPointer(pointerEvent, true)
    stopResizeDrag()
  }

  const onWindowBlur = (): void => {
    stopResizeDrag()
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
  window.addEventListener('pointercancel', onPointerUp, { once: true })
  window.addEventListener('blur', onWindowBlur, { once: true })

  removeDragListeners = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('blur', onWindowBlur)
  }
}

onBeforeUnmount(() => {
  stopResizeDrag()
})
</script>

<template>
  <section
    v-if="selfHostedLeafNode"
    class="pane-shell"
  >
    <article
      class="pane"
      :class="{
        focused: isLeafFocused(selfHostedLeafNode),
      }"
      @pointerdown.capture="emitFocusPane(selfHostedLeafNode.id)"
      @dragover.capture="handlePaneDragOver($event, selfHostedLeafNode.id)"
      @dragenter.capture="handlePaneDragOver($event, selfHostedLeafNode.id)"
      @dragleave="handlePaneDragLeave($event, selfHostedLeafNode.id)"
      @drop="handlePaneDrop($event, selfHostedLeafNode.id)"
    >
      <header
        class="pane-header"
        draggable="true"
        @dragstart.capture="handlePaneHeaderDragStart($event, selfHostedLeafNode.id)"
        @dragend="handlePaneHeaderDragEnd"
      >
        <span
          class="pane-label"
          :title="resolvePaneLabel(selfHostedSession)"
        >
          <span v-if="isLeafFocused(selfHostedLeafNode)" class="pane-active-dot" />
          {{ resolvePaneLabel(selfHostedSession) }}
        </span>
        <div
          v-if="isFilePaneSession(selfHostedSession)"
          class="pane-source-switcher"
          @pointerdown.stop
          @click.stop
        >
          <select
            class="pane-source-select"
            draggable="false"
            :aria-label="t('terminal.filePane.sourceSelectAria')"
            :value="resolveFilePaneSelectedSourceValue(selfHostedSession, selfHostedLeafNode.sessionId)"
            :disabled="isFilePaneSourceSwitching(selfHostedLeafNode.sessionId)"
            @change="handleFilePaneSourceChange(selfHostedLeafNode.sessionId, $event)"
          >
            <option :value="FILE_PANE_LOCAL_SOURCE_VALUE">
              {{ t('terminal.filePane.sourceLocal') }}
            </option>
            <option
              v-if="serverState.loading.value"
              :value="FILE_PANE_LOADING_SOURCE_VALUE"
              disabled
            >
              {{ t('terminal.filePane.sourceLoadingServers') }}
            </option>
            <option
              v-if="
                resolveFilePaneSelectedSourceValue(selfHostedSession, selfHostedLeafNode.sessionId) ===
                FILE_PANE_REMOTE_UNBOUND_SOURCE_VALUE
              "
              :value="FILE_PANE_REMOTE_UNBOUND_SOURCE_VALUE"
              disabled
            >
              {{ t('terminal.filePane.sourceUnknownRemote') }}
            </option>
            <option
              v-for="server in filePaneServerOptions"
              :key="server.id"
              :value="toServerSourceValue(server.id)"
            >
              {{ formatFilePaneServerLabel(server) }}
            </option>
          </select>
        </div>
        <button
          type="button"
          class="pane-close-btn"
          draggable="false"
          :aria-label="t('terminal.pane.closeAria')"
          :title="t('terminal.pane.closeTitle')"
          @click.stop="requestCloseFocused"
        >
          ×
        </button>
      </header>
      <div class="pane-body">
        <XtermTerminal
          v-if="isTerminalPaneSession(selfHostedSession)"
          :session-id="selfHostedLeafNode.sessionId"
          :drop-indicator-position="dropIndicatorPosition"
        />
        <RemoteFileBrowser
          v-else-if="
            isFilePaneSession(selfHostedSession) &&
            resolveFilePaneSourceKind(selfHostedSession) === 'ssh' &&
            resolveFilePaneSourceSessionId(selfHostedSession)
          "
          :key="`${selfHostedLeafNode.sessionId}-${resolveFilePaneSelectedSourceValue(selfHostedSession, selfHostedLeafNode.sessionId)}`"
          :pane-session-id="selfHostedLeafNode.sessionId"
          :session-id="resolveFilePaneSourceSessionId(selfHostedSession)"
          :initial-path="resolveFilePanePath(selfHostedSession) || '/'"
          :session-cwd="resolveFilePanePath(selfHostedSession)"
          @path-change="handleFilePanePathChange(selfHostedLeafNode.sessionId, $event)"
        />
        <LocalFileBrowser
          v-else-if="isFilePaneSession(selfHostedSession)"
          :pane-session-id="selfHostedLeafNode.sessionId"
          :initial-path="resolveFilePanePath(selfHostedSession)"
          @path-change="handleFilePanePathChange(selfHostedLeafNode.sessionId, $event)"
        />
        <div v-else class="pane-empty">{{ t('terminal.pane.emptyUnavailable') }}</div>
      </div>
    </article>
  </section>

  <section
    v-else-if="delegatedBranchNode && delegatedBranchNode.type === 'branch'"
    ref="branchHostEl"
    class="split-shell"
    :class="{ vertical: delegatedBranchNode.direction === 'vertical' }"
    :style="firstPaneStyle"
  >
    <div class="split-child split-child-first">
      <SplitTreeNode
        v-if="branchFirstNode"
        :key="branchFirstNode.id"
        :node="branchFirstNode"
        :focused-pane-id="props.focusedPaneId"
        :active-session-id="props.activeSessionId"
        :session-map="props.sessionMap"
        @focus-pane="emitFocusPane"
        @update-branch-ratio="emitUpdateBranchRatio"
        @update-file-pane-path="emitUpdateFilePanePath"
        @request-close-focused="requestCloseFocused"
      />
      <div v-else class="pane-invalid">{{ t('terminal.pane.emptyUnavailable') }}</div>
    </div>

    <button
      type="button"
      class="split-divider"
      :aria-label="
        delegatedBranchNode.direction === 'vertical'
          ? t('terminal.pane.resizeHeightAria')
          : t('terminal.pane.resizeWidthAria')
      "
      @pointerdown="startResizeDrag"
    />

    <div class="split-child split-child-second">
      <SplitTreeNode
        v-if="branchSecondNode"
        :key="branchSecondNode.id"
        :node="branchSecondNode"
        :focused-pane-id="props.focusedPaneId"
        :active-session-id="props.activeSessionId"
        :session-map="props.sessionMap"
        @focus-pane="emitFocusPane"
        @update-branch-ratio="emitUpdateBranchRatio"
        @update-file-pane-path="emitUpdateFilePanePath"
        @request-close-focused="requestCloseFocused"
      />
      <div v-else class="pane-invalid">{{ t('terminal.pane.emptyUnavailable') }}</div>
    </div>
  </section>

  <section v-else class="pane-shell">
    <div class="pane-invalid">INVALID NODE</div>
  </section>
</template>

<style scoped lang="scss">
.pane-shell {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.split-shell {
  display: grid;
  grid-template-columns: 50% 4px minmax(0, 1fr);
  flex: 1;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--term-bg, #0b1220);
}

.split-shell.vertical {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: 50% 4px minmax(0, 1fr);
}

.split-child {
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.split-child-first {
  grid-column: 1;
  grid-row: 1;
}

.split-child-second {
  grid-column: 3;
  grid-row: 1;
}

.split-shell.vertical > .split-child-second {
  grid-column: 1;
  grid-row: 3;
}

.split-divider {
  appearance: none;
  border: 0;
  background: #0b1322;
  cursor: col-resize;
  padding: 0;
  margin: 0;
  width: 4px;
  min-width: 4px;
  height: 100%;
  min-height: 100%;
  position: relative;
  grid-column: 2;
  grid-row: 1;
}

.split-divider::before {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
}

.split-divider:hover::before {
  background: #1e2a3f;
}

.split-shell.vertical > .split-divider {
  cursor: row-resize;
  width: 100%;
  min-width: 100%;
  height: 4px;
  min-height: 4px;
  grid-column: 1;
  grid-row: 2;
}

.pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  position: relative;
  border: 0;
}


.pane-header {
  flex: 0 0 31px;
  height: 31px;
  display: flex;
  align-items: center;
  padding: 0 8px;
  border-bottom: 1px solid #1f2a3d;
  background: #0d1728;
}

.pane-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1;
  letter-spacing: 0.02em;
  color: #b2bfd4;
  font-weight: 500;
}

.pane-active-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: #34d399;
  flex: 0 0 auto;
}

.pane-source-switcher {
  flex: 0 0 auto;
  width: min(36vw, 240px);
  margin-left: 8px;
}

.pane-source-select {
  width: 100%;
  height: 22px;
  border-radius: 5px;
  border: 1px solid #334155;
  background: #0f1b2e;
  color: #dbe5f5;
  font-size: 11px;
  line-height: 1;
  padding: 0 8px;
}

.pane-source-select:disabled {
  cursor: wait;
  opacity: 0.72;
}

.pane-close-btn {
  margin-left: 8px;
  width: 18px;
  height: 18px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #8f9db4;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.pane-close-btn:hover {
  color: #e5ebf7;
  background: rgba(148, 163, 184, 0.16);
}

.pane-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.pane.focused .pane-header {
  background: #13203a;
  border-bottom-color: #334968;
}

.pane.focused .pane-label {
  color: #eef3ff;
}

.pane.focused .pane-source-select {
  border-color: #475569;
  color: #eef3ff;
}

.pane-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: #64748b;
  font-size: 12px;
}

.pane-invalid {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  color: #64748b;
  font-size: 12px;
  background: var(--term-bg, #0b1220);
}
</style>
