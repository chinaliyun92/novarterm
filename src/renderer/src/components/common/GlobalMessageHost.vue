<script setup lang="ts">
import { useGlobalMessage } from '../../composables/useGlobalMessage'

const globalMessage = useGlobalMessage()
</script>

<template>
  <Teleport to="body">
    <div v-if="globalMessage.items.value.length > 0" class="global-message-host" aria-live="polite">
      <TransitionGroup name="global-message-fade" tag="div" class="global-message-list">
        <div
          v-for="item in globalMessage.items.value"
          :key="item.id"
          class="global-message-item"
          :class="`is-${item.level}`"
        >
          {{ item.text }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.global-message-host {
  position: fixed;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 3000;
  pointer-events: none;
}

.global-message-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.global-message-item {
  max-width: min(78vw, 680px);
  padding: 9px 14px;
  border-radius: 10px;
  font-size: 13px;
  line-height: 1.4;
  color: #0f172a;
  background: #e2e8f0;
  border: 1px solid #cbd5e1;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
  white-space: pre-wrap;
  text-align: center;
}

.global-message-item.is-success {
  color: #064e3b;
  background: #d1fae5;
  border-color: #86efac;
}

.global-message-item.is-error {
  color: #7f1d1d;
  background: #fee2e2;
  border-color: #fca5a5;
}

.global-message-fade-enter-active,
.global-message-fade-leave-active {
  transition: all 0.18s ease;
}

.global-message-fade-enter-from,
.global-message-fade-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>

