<script setup lang="ts">
import { computed } from 'vue'
import { useTerminalWorkspaceState } from '../../composables/useTerminalWorkspaceState'
import CloseConfirmDialog from './CloseConfirmDialog.vue'
import SessionTabs from './SessionTabs.vue'
import SplitTerminalContainer from './SplitTerminalContainer.vue'

const workspace = useTerminalWorkspaceState()

const closeTarget = computed(() => {
  const tabId = workspace.closeConfirm.sessionId
  if (!tabId) {
    return null
  }
  return workspace.tabSessions.value.find((item) => item.id === tabId) ?? null
})

function createSession(): void {
  workspace.createSession({ activate: true })
}

function switchSession(sessionId: string): void {
  workspace.switchSession(sessionId)
}

function reorderSessionTabs(payload: {
  fromSessionId: string
  toSessionId: string
  position: 'before' | 'after'
}): void {
  workspace.reorderSessions(payload)
}

function requestClose(sessionId: string): void {
  workspace.requestCloseSession(sessionId)
}

function focusPane(paneId: string): void {
  workspace.focusPane(paneId)
}

function updateBranchRatio(payload: { branchId: string; splitRatio: number; final: boolean }): void {
  workspace.setBranchSplitRatio(payload.branchId, payload.splitRatio, {
    transient: !payload.final,
  })
}

function updateFilePanePath(payload: { sessionId: string; path: string }): void {
  workspace.updateSession(payload.sessionId, {
    filePanePath: payload.path,
  })
}

function closeCurrentWorkspaceByAction(): void {
  const closedPane = workspace.closeFocusedPane()
  if (closedPane) {
    return
  }

  const activeTabId = workspace.activeTabSessionId.value
  if (!activeTabId) {
    return
  }

  workspace.requestCloseSession(activeTabId)
}
</script>

<template>
  <section class="terminal-workspace">
    <SessionTabs
      v-if="workspace.tabSessions.value.length > 1"
      :sessions="workspace.tabSessions.value"
      :active-session-id="workspace.activeTabSessionId.value"
      :can-create="workspace.canCreateMoreTabs.value"
      @create="createSession"
      @switch="switchSession"
      @reorder="reorderSessionTabs"
      @request-close="requestClose"
    />

    <SplitTerminalContainer
      v-for="tab in workspace.tabSessions.value"
      :key="tab.id"
      v-show="workspace.activeTabSessionId.value === tab.id"
      :layout-root="tab.split.root"
      :focused-pane-id="tab.split.focusedPaneId"
      :active-session-id="workspace.activeTabSessionId.value === tab.id ? workspace.activeSessionId.value : null"
      :sessions="workspace.sessions.value.filter((item) => item.tabId === tab.id)"
      @focus-pane="focusPane"
      @update-branch-ratio="updateBranchRatio"
      @update-file-pane-path="updateFilePanePath"
      @request-close-focused="closeCurrentWorkspaceByAction"
    />

    <CloseConfirmDialog
      :open="workspace.closeConfirm.open"
      :session-title="closeTarget?.title ?? 'Unknown session'"
      @cancel="workspace.cancelCloseSession"
      @confirm="workspace.confirmCloseSession"
    />
  </section>
</template>

<style scoped>
.terminal-workspace {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
  min-height: 0;
  background: var(--term-bg, #0b1220);
}
</style>
