<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useAppUiSettings } from '../../composables/useAppUiSettings'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n, type AppLanguage } from '../../composables/useI18n'
import { useServerSidebarState } from '../../composables/useServerSidebarState'
import { useTerminalTriggers } from '../../composables/useTerminalTriggers'
import type { CreateServerInput, ServerRecord } from '../../types/server'
import AppDialog from '../common/AppDialog.vue'

type SettingsTab = 'general' | 'servers' | 'triggers'
type ServerEditorMode = 'create' | 'edit' | null

const props = defineProps<{
  open: boolean
  initialTab?: SettingsTab
}>()

const emit = defineEmits<{
  (event: 'close'): void
}>()

const serverState = useServerSidebarState()
const triggerState = useTerminalTriggers()
const uiSettings = useAppUiSettings()
const globalMessage = useGlobalMessage()
const i18n = useI18n()
const availableLanguages = computed<AppLanguage[]>(() => i18n.availableLanguages.value)
const currentLanguage = computed<AppLanguage>(() => i18n.locale.value)

const GENERAL_FONT_SIZE_MIN = 11
const GENERAL_FONT_SIZE_MAX = 20
const GENERAL_LINE_HEIGHT_MIN = 1.1
const GENERAL_LINE_HEIGHT_MAX = 2
const generalFontSizeDraft = ref<string>('')
const generalLineHeightDraft = ref<string>('')

const activeTab = ref<SettingsTab>('general')
const serverEditorMode = ref<ServerEditorMode>(null)
const editingServerId = ref<number | null>(null)
const serverSubmitting = ref(false)
const serverError = ref<string | null>(null)

const serverForm = reactive({
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
})

const serversSorted = computed(() => {
  return [...serverState.servers.value].sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    if (byName !== 0) {
      return byName
    }
    const byHost = left.host.localeCompare(right.host)
    if (byHost !== 0) {
      return byHost
    }
    return left.username.localeCompare(right.username)
  })
})

const shortcutRows = computed(() => [
  {
    id: 'open-settings',
    keys: 'Command + ,',
    action: t('settings.shortcut.action.openSettings'),
    scope: t('settings.shortcut.scope.global'),
  },
  {
    id: 'close-pane-tab',
    keys: 'Command + W',
    action: t('settings.shortcut.action.closePaneOrTab'),
    scope: t('settings.shortcut.scope.global'),
  },
  {
    id: 'new-tab',
    keys: 'Command + T',
    action: t('settings.shortcut.action.newTab'),
    scope: t('settings.shortcut.scope.global'),
  },
  {
    id: 'switch-tab',
    keys: 'Command + 1-9',
    action: t('settings.shortcut.action.switchTab'),
    scope: t('settings.shortcut.scope.global'),
  },
  {
    id: 'file-parent',
    keys: 'Backspace / Delete',
    action: t('settings.shortcut.action.navigateFileParent'),
    scope: t('settings.shortcut.scope.filePane'),
  },
  {
    id: 'terminal-zoom',
    keys: 'Command/Ctrl + Mouse Wheel',
    action: t('settings.shortcut.action.zoomTerminalFont'),
    scope: t('settings.shortcut.scope.terminal'),
  },
])

const serverSubmitDisabled = computed(() => {
  if (serverSubmitting.value) {
    return true
  }

  const port = Number.parseInt(serverForm.port.trim(), 10)
  if (
    !serverForm.name.trim() ||
    !serverForm.host.trim() ||
    !serverForm.username.trim() ||
    !serverForm.password.trim() ||
    !Number.isFinite(port) ||
    port <= 0
  ) {
    return true
  }

  return false
})

const serverEditorDialogOpen = computed(() => serverEditorMode.value !== null)
const serverEditorDialogTitle = computed(() =>
  serverEditorMode.value === 'edit' ? t('settings.server.editTitle') : t('settings.server.createTitle'),
)
const serverEditorDialogConfirmText = computed(() =>
  serverEditorMode.value === 'edit' ? t('settings.server.editConfirm') : t('settings.server.createConfirm'),
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    void serverState.ensureLoaded()
    activeTab.value = props.initialTab ?? 'general'
    generalFontSizeDraft.value = String(uiSettings.fontSize.value)
    generalLineHeightDraft.value = String(uiSettings.lineHeight.value)
    cancelServerEditor()
  },
)

