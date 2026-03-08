<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useAppUiSettings } from '../../composables/useAppUiSettings'
import { useGlobalMessage } from '../../composables/useGlobalMessage'
import { useI18n, type AppLanguage } from '../../composables/useI18n'
import { useServerSidebarState } from '../../composables/useServerSidebarState'
import { useTerminalTriggers } from '../../composables/useTerminalTriggers'
import type { CreateServerInput, ServerRecord } from '../../types/server'
import AppDialog from '../common/AppDialog.vue'

type SettingsTab = 'general' | 'servers' | 'triggers' | 'ai'
type ServerEditorMode = 'create' | 'edit' | null

const AI_PLATFORMS_KEY = 'ai.platforms'
const AI_RESPONSE_LANGUAGE_KEY = 'ai.commandBar.responseLanguage'

interface AIPlatformRecord {
  id: number
  platformName: string
  apiUrl: string
  apiKey: string
  model: string
}

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
const updateChecking = ref(false)

const serverForm = reactive({
  name: '',
  host: '',
  port: '22',
  username: '',
  password: '',
})

const aiPlatforms = ref<AIPlatformRecord[]>([])
type PlatformEditorMode = 'create' | 'edit' | null
const platformEditorMode = ref<PlatformEditorMode>(null)
const editingPlatformId = ref<number | null>(null)
const platformForm = reactive({
  platformName: '',
  apiUrl: '',
  apiKey: '',
  model: '',
})
const platformSubmitting = ref(false)
const platformError = ref<string | null>(null)

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

const aiPlatformsSorted = computed(() => {
  return [...aiPlatforms.value].sort((a, b) => a.platformName.localeCompare(b.platformName) || a.apiUrl.localeCompare(b.apiUrl))
})

const visibleTriggerRules = computed(() => triggerState.rules.value.filter((rule) => !rule.hidden))

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
    id: 'toggle-ai-command-bar',
    keys: 'Command + K',
    action: t('settings.shortcut.action.toggleAiCommandBar'),
    scope: t('settings.shortcut.scope.terminal'),
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

const platformEditorDialogOpen = computed(() => platformEditorMode.value !== null)
const platformEditorDialogTitle = computed(() =>
  platformEditorMode.value === 'edit' ? t('settings.ai.editTitle') : t('settings.ai.createTitle'),
)
const platformEditorConfirmText = computed(() =>
  platformEditorMode.value === 'edit' ? t('settings.ai.editConfirm') : t('settings.ai.createConfirm'),
)
const platformSubmitDisabled = computed(
  () => !platformForm.platformName.trim() || !platformForm.apiUrl.trim() || !platformForm.apiKey.trim(),
)

