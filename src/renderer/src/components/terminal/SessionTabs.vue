<script setup lang="ts">
import { ref } from 'vue'
import type { TerminalWorkspaceTab } from '../../types/terminal'

const props = defineProps<{
  sessions: TerminalWorkspaceTab[]
  activeSessionId: string | null
  canCreate: boolean
}>()

const emit = defineEmits<{
  (event: 'switch', sessionId: string): void
  (event: 'create'): void
  (event: 'request-close', sessionId: string): void
  (
    event: 'reorder',
    payload: { fromSessionId: string; toSessionId: string; position: 'before' | 'after' }
  ): void
}>()

const draggingSessionId = ref<string | null>(null)
const dragOverSessionId = ref<string | null>(null)
const dragOverPosition = ref<'before' | 'after' | null>(null)

function handleSwitch(sessionId: string): void {
  emit('switch', sessionId)
}

function requestClose(sessionId: string): void {
  emit('request-close', sessionId)
}

function clearDragState(): void {
  draggingSessionId.value = null
  dragOverSessionId.value = null
  dragOverPosition.value = null
}

function resolveDropPosition(event: DragEvent): 'before' | 'after' {
  const element = event.currentTarget as HTMLElement | null
  if (!element) {
    return 'after'
  }

  const rect = element.getBoundingClientRect()
  const midpoint = rect.left + rect.width / 2
  const pointX = event.clientX
  return pointX < midpoint ? 'before' : 'after'
}

function handleDragStart(event: DragEvent, sessionId: string): void {
  draggingSessionId.value = sessionId
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', sessionId)
  }
}

function handleDragOver(event: DragEvent, sessionId: string): void {
  if (!draggingSessionId.value || draggingSessionId.value === sessionId) {
    return
  }

  event.preventDefault()
  dragOverSessionId.value = sessionId
  dragOverPosition.value = resolveDropPosition(event)
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function handleDragLeave(sessionId: string): void {
  if (dragOverSessionId.value === sessionId) {
    dragOverSessionId.value = null
    dragOverPosition.value = null
  }
}

function handleDrop(event: DragEvent, sessionId: string): void {
  event.preventDefault()
  const fromSessionId = draggingSessionId.value
  const position = resolveDropPosition(event)
  clearDragState()

  if (!fromSessionId || fromSessionId === sessionId) {
    return
  }

  emit('reorder', {
    fromSessionId,
    toSessionId: sessionId,
    position,
  })
}
</script>

<template>
  <div class="session-tabs">
    <div class="tab-list">
      <div
        v-for="(session, index) in props.sessions"
        :key="session.id"
        class="tab-item"
        :class="{
          active: props.activeSessionId === session.id,
          'drag-over-before': dragOverSessionId === session.id && dragOverPosition === 'before',
          'drag-over-after': dragOverSessionId === session.id && dragOverPosition === 'after',
          dragging: draggingSessionId === session.id,
        }"
        draggable="true"
        @click="handleSwitch(session.id)"
        @dragstart="handleDragStart($event, session.id)"
        @dragover="handleDragOver($event, session.id)"
        @dragleave="handleDragLeave(session.id)"
        @drop="handleDrop($event, session.id)"
        @dragend="clearDragState"
      >
        <button class="tab-title" type="button">{{ `T ${index + 1}` }}</button>

        <button class="tab-close" type="button" aria-label="Close tab" @click.stop="requestClose(session.id)">
          ×
        </button>
      </div>

      <button
        class="create-btn"
        type="button"
        :disabled="!props.canCreate"
        :title="props.canCreate ? '新建标签' : '最多 6 个标签页'"
        @click="emit('create')"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.session-tabs {
  display: flex;
  align-items: center;
  min-height: 40px;
  padding: 5px 10px;
  border-bottom: 1px solid #c5c9d1;
  background: #e7e9ee;
}

.tab-list {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 1px 0;
  scrollbar-width: none;
}

.tab-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.create-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid #c5cad4;
  background: #f8f9fb;
  color: #4d5664;
  border-radius: 999px;
  padding: 0;
  font-size: 18px;
  line-height: 1;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}

.create-btn:hover {
  background: #ffffff;
  border-color: #b7becb;
  color: #2d3440;
  box-shadow: 0 1px 1px rgba(17, 24, 39, 0.08);
}

.create-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}

.tab-item {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  min-width: 170px;
  max-width: 260px;
  padding: 0 12px;
  border: 1px solid #bcc4d0;
  border-radius: 999px;
  background: #d5d9e1;
  color: #4a5361;
  margin: 0;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.tab-item.dragging {
  opacity: 0.55;
}

.tab-item.active {
  color: #1f2732;
  border-color: #cfd5de;
  background: #f8f9fb;
  box-shadow: 0 1px 0 rgba(17, 24, 39, 0.08);
}

.tab-item:not(.active):hover {
  background: #e1e5ec;
  color: #353e4b;
  border-color: #c4cbd7;
}

.tab-item.drag-over-before::before,
.tab-item.drag-over-after::after {
  content: '';
  position: absolute;
  top: 3px;
  bottom: 3px;
  width: 2px;
  border-radius: 2px;
  background: #60a5fa;
}

.tab-item.drag-over-before::before {
  left: -5px;
}

.tab-item.drag-over-after::after {
  right: -5px;
}

.tab-title {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  text-align: center;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tab-close {
  border: 0;
  background: transparent;
  color: inherit;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  cursor: pointer;
  opacity: 0.78;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  transition: opacity 0.12s ease, background 0.12s ease;
}

.tab-close:hover {
  opacity: 1;
  background: rgba(71, 85, 105, 0.16);
}
</style>
