<script setup lang="ts">
import { computed } from 'vue'
import type { SplitLayoutNode, TerminalSession } from '../../types/terminal'
import SplitTreeNode from './SplitTreeNode.vue'

const props = defineProps<{
  layoutRoot: SplitLayoutNode | null
  focusedPaneId: string | null
  activeSessionId: string | null
  sessions: TerminalSession[]
}>()

const emit = defineEmits<{
  (event: 'focus-pane', paneId: string): void
  (event: 'update-branch-ratio', payload: { branchId: string; splitRatio: number; final: boolean }): void
  (event: 'update-file-pane-path', payload: { sessionId: string; path: string }): void
  (event: 'request-close-focused'): void
}>()

const sessionMap = computed<Record<string, TerminalSession>>(() => {
  return props.sessions.reduce<Record<string, TerminalSession>>((acc, session) => {
    acc[session.id] = session
    return acc
  }, {})
})

function focusPane(paneId: string): void {
  emit('focus-pane', paneId)
}

function updateBranchRatio(payload: { branchId: string; splitRatio: number; final: boolean }): void {
  emit('update-branch-ratio', payload)
}

function updateFilePanePath(payload: { sessionId: string; path: string }): void {
  emit('update-file-pane-path', payload)
}

function requestCloseFocused(): void {
  emit('request-close-focused')
}
</script>

<template>
  <section class="split-root">
    <SplitTreeNode
      v-if="props.layoutRoot"
      :node="props.layoutRoot"
      :focused-pane-id="props.focusedPaneId"
      :active-session-id="props.activeSessionId"
      :session-map="sessionMap"
      @focus-pane="focusPane"
      @update-branch-ratio="updateBranchRatio"
      @update-file-pane-path="updateFilePanePath"
      @request-close-focused="requestCloseFocused"
    />
    <div v-else class="pane-empty">No session available.</div>
  </section>
</template>

<style scoped lang="scss">
.split-root {
  display: flex;
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--term-bg, #0b1220);
}

.pane-empty {
  height: 100%;
  width: 100%;
  display: grid;
  place-items: center;
  color: #64748b;
  font-size: 12px;
}
</style>
