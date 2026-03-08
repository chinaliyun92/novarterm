<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n } from '../../composables/useI18n'
import { useServerSidebarState } from '../../composables/useServerSidebarState'
import { useTerminalWorkspaceState } from '../../composables/useTerminalWorkspaceState'
import type { ServerRecord } from '../../types/server'
import type { SplitLayoutLeafNode, SplitLayoutNode, TerminalSession } from '../../types/terminal'
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
const selfHostedPaneId = ref<string | null>(null)
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

function resolveSelfHostedLeafNode(node: SplitLayoutNode, paneId: string | null): SplitLayoutLeafNode | null {
  if (node.type === 'leaf') {
    return node
  }

  if (!paneId) {
    return null
  }

  if (node.first.type !== 'leaf') {
    return null
  }

  return node.first.id === paneId ? node.first : null
}

watch(
  () => props.node,
  (nextNode, previousNode) => {
    if (nextNode.type === 'leaf') {
      selfHostedPaneId.value = nextNode.id
      return
    }

    if (
      previousNode?.type === 'leaf' &&
      nextNode.first.type === 'leaf' &&
      nextNode.first.id === previousNode.id
    ) {
      selfHostedPaneId.value = previousNode.id
      return
    }

    const currentPaneId = selfHostedPaneId.value
    if (currentPaneId && nextNode.first.type === 'leaf' && nextNode.first.id === currentPaneId) {
      return
    }

    selfHostedPaneId.value = null
  },
  { immediate: true },
)

const selfHostedLeafNode = computed<SplitLayoutLeafNode | null>(() =>
  resolveSelfHostedLeafNode(props.node, selfHostedPaneId.value),
)

const isSelfHostedBranch = computed<boolean>(() => props.node.type === 'branch' && Boolean(selfHostedLeafNode.value))

const delegatedBranchNode = computed<SplitLayoutNode | null>(() => {
  if (props.node.type !== 'branch') {
    return null
  }

  return selfHostedLeafNode.value ? null : props.node
})

const selfHostedSecondNode = computed<SplitLayoutNode | null>(() => {
  if (!isSelfHostedBranch.value || props.node.type !== 'branch') {
    return null
  }

  return props.node.second
})

const selfHostedSession = computed<TerminalSession | undefined>(() => {
  const leaf = selfHostedLeafNode.value
  if (!leaf) {
    return undefined
  }

  return props.sessionMap[leaf.sessionId]
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
  const basis = `${(ratio * 100).toFixed(2)}%`
  return {
    flex: `0 0 ${basis}`,
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
    ref="branchHostEl"
    class="split-shell"
    :class="{ vertical: props.node.type === 'branch' && props.node.direction === 'vertical' }"
  >
    <div class="split-child" :class="{ 'split-child-first': isSelfHostedBranch }" :style="isSelfHostedBranch ? firstPaneStyle : undefined">
      <article
        class="pane"
        :class="{ focused: isLeafFocused(selfHostedLeafNode) }"
        @pointerdown.capture="emitFocusPane(selfHostedLeafNode.id)"
      >
        <header class="pane-header">
          <span class="pane-label" :title="resolvePaneLabel(selfHostedSession)">
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
          />
          <RemoteFileBrowser
            v-else-if="
              isFilePaneSession(selfHostedSession) &&
              resolveFilePaneSourceKind(selfHostedSession) === 'ssh' &&
              resolveFilePaneSourceSessionId(selfHostedSession)
            "
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
    </div>

    <template v-if="isSelfHostedBranch && selfHostedSecondNode && props.node.type === 'branch'">
      <button
        type="button"
        class="split-divider"
        :aria-label="props.node.direction === 'vertical' ? t('terminal.pane.resizeHeightAria') : t('terminal.pane.resizeWidthAria')"
        @pointerdown="startResizeDrag"
      />

      <div class="split-child split-child-second">
        <SplitTreeNode
          :key="selfHostedSecondNode.id"
          :node="selfHostedSecondNode"
          :focused-pane-id="props.focusedPaneId"
          :active-session-id="props.activeSessionId"
          :session-map="props.sessionMap"
          @focus-pane="emitFocusPane"
          @update-branch-ratio="emitUpdateBranchRatio"
          @update-file-pane-path="emitUpdateFilePanePath"
          @request-close-focused="requestCloseFocused"
        />
      </div>
    </template>
  </section>

  <section
    v-else-if="delegatedBranchNode && delegatedBranchNode.type === 'branch'"
    ref="branchHostEl"
    class="split-shell"
    :class="{ vertical: delegatedBranchNode.direction === 'vertical' }"
  >
    <div class="split-child split-child-first" :style="firstPaneStyle">
      <SplitTreeNode
        :key="delegatedBranchNode.first.id"
        :node="delegatedBranchNode.first"
        :focused-pane-id="props.focusedPaneId"
        :active-session-id="props.activeSessionId"
        :session-map="props.sessionMap"
        @focus-pane="emitFocusPane"
        @update-branch-ratio="emitUpdateBranchRatio"
        @update-file-pane-path="emitUpdateFilePanePath"
        @request-close-focused="requestCloseFocused"
      />
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
        :key="delegatedBranchNode.second.id"
        :node="delegatedBranchNode.second"
        :focused-pane-id="props.focusedPaneId"
        :active-session-id="props.activeSessionId"
        :session-map="props.sessionMap"
        @focus-pane="emitFocusPane"
        @update-branch-ratio="emitUpdateBranchRatio"
        @update-file-pane-path="emitUpdateFilePanePath"
        @request-close-focused="requestCloseFocused"
      />
    </div>
  </section>
</template>

<style scoped lang="scss">
.split-shell {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--term-bg, #0b1220);
  align-items: stretch;
}

.split-shell.vertical {
  flex-direction: column;
}

.split-child {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.split-child-first {
  flex: 0 0 50%;
}

.split-divider {
  appearance: none;
  border: 0;
  background: #0b1322;
  cursor: col-resize;
  padding: 0;
  margin: 0;
  flex: 0 0 4px;
  width: 4px;
  min-width: 4px;
  position: relative;
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

.split-shell.vertical .split-divider {
  cursor: row-resize;
  width: 100%;
  min-width: 100%;
  height: 4px;
  min-height: 4px;
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
  min-height: 0;
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
</style>