watch(
  () => props.open,
  (open) => {
    if (!open) {
      return
    }
    void serverState.ensureLoaded().then(() => {
      reconcileHiddenServerTriggers()
    })
    activeTab.value = props.initialTab ?? 'general'
    generalFontSizeDraft.value = String(uiSettings.fontSize.value)
    generalLineHeightDraft.value = String(uiSettings.lineHeight.value)
    cancelServerEditor()
    cancelPlatformEditor()
    if (activeTab.value === 'ai') {
      void loadAIPlatforms()
    }
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
  if (serverEditorDialogOpen.value || platformEditorDialogOpen.value) {
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
  if (value !== 'en') {
    void syncAIResponseLanguageFromUi(value)
  }
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

function resolveUpdateApi(): null | UpdateApi {
  if (window.electronAPI?.update) {
    return window.electronAPI.update
  }
  if (window.__electronAPIBridge?.update) {
    return window.__electronAPIBridge.update
  }
  return null
}

async function checkForAppUpdates(): Promise<void> {
  const updateApi = resolveUpdateApi()
  if (!updateApi) {
    globalMessage.error(t('settings.update.unavailable'), { replace: true })
    return
  }

  updateChecking.value = true
  try {
    const checked = await updateApi.check()
    if (!checked.ok) {
      throw new Error(checked.error.message)
    }

    if (!checked.data.hasUpdate) {
      globalMessage.success(t('settings.update.latest'), { replace: true })
      return
    }

    const prompted = await updateApi.promptForUpdate({
      currentVersion: checked.data.currentVersion,
      latestVersion: checked.data.latestVersion,
      latestTag: checked.data.latestTag,
      releaseUrl: checked.data.releaseUrl,
    })
    if (!prompted.ok) {
      throw new Error(prompted.error.message)
    }

    if (prompted.data.action === 'update' && prompted.data.openedReleasePage) {
      globalMessage.info(t('settings.update.opened'), { replace: true })
    }
  } catch (error) {
    globalMessage.info(t('settings.update.latest'), { replace: true })
  } finally {
    updateChecking.value = false
  }
}

function switchTab(tab: SettingsTab): void {
  activeTab.value = tab
  if (tab === 'ai') {
    void loadAIPlatforms()
  }
}

type SettingsApiLike = {
  get: (key: string) => Promise<{ ok: boolean; data?: { setting?: { value?: string } } }>
  set: (key: string, value: string) => Promise<{ ok: boolean }>
}
function getSettingsApi(): SettingsApiLike | null {
  const api = (window as unknown as { electronAPI?: { settings?: SettingsApiLike } }).electronAPI?.settings
  return api && typeof api.get === 'function' && typeof api.set === 'function' ? api : null
}

async function syncAIResponseLanguageFromUi(language: string): Promise<void> {
  const api = getSettingsApi()
  if (!api) {
    return
  }
  try {
    await api.set(AI_RESPONSE_LANGUAGE_KEY, language)
  } catch {
    // ignore persistence failure
  }
}

async function loadAIPlatforms(): Promise<void> {
  const api = getSettingsApi()
  if (!api) {
    return
  }
  try {
    const res = await api.get(AI_PLATFORMS_KEY)
    if (res.ok && res.data?.setting?.value) {
      const parsed = JSON.parse(res.data.setting.value) as unknown
      if (Array.isArray(parsed) && parsed.length > 0) {
        aiPlatforms.value = parsed.filter(
          (p): p is AIPlatformRecord =>
            p != null &&
            typeof p === 'object' &&
            typeof (p as AIPlatformRecord).id === 'number' &&
            typeof (p as AIPlatformRecord).platformName === 'string' &&
            typeof (p as AIPlatformRecord).apiUrl === 'string' &&
            typeof (p as AIPlatformRecord).apiKey === 'string' &&
            typeof (p as AIPlatformRecord).model === 'string',
        )
        return
      }
    }
    const [nameRes, urlRes, keyRes, modelRes] = await Promise.all([
      api.get('ai.platformName'),
      api.get('ai.apiUrl'),
      api.get('ai.apiKey'),
      api.get('ai.model'),
    ])
    const name = (nameRes.ok && nameRes.data?.setting?.value) ? nameRes.data.setting.value.trim() : ''
    const url = (urlRes.ok && urlRes.data?.setting?.value) ? urlRes.data.setting.value.trim() : ''
    const key = (keyRes.ok && keyRes.data?.setting?.value) ? keyRes.data.setting.value.trim() : ''
    const model = (modelRes.ok && modelRes.data?.setting?.value) ? modelRes.data.setting.value.trim() : ''
    if (name || url || key || model) {
      aiPlatforms.value = [{ id: Date.now(), platformName: name, apiUrl: url, apiKey: key, model }]
      await saveAIPlatforms()
    } else {
      aiPlatforms.value = []
    }
  } catch {
    aiPlatforms.value = []
  }
}

async function saveAIPlatforms(): Promise<void> {
  const api = getSettingsApi()
  if (!api) {
    return
  }
  const res = await api.set(AI_PLATFORMS_KEY, JSON.stringify(aiPlatforms.value))
  if (!res.ok) {
    throw new Error(t('settings.ai.saveFailed'))
  }
}

function openCreatePlatformEditor(): void {
  platformEditorMode.value = 'create'
  editingPlatformId.value = null
  platformSubmitting.value = false
  platformError.value = null
  platformForm.platformName = ''
  platformForm.apiUrl = ''
  platformForm.apiKey = ''
  platformForm.model = ''
}

function openEditPlatformEditor(platform: AIPlatformRecord): void {
  platformEditorMode.value = 'edit'
  editingPlatformId.value = platform.id
  platformSubmitting.value = false
  platformError.value = null
  platformForm.platformName = platform.platformName
  platformForm.apiUrl = platform.apiUrl
  platformForm.apiKey = platform.apiKey
  platformForm.model = platform.model
}

function cancelPlatformEditor(): void {
  platformEditorMode.value = null
  editingPlatformId.value = null
  platformSubmitting.value = false
  platformError.value = null
}

async function submitPlatformEditor(): Promise<void> {
  if (!platformEditorMode.value) {
    return
  }
  platformError.value = null
  platformSubmitting.value = true
  try {
    const name = platformForm.platformName.trim()
    const apiUrl = platformForm.apiUrl.trim()
    const apiKey = platformForm.apiKey.trim()
    const model = platformForm.model.trim()
    if (!name || !apiUrl || !apiKey) {
      platformError.value = t('settings.ai.error.fieldsRequired')
      return
    }
    if (platformEditorMode.value === 'edit') {
      const id = editingPlatformId.value
      if (id == null) {
        platformError.value = t('settings.ai.error.missingEditId')
        return
      }
      const idx = aiPlatforms.value.findIndex((p) => p.id === id)
      if (idx >= 0) {
        aiPlatforms.value = aiPlatforms.value.slice()
        aiPlatforms.value[idx] = { id, platformName: name, apiUrl, apiKey, model }
      }
    } else {
      aiPlatforms.value = [...aiPlatforms.value, { id: Date.now(), platformName: name, apiUrl, apiKey, model }]
    }
    await saveAIPlatforms()
    cancelPlatformEditor()
  } catch (err) {
    platformError.value = getErrorMessage(err, t('settings.ai.saveFailed'))
  } finally {
    platformSubmitting.value = false
  }
}

async function removeAIPlatform(platform: AIPlatformRecord): Promise<void> {
  const confirmed = window.confirm(t('settings.ai.deleteConfirm', { name: platform.platformName || t('settings.ai.platformName') }))
  if (!confirmed) {
    return
  }
  try {
    aiPlatforms.value = aiPlatforms.value.filter((p) => p.id !== platform.id)
    await saveAIPlatforms()
    if (editingPlatformId.value === platform.id) {
      cancelPlatformEditor()
    }
  } catch (err) {
    globalMessage.error(getErrorMessage(err, t('settings.ai.deleteFailed')), { replace: true })
  }
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
      const updated = await serverState.updateServer(serverId, payload)
      upsertHiddenServerTrigger(updated)
    } else {
      const created = await serverState.createServer(payload)
      upsertHiddenServerTrigger(created)
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
    removeHiddenServerTriggers(server.id)
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
    autoSend: false,
    hidden: false,
    source: 'user',
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

function updateTriggerAutoSend(ruleId: string, event: Event): void {
  const autoSend = (event.target as HTMLInputElement).checked
  triggerState.updateRule(ruleId, {
    autoSend,
  })
}

function buildServerPasswordPromptPattern(server: Pick<ServerRecord, 'username' | 'host'>): string {
  return `${server.username}@${server.host}'s password:`
}

function normalizeServerPassword(server: Pick<ServerRecord, 'password'>): string {
  const raw = typeof server.password === 'string' ? server.password : ''
  return raw.trim()
}

function findHiddenServerTriggerRuleIds(serverId: number): string[] {
  return triggerState.rules.value
    .filter(
      (rule) =>
        rule.source === 'server_hidden' &&
        rule.sourceServerId === serverId,
    )
    .map((rule) => rule.id)
}

function removeHiddenServerTriggers(serverId: number): void {
  for (const ruleId of findHiddenServerTriggerRuleIds(serverId)) {
    triggerState.removeRule(ruleId)
  }
}

function upsertHiddenServerTrigger(server: ServerRecord): void {
  const username = server.username.trim()
  const host = server.host.trim()
  const password = normalizeServerPassword(server)
  if (!username || !host || !password) {
    removeHiddenServerTriggers(server.id)
    return
  }

  const pattern = buildServerPasswordPromptPattern({ username, host })
  const existingRuleIds = findHiddenServerTriggerRuleIds(server.id)
  const primaryRuleId = existingRuleIds[0]
  if (!primaryRuleId) {
    triggerState.addRule({
      pattern,
      sendText: password,
      enabled: true,
      autoSend: true,
      hidden: true,
      source: 'server_hidden',
      sourceServerId: server.id,
    })
    return
  }

  triggerState.updateRule(primaryRuleId, {
    pattern,
    sendText: password,
    enabled: true,
    autoSend: true,
    hidden: true,
    source: 'server_hidden',
    sourceServerId: server.id,
  })
  for (const duplicateRuleId of existingRuleIds.slice(1)) {
    triggerState.removeRule(duplicateRuleId)
  }
}

function reconcileHiddenServerTriggers(): void {
  const serversById = new Map(serverState.servers.value.map((server) => [server.id, server]))
  const allRules = [...triggerState.rules.value]
  const staleRuleIds = allRules
    .filter((rule) => rule.source === 'server_hidden' && (!rule.sourceServerId || !serversById.has(rule.sourceServerId)))
    .map((rule) => rule.id)

  for (const staleRuleId of staleRuleIds) {
    triggerState.removeRule(staleRuleId)
  }

  for (const server of serverState.servers.value) {
    upsertHiddenServerTrigger(server)
  }
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
          <button
            type="button"
            role="tab"
            class="global-settings-tabs__item"
            :class="{ active: activeTab === 'ai' }"
            :aria-selected="activeTab === 'ai'"
            @click="switchTab('ai')"
          >
            {{ t('settings.tab.ai') }}
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
            <div class="general-field general-field--action">
              <span class="general-field__label">{{ t('settings.general.update') }}</span>
              <button
                type="button"
                class="general-field__action-btn"
                :disabled="updateChecking"
                @click="void checkForAppUpdates()"
              >
                {{ updateChecking ? t('settings.update.checking') : t('settings.update.check') }}
              </button>
            </div>
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

          <section v-else-if="activeTab === 'triggers'" class="tab-pane trigger-tab">
            <div class="trigger-tab__toolbar">
              <button type="button" @click="addTriggerRow">{{ t('settings.trigger.add') }}</button>
            </div>
            <div v-if="visibleTriggerRules.length === 0" class="empty-tip">{{ t('settings.trigger.empty') }}</div>
            <div v-else class="trigger-list">
              <article v-for="rule in visibleTriggerRules" :key="rule.id" class="trigger-row">
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
                <label class="trigger-enable">
                  <input type="checkbox" :checked="rule.autoSend" @change="updateTriggerAutoSend(rule.id, $event)" />
                  <span>{{ t('settings.trigger.autoSend') }}</span>
                </label>
                <button type="button" class="ai-platform-row__btn ai-platform-row__btn--delete" @click="removeTriggerRow(rule.id)">
                  {{ t('settings.trigger.delete') }}
                </button>
              </article>
            </div>
          </section>

          <section v-else-if="activeTab === 'ai'" class="tab-pane ai-tab">
            <div class="ai-tab__toolbar">
              <button type="button" @click="openCreatePlatformEditor">{{ t('settings.ai.add') }}</button>
              <span class="ai-tab__hint">{{ t('settings.ai.localStorageHint') }}</span>
            </div>
            <div class="ai-platform-table">
              <header class="ai-platform-table__head">
                <span class="ai-platform-table__name">{{ t('settings.ai.platformName') }}</span>
                <span class="ai-platform-table__url">{{ t('settings.ai.apiUrl') }}</span>
                <span class="ai-platform-table__model">{{ t('settings.ai.model') }}</span>
                <span class="ai-platform-table__actions">Control</span>
              </header>
              <div class="ai-platform-list">
                <p v-if="aiPlatformsSorted.length === 0" class="empty-tip">{{ t('settings.ai.empty') }}</p>
                <article v-for="platform in aiPlatformsSorted" :key="platform.id" class="ai-platform-row">
                  <strong class="ai-platform-row__name" :title="platform.platformName">{{ platform.platformName || '—' }}</strong>
                  <span class="ai-platform-row__url" :title="platform.apiUrl">{{ platform.apiUrl || '—' }}</span>
                  <span class="ai-platform-row__model" :title="platform.model">{{ platform.model || '—' }}</span>
                  <div class="ai-platform-row__actions">
                    <button
                      type="button"
                      class="ai-platform-row__btn ai-platform-row__btn--edit"
                      @click="openEditPlatformEditor(platform)"
                    >
                      {{ t('settings.server.edit') }}
                    </button>
                    <button
                      type="button"
                      class="ai-platform-row__btn ai-platform-row__btn--delete"
                      @click="void removeAIPlatform(platform)"
                    >
                      {{ t('settings.server.delete') }}
                    </button>
                  </div>
                </article>
              </div>
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

        <AppDialog
          :open="platformEditorDialogOpen"
          :title="platformEditorDialogTitle"
          :confirm-text="platformEditorConfirmText"
          :cancel-text="t('settings.cancel')"
          :confirm-disabled="platformSubmitDisabled"
          :loading="platformSubmitting"
          @close="cancelPlatformEditor"
          @confirm="void submitPlatformEditor()"
        >
          <form class="server-editor-form ai-platform-editor-form" @submit.prevent="void submitPlatformEditor()">
            <label>
              <span>
                {{ t('settings.ai.platformName') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="platformForm.platformName" type="text" />
            </label>
            <label>
              <span>
                {{ t('settings.ai.apiUrl') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="platformForm.apiUrl" type="url" placeholder="https://api.openai.com/v1" />
            </label>
            <label>
              <span>
                {{ t('settings.ai.apiKey') }}
                <em class="server-editor-form__required" aria-hidden="true">*</em>
              </span>
              <input v-model="platformForm.apiKey" type="text" autocomplete="off" />
            </label>
            <label>
              <span>{{ t('settings.ai.model') }}</span>
              <input v-model="platformForm.model" type="text" :placeholder="t('settings.ai.modelPlaceholder')" />
            </label>
            <p v-if="platformError" class="form-error">{{ platformError }}</p>
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

.general-field--action {
  align-items: center;
}

.general-field__action-btn {
  flex: 0 0 auto;
  height: 32px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #ffffff;
  color: #334155;
  padding: 0 12px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
}

.general-field__action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.empty-tip {
  margin: 0;
  color: #64748b;
  font-size: 13px;
}

.server-tab,
.ai-tab {
  gap: 12px;
}

.ai-tab__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-tab__hint {
  font-size: 12px;
  color: #64748b;
  line-height: 1.3;
}

.ai-platform-table {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #ffffff;
  overflow: hidden;
}

.ai-platform-table__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
  font-size: 12px;
  font-weight: 600;
  color: #475569;
}

.ai-platform-table__name {
  flex: 0 1 180px;
  min-width: 120px;
  max-width: 240px;
}

.ai-platform-table__url {
  flex: 1 1 320px;
  min-width: 0;
  max-width: 420px;
}

.ai-platform-table__model {
  flex: 0 1 180px;
  min-width: 0;
  max-width: 240px;
}

.ai-platform-table__actions {
  margin-left: auto;
  min-width: 96px;
  text-align: right;
}

.ai-platform-list {
  min-height: 44px;
}

.ai-platform-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid #e2e8f0;
  font-size: 13px;
}

.ai-platform-row:last-child {
  border-bottom: 0;
}

.ai-platform-row__name {
  flex: 0 1 180px;
  min-width: 120px;
  max-width: 240px;
  font-weight: 600;
  color: #0f172a;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-platform-row__url {
  flex: 1 1 320px;
  min-width: 0;
  max-width: 420px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-platform-row__model {
  flex: 0 1 180px;
  min-width: 0;
  max-width: 240px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-platform-row__actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
  min-width: 96px;
  justify-content: flex-end;
}

.ai-platform-row__btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  font-size: 12px;
  cursor: pointer;
}

.ai-platform-row__btn:hover {
  background: #eef2f7;
  border-color: #94a3b8;
}

.ai-platform-row__btn--delete {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.ai-platform-row__btn--delete:hover {
  background: #fee2e2;
  border-color: #f87171;
}

.ai-tab__toolbar,
.server-tab__toolbar,
.trigger-tab__toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-start;
}

.ai-tab__toolbar button,
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
.server-editor-form input[type='url'],
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
.server-editor-form input[type='url'],
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

.trigger-row .ai-platform-row__btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  font-size: 12px;
}

.trigger-row .ai-platform-row__btn:hover {
  background: #eef2f7;
  border-color: #94a3b8;
}

.trigger-row .ai-platform-row__btn--delete {
  border-color: #fecaca;
  color: #b91c1c;
  background: #fef2f2;
}

.trigger-row .ai-platform-row__btn--delete:hover {
  background: #fee2e2;
  border-color: #f87171;
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

.server-list .empty-tip,
.ai-platform-list .empty-tip {
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
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto auto auto;
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

  .ai-tab__field {
    grid-template-columns: 1fr;
    gap: 4px;
  }

  .ai-tab__label {
    text-align: left;
  }
}
</style>