watch(
  () => props.initialTab,
  (tab) => {
    if (!props.open || !tab) {
      return
    }
    activeTab.value = tab
  },
)

watch(
  () => uiSettings.fontSize.value,
  (value) => {
    if (!props.open) {
      return
    }
    generalFontSizeDraft.value = String(value)
  },
  { immediate: true },
)

watch(
  () => uiSettings.lineHeight.value,
  (value) => {
    if (!props.open) {
      return
    }
    generalLineHeightDraft.value = String(value)
  },
  { immediate: true },
)

function onEscape(event: KeyboardEvent): void {
  if (!props.open) {
    return
  }
  if (serverEditorDialogOpen.value) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onEscape, true)
      return
    }
    document.removeEventListener('keydown', onEscape, true)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onEscape, true)
})

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return fallback
}

function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params)
}

function onLanguageChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  if (value !== 'en' && value !== 'zh-CN') {
    return
  }
  void i18n.setLanguage(value as AppLanguage)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function onFontSizeInput(event: Event): void {
  generalFontSizeDraft.value = (event.target as HTMLInputElement).value
}

function onLineHeightInput(event: Event): void {
  generalLineHeightDraft.value = (event.target as HTMLInputElement).value
}

function onFontSizeBlur(): void {
  const value = Number.parseFloat(generalFontSizeDraft.value)
  if (!Number.isFinite(value)) {
    generalFontSizeDraft.value = String(uiSettings.fontSize.value)
    return
  }
  const normalized = Math.round(clamp(value, GENERAL_FONT_SIZE_MIN, GENERAL_FONT_SIZE_MAX))
  uiSettings.fontSize.value = normalized
  generalFontSizeDraft.value = String(normalized)
}

function onLineHeightBlur(): void {
  const value = Number.parseFloat(generalLineHeightDraft.value)
  if (!Number.isFinite(value)) {
    generalLineHeightDraft.value = String(uiSettings.lineHeight.value)
    return
  }
  const normalized = clamp(value, GENERAL_LINE_HEIGHT_MIN, GENERAL_LINE_HEIGHT_MAX)
  const rounded = Math.round(normalized * 100) / 100
  uiSettings.lineHeight.value = rounded
  generalLineHeightDraft.value = String(rounded)
}

function switchTab(tab: SettingsTab): void {
  activeTab.value = tab
}

function openCreateServerEditor(): void {
  serverEditorMode.value = 'create'
  editingServerId.value = null
  serverSubmitting.value = false
  serverError.value = null
  serverForm.name = ''
  serverForm.host = ''
  serverForm.port = '22'
  serverForm.username = ''
  serverForm.password = ''
}

function openEditServerEditor(server: ServerRecord): void {
  serverEditorMode.value = 'edit'
  editingServerId.value = server.id
  serverSubmitting.value = false
  serverError.value = null
  serverForm.name = server.name
  serverForm.host = server.host
  serverForm.port = String(server.port)
  serverForm.username = server.username
  serverForm.password = server.password ?? ''
}

function cancelServerEditor(): void {
  serverEditorMode.value = null
  editingServerId.value = null
  serverSubmitting.value = false
  serverError.value = null
}

async function submitServerEditor(): Promise<void> {
  if (!serverEditorMode.value) {
    return
  }

  serverError.value = null
  serverSubmitting.value = true

  try {
    const port = Number.parseInt(serverForm.port.trim(), 10)
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error(t('settings.server.error.portInvalid'))
    }

    const payload: CreateServerInput = {
      groupId: null,
      name: serverForm.name.trim(),
      host: serverForm.host.trim(),
      port,
      username: serverForm.username.trim(),
      authType: 'password',
      password: serverForm.password,
      privateKeyPath: null,
      passphrase: null,
    }

    if (!payload.name) {
      throw new Error(t('settings.server.error.nameRequired'))
    }
    if (!payload.host) {
      throw new Error(t('settings.server.error.hostRequired'))
    }
    if (!payload.username) {
      throw new Error(t('settings.server.error.usernameRequired'))
    }
    if (!payload.password?.trim()) {
      throw new Error(t('settings.server.error.passwordRequired'))
    }
    if (serverEditorMode.value === 'edit') {
      const serverId = editingServerId.value
      if (!serverId) {
        throw new Error(t('settings.server.error.missingEditId'))
      }
      await serverState.updateServer(serverId, payload)
    } else {
      await serverState.createServer(payload)
    }

    cancelServerEditor()
  } catch (error) {
    const fallback =
      serverEditorMode.value === 'edit'
        ? t('settings.server.error.updateFailed')
        : t('settings.server.error.createFailed')
    serverError.value = getErrorMessage(error, fallback)
  } finally {
    serverSubmitting.value = false
  }
}

