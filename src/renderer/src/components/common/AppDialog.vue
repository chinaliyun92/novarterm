<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { useI18n } from '../../composables/useI18n'

const i18n = useI18n()

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    confirmText?: string
    cancelText?: string
    confirmDisabled?: boolean
    loading?: boolean
  }>(),
  {
    confirmText: '',
    cancelText: '',
    confirmDisabled: false,
    loading: false,
  },
)

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'confirm'): void
}>()

const cancelButtonText = computed(() => props.cancelText || t('settings.cancel'))
const confirmButtonText = computed(() => props.confirmText || t('common.confirm'))
const processingText = computed(() => t('common.processing'))

function onEscape(event: KeyboardEvent): void {
  if (!props.open) {
    return
  }
  if (event.key === 'Escape') {
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onEscape)
      return
    }
    document.removeEventListener('keydown', onEscape)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEscape)
})

function handleMaskClick(): void {
  if (props.loading) {
    return
  }
  emit('close')
}

function handleConfirm(): void {
  if (props.loading || props.confirmDisabled) {
    return
  }
  emit('confirm')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="app-dialog-mask" @click.self="handleMaskClick">
      <section class="app-dialog" role="dialog" aria-modal="true">
        <header class="app-dialog-header">
          <h3>{{ props.title }}</h3>
          <button type="button" class="dialog-close" :disabled="props.loading" @click="emit('close')">×</button>
        </header>

        <div class="app-dialog-body">
          <slot />
        </div>

        <footer class="app-dialog-footer">
          <button type="button" class="btn-secondary" :disabled="props.loading" @click="emit('close')">
            {{ cancelButtonText }}
          </button>
          <button
            type="button"
            class="btn-primary"
            :disabled="props.loading || props.confirmDisabled"
            @click="handleConfirm"
          >
            {{ props.loading ? processingText : confirmButtonText }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.app-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.28);
}

.app-dialog {
  width: min(640px, calc(100vw - 32px));
  max-height: min(90vh, 760px);
  overflow: auto;
  border: 1px solid #d7e0eb;
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.2);
}

.app-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
}

.app-dialog-header h3 {
  margin: 0;
  font-size: 15px;
  color: #0f172a;
}

.dialog-close {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #334155;
  width: 28px;
  height: 28px;
  cursor: pointer;
}

.app-dialog-body {
  padding: 14px;
}

.app-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px;
  border-top: 1px solid #e2e8f0;
}

.btn-secondary,
.btn-primary {
  border-radius: 8px;
  height: 32px;
  padding: 0 14px;
  cursor: pointer;
}

.btn-secondary {
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
}

.btn-primary {
  border: 1px solid #2563eb;
  background: #1d4ed8;
  color: #eff6ff;
}

.btn-secondary:disabled,
.btn-primary:disabled,
.dialog-close:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
