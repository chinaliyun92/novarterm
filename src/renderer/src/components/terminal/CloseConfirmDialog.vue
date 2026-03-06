<script setup lang="ts">
const props = defineProps<{
  open: boolean
  sessionTitle: string
}>()

const emit = defineEmits<{
  (event: 'cancel'): void
  (event: 'confirm'): void
}>()
</script>

<template>
  <div v-if="props.open" class="overlay" role="dialog" aria-modal="true">
    <div class="dialog">
      <h3>Close Session</h3>
      <p>
        <strong>{{ props.sessionTitle }}</strong>
        has pending input. Close anyway?
      </p>
      <div class="actions">
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="button" class="danger" @click="emit('confirm')">Close</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.24);
  display: grid;
  place-items: center;
  z-index: 30;
}

.dialog {
  width: min(400px, calc(100% - 32px));
  border-radius: 10px;
  border: 1px solid #d7e0eb;
  background: #ffffff;
  color: #0f172a;
  padding: 16px;
}

.dialog h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.dialog p {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
}

.actions {
  margin-top: 14px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.actions button {
  height: 30px;
  border-radius: 6px;
  border: 1px solid #cbd5e1;
  padding: 0 12px;
  cursor: pointer;
  background: #ffffff;
  color: #334155;
}

.actions .danger {
  border-color: #ef4444;
  background: #fff1f2;
  color: #be123c;
}
</style>