async function removeServer(server: ServerRecord): Promise<void> {
  const confirmed = window.confirm(t('settings.server.deleteConfirm', { name: server.name }))
  if (!confirmed) {
    return
  }

  try {
    await serverState.deleteServer(server.id)
    if (editingServerId.value === server.id) {
      cancelServerEditor()
    }
  } catch (error) {
    globalMessage.error(getErrorMessage(error, t('settings.server.error.deleteFailed')), {
      replace: true,
    })
  }
}

function addTriggerRow(): void {
  triggerState.addRule({
    pattern: '',
    sendText: '',
    enabled: true,
  })
}

function removeTriggerRow(ruleId: string): void {
  triggerState.removeRule(ruleId)
}

function updateTriggerPattern(ruleId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  triggerState.updateRule(ruleId, {
    pattern: value,
  })
}

function updateTriggerSendText(ruleId: string, event: Event): void {
  const value = (event.target as HTMLInputElement).value
  triggerState.updateRule(ruleId, {
    sendText: value,
  })
}

function toggleTrigger(ruleId: string, enabled: boolean): void {
  triggerState.updateRule(ruleId, {
    enabled,
  })
}

function updateTriggerEnabled(ruleId: string, event: Event): void {
  const enabled = (event.target as HTMLInputElement).checked
  toggleTrigger(ruleId, enabled)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="props.open" class="global-settings-mask" @click.self="emit('close')">
      <section class="global-settings-dialog" role="dialog" aria-modal="true">
        <header class="global-settings-dialog__header">
          <h3>{{ t('settings.title') }}</h3>
          <button
            type="button"
            class="global-settings-dialog__close-btn"
            :aria-label="t('settings.close')"
            @click="emit('close')"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.3 3.3a1 1 0 0 1 1.4 0L8 6.6l3.3-3.3a1 1 0 1 1 1.4 1.4L9.4 8l3.3 3.3a1 1 0 1 1-1.4 1.4L8 9.4l-3.3 3.3a1 1 0 1 1-1.4-1.4L6.6 8 3.3 4.7a1 1 0 0 1 0-1.4Z" />
            </svg>
          </button>
        </header>

        <nav class="global-settings-tabs" role="tablist" :aria-label="t('settings.tabsAria')">
          <button
            type="button"
            role="tab"
            class="global-settings-tabs__item"
            :class="{ active: activeTab === 'general' }"
            :aria-selected="activeTab === 'general'"
            @click="switchTab('general')"
          >
            {{ t('settings.tab.general') }}
          </button>
          <button
            type="button"
            role="tab"
            class="global-settings-tabs__item"
            :class="{ active: activeTab === 'servers' }"
            :aria-selected="activeTab === 'servers'"
            @click="switchTab('servers')"
          >
            {{ t('settings.tab.servers') }}
          </button>
          <button
            type="button"
            role="tab"
            class="global-settings-tabs__item"
            :class="{ active: activeTab === 'triggers' }"
            :aria-selected="activeTab === 'triggers'"
            @click="switchTab('triggers')"
          >
            {{ t('settings.tab.triggers') }}
          </button>
        </nav>

        <div class="global-settings-dialog__body">
          <section v-if="activeTab === 'general'" class="tab-pane general-tab">
            <label class="general-field">
              <span class="general-field__label">{{ t('settings.general.language') }}</span>
              <select class="general-field__control" :value="currentLanguage" @change="onLanguageChange">
                <option v-for="lang in availableLanguages" :key="lang" :value="lang">
                  {{ lang === 'zh-CN' ? t('settings.language.chinese') : t('settings.language.english') }}
                </option>
              </select>
            </label>
            <label class="general-field">
              <span class="general-field__label">{{ t('settings.general.fontSize') }}</span>
              <input
                class="general-field__control"
                type="number"
                :min="GENERAL_FONT_SIZE_MIN"
                :max="GENERAL_FONT_SIZE_MAX"
                step="1"
                :value="generalFontSizeDraft"
                @input="onFontSizeInput"
                @blur="onFontSizeBlur"
              />
            </label>
            <label class="general-field">
              <span class="general-field__label">{{ t('settings.general.lineHeight') }}</span>
              <input
                class="general-field__control"
                type="number"
                :min="GENERAL_LINE_HEIGHT_MIN"
                :max="GENERAL_LINE_HEIGHT_MAX"
                step="0.05"
                :value="generalLineHeightDraft"
                @input="onLineHeightInput"
                @blur="onLineHeightBlur"
              />
            </label>
            <div class="general-shortcuts">
              <div class="shortcut-table">
                <header class="shortcut-table__head">
                  <span class="shortcut-table__keys">{{ t('settings.shortcut.field.keys') }}</span>
                  <span class="shortcut-table__action">{{ t('settings.shortcut.field.action') }}</span>
                </header>
                <div class="shortcut-list">
                  <article v-for="item in shortcutRows" :key="item.id" class="shortcut-row">
                    <strong class="shortcut-row__keys">{{ item.keys }}</strong>
                    <span class="shortcut-row__action">{{ item.action }}</span>
                  </article>
                </div>
              </div>
            </div>
          </section>

          <section v-else-if="activeTab === 'servers'" class="tab-pane server-tab">
            <div class="server-tab__toolbar">
              <button type="button" @click="openCreateServerEditor">{{ t('settings.server.add') }}</button>
              <span class="server-tab__hint">{{ t('settings.server.localStorageHint') }}</span>
            </div>

            <div class="server-table">
              <header class="server-table__head">
                <span class="server-table__name">{{ t('settings.server.field.name') }}</span>
                <span class="server-table__endpoint">{{ t('settings.server.field.host') }}</span>
                <span class="server-table__actions">Control</span>
              </header>

              <div class="server-list">
                <p v-if="serverState.loading.value" class="empty-tip">{{ t('settings.server.loading') }}</p>
                <p v-else-if="serversSorted.length === 0" class="empty-tip">{{ t('settings.server.empty') }}</p>
                <article v-for="server in serversSorted" :key="server.id" class="server-row">
                  <strong class="server-row__name" :title="server.name">{{ server.name }}</strong>
                  <span class="server-row__endpoint" :title="`${server.username}@${server.host}`">
                    {{ server.username }}@{{ server.host }}
                  </span>
                  <div class="server-row__actions">
                    <button
                      type="button"
                      class="server-row__action-btn server-row__action-btn--edit"
                      @click="openEditServerEditor(server)"
                    >
                      {{ t('settings.server.edit') }}
                    </button>
                    <button
                      type="button"
                      class="server-row__action-btn server-row__action-btn--delete"
                      @click="void removeServer(server)"
                    >
                      {{ t('settings.server.delete') }}
                    </button>
                  </div>
                </article>
              </div>
            </div>
          </section>

          <section v-else class="tab-pane trigger-tab">
            <div class="trigger-tab__toolbar">
              <button type="button" @click="addTriggerRow">{{ t('settings.trigger.add') }}</button>
            </div>
            <div v-if="triggerState.rules.value.length === 0" class="empty-tip">{{ t('settings.trigger.empty') }}</div>
            <div v-else class="trigger-list">
              <article v-for="rule in triggerState.rules.value" :key="rule.id" class="trigger-row">
                <input
                  :value="rule.pattern"
                  type="text"
                  :placeholder="t('settings.trigger.patternPlaceholder')"
                  @input="updateTriggerPattern(rule.id, $event)"
                />
                <input
                  :value="rule.sendText"
                  type="text"
                  :placeholder="t('settings.trigger.sendPlaceholder')"
                  @input="updateTriggerSendText(rule.id, $event)"
                />
                <label class="trigger-enable">
                  <input type="checkbox" :checked="rule.enabled" @change="updateTriggerEnabled(rule.id, $event)" />
                  <span>{{ t('settings.trigger.enabled') }}</span>
                </label>
                <button type="button" class="danger" @click="removeTriggerRow(rule.id)">
                  {{ t('settings.trigger.delete') }}
                </button>
              </article>
            </div>
          </section>
        </div>

        <AppDialog
          :open="serverEditorDialogOpen"
          :title="serverEditorDialogTitle"
          :confirm-text="serverEditorDialogConfirmText"
          :cancel-text="t('settings.cancel')"
          :confirm-disabled="serverSubmitDisabled"
          :loading="serverSubmitting"
          @close="cancelServerEditor"
          @confirm="submitServerEditor"
        >
          <form class="server-editor-form" @submit.prevent="void submitServerEditor()">
            <label>
              <span>
                {{ t('settings.server.field.name') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="serverForm.name" type="text" />
            </label>
            <label>
              <span>
                {{ t('settings.server.field.host') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="serverForm.host" type="text" />
            </label>
            <label>
              <span>
                {{ t('settings.server.field.port') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="serverForm.port" type="number" min="1" />
            </label>
            <label>
              <span>
                {{ t('settings.server.field.username') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="serverForm.username" type="text" />
            </label>
            <label>
              <span>
                {{ t('settings.server.field.password') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="serverForm.password" type="password" />
            </label>

            <p v-if="serverError" class="form-error">{{ serverError }}</p>
          </form>
        </AppDialog>
      </section>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.global-settings-mask {
  position: fixed;
  inset: 0;
  z-index: 4600;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.24);
}

.global-settings-dialog {
  width: min(900px, calc(100vw - 48px));
  height: min(760px, calc(100vh - 48px));
  border: 1px solid #d7e0eb;
  border-radius: 12px;
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 22px 44px rgba(15, 23, 42, 0.2);
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
}

.global-settings-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #e2e8f0;
}

.global-settings-dialog__header h3 {
  margin: 0;
  font-size: 15px;
}

.global-settings-dialog__close-btn {
  width: 28px;
  height: 28px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
  color: #475569;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  transition: background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}

.global-settings-dialog__close-btn:hover {
  background: #eef2f7;
  color: #0f172a;
  border-color: #b8c4d4;
}

.global-settings-dialog__close-btn:focus,
.global-settings-dialog__close-btn:focus-visible {
  outline: none;
}

.global-settings-dialog__close-btn svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.global-settings-tabs {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  padding: 0 14px;
  border-bottom: 1px solid #e2e8f0;
  background: #ffffff;
}

.global-settings-tabs__item {
  position: relative;
  height: 38px;
  margin-bottom: -1px;
  padding: 0 14px;
  border: 0;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease, background-color 0.16s ease;
}

.global-settings-tabs__item:hover {
  color: #334155;
  background: #f1f5f9;
}

.global-settings-tabs__item:focus,
.global-settings-tabs__item:focus-visible {
  outline: none;
}

.global-settings-tabs__item.active {
  color: #0f172a;
  border-bottom-color: #3b82f6;
}

.global-settings-dialog__body {
  min-height: 0;
  overflow: auto;
  padding: 12px;
}

.tab-pane {
  display: grid;
  gap: 10px;
}

.general-tab {
  gap: 12px;
}

.general-field {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(460px, 100%);
}

.general-field__label {
  flex: 0 0 108px;
  font-size: 12px;
  color: #475569;
}

.general-field__control {
  flex: 1 1 auto;
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  padding: 0 10px;
  outline: none;
}

.empty-tip {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.server-tab {
  gap: 12px;
}

.server-tab__toolbar,
.trigger-tab__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.server-tab__toolbar button,
.trigger-tab__toolbar button {
  height: 30px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  padding: 0 10px;
  cursor: pointer;
}

.server-tab__hint {
  font-size: 12px;
  color: #64748b;
  line-height: 1.3;
}

.server-editor-form {
  --server-form-label-width: 148px;
  display: grid;
  gap: 10px;
}

.server-editor-form > label {
  display: grid;
  grid-template-columns: minmax(112px, var(--server-form-label-width)) minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

.server-editor-form > label > span {
  font-size: 12px;
  color: #475569;
  text-align: right;
  line-height: 1.4;
}

.server-editor-form__required {
  margin-left: 4px;
  color: #dc2626;
  font-style: normal;
  font-weight: 700;
}

.server-editor-form input[type='text'],
.server-editor-form input[type='number'],
.server-editor-form input[type='password'],
.server-editor-form select,
.trigger-row input {
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #0f172a;
  padding: 0 10px;
  outline: none;
}

.server-editor-form input[type='text'],
.server-editor-form input[type='number'],
.server-editor-form input[type='password'],
.server-editor-form select {
  width: 100%;
}

.server-editor-form button,
.trigger-row button {
  height: 30px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  padding: 0 10px;
  cursor: pointer;
}

.server-editor-form .form-error {
  padding-left: calc(var(--server-form-label-width) + 12px);
}

.server-list {
  display: grid;
  gap: 0;
}

.server-table {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
}

.server-table__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.server-table__name {
  flex: 0 1 180px;
  min-width: 120px;
  max-width: 240px;
}

.server-table__endpoint {
  flex: 0 1 320px;
  min-width: 0;
  max-width: 420px;
}

.server-table__actions {
  margin-left: auto;
  min-width: 96px;
  text-align: right;
}

.server-list .empty-tip {
  margin: 0;
  padding: 14px 10px;
}

.server-row {
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.server-row:last-child {
  border-bottom: 0;
}

.server-row__name {
  font-size: 13px;
  color: #0f172a;
  flex: 0 1 180px;
  min-width: 120px;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-row__endpoint {
  font-size: 12px;
  color: #475569;
  flex: 0 1 320px;
  min-width: 0;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.server-row__actions {
  margin-left: auto;
  display: inline-flex;
  gap: 6px;
}

.server-row__action-btn {
  height: 24px;
  min-width: 0;
  border: 0;
  background: transparent;
  color: #475569;
  font-size: 12px;
  font-weight: 500;
  padding: 0 4px;
  cursor: pointer;
  transition: color 0.14s ease, opacity 0.14s ease;
}

.server-row__action-btn:focus,
.server-row__action-btn:focus-visible {
  outline: none;
}

.server-row__action-btn--edit {
  color: #2563eb;
}

.server-row__action-btn--edit:hover {
  color: #1d4ed8;
  opacity: 0.88;
}

.server-row__action-btn--delete {
  color: #dc2626;
}

.server-row__action-btn--delete:hover {
  color: #b91c1c;
  opacity: 0.88;
}

.general-shortcuts {
  width: min(760px, 100%);
  display: grid;
  gap: 8px;
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid #e2e8f0;
}

.shortcut-table {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
}

.shortcut-table__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 10px;
  border-bottom: 1px solid #e2e8f0;
  background: #f8fafc;
  font-size: 12px;
  font-weight: 600;
  color: #64748b;
}

.shortcut-table__keys {
  flex: 0 1 220px;
  min-width: 160px;
}

.shortcut-table__action {
  flex: 1 1 auto;
  min-width: 0;
}

.shortcut-list {
  display: grid;
  gap: 0;
}

.shortcut-row {
  padding: 9px 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
}

.shortcut-row:last-child {
  border-bottom: 0;
}

.shortcut-row__keys {
  flex: 0 1 220px;
  min-width: 160px;
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
    monospace;
}

.shortcut-row__action {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: #334155;
}

.trigger-list {
  display: grid;
  gap: 8px;
}

.trigger-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto;
  gap: 8px;
}

.trigger-enable {
  height: 30px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  padding: 0 8px;
  font-size: 12px;
}

.trigger-enable input {
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: #2563eb;
}

.trigger-enable span {
  line-height: 1;
}

.danger {
  border-color: #7f1d1d !important;
  color: #fecaca !important;
}

.form-error {
  margin: 0;
  color: #fca5a5;
  font-size: 12px;
}

@media (max-width: 720px) {
  .server-editor-form > label {
    grid-template-columns: 1fr;
    align-items: stretch;
    gap: 4px;
  }

  .server-editor-form > label > span {
    text-align: left;
  }

  .server-editor-form .form-error {
    padding-left: 0;
  }
}
</style>
