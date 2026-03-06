import { ref, watch } from 'vue'

export interface RuntimeSettings {
  defaultShell: string
  fontFamily: string
  readyTimeoutMs: number
  reconnectEnabled: boolean
  reconnectMaxAttempts: number
  reconnectDelayMs: number
}

const STORAGE_KEY = 'iterm.runtime-settings.v1'

const RUNTIME_SETTING_KEYS = {
  defaultShell: 'terminal.defaultShell',
  fontFamily: 'ui.fontFamily',
  readyTimeoutMs: 'ssh.readyTimeoutMs',
  reconnectEnabled: 'ssh.reconnectEnabled',
  reconnectMaxAttempts: 'ssh.reconnectMaxAttempts',
  reconnectDelayMs: 'ssh.reconnectDelayMs',
} as const

const LEGACY_SETTING_KEYS = {
  defaultShell: 'defaultShell',
  readyTimeoutMs: 'sshTimeoutMs',
  reconnectEnabled: 'sshAutoReconnect',
} as const

const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  defaultShell: '/bin/zsh',
  fontFamily: 'PingFang SC, Helvetica Neue, Arial, sans-serif',
  readyTimeoutMs: 15_000,
  reconnectEnabled: true,
  reconnectMaxAttempts: 3,
  reconnectDelayMs: 1_500,
}

const READY_TIMEOUT_RANGE = { min: 1_000, max: 120_000 }
const RECONNECT_ATTEMPTS_RANGE = { min: 1, max: 10 }
const RECONNECT_DELAY_RANGE = { min: 200, max: 60_000 }

type PersistenceMode = 'pending' | 'electron' | 'local'

interface LocalSettingsState {
  settings: RuntimeSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toNumberInRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(Math.round(value), min, max)
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return clamp(Math.round(parsed), min, max)
    }
  }

  return fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
      return true
    }
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
      return false
    }
  }

  return fallback
}

function toDefaultShell(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_RUNTIME_SETTINGS.defaultShell
  }

  return value.trim().slice(0, 512)
}

function toFontFamily(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_RUNTIME_SETTINGS.fontFamily
  }

  const normalized = value.trim()
  return normalized || DEFAULT_RUNTIME_SETTINGS.fontFamily
}

function normalizeRuntimeSettings(settings: RuntimeSettings): RuntimeSettings {
  return {
    defaultShell: toDefaultShell(settings.defaultShell),
    fontFamily: toFontFamily(settings.fontFamily),
    readyTimeoutMs: toNumberInRange(
      settings.readyTimeoutMs,
      READY_TIMEOUT_RANGE.min,
      READY_TIMEOUT_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.readyTimeoutMs,
    ),
    reconnectEnabled: toBoolean(settings.reconnectEnabled, DEFAULT_RUNTIME_SETTINGS.reconnectEnabled),
    reconnectMaxAttempts: toNumberInRange(
      settings.reconnectMaxAttempts,
      RECONNECT_ATTEMPTS_RANGE.min,
      RECONNECT_ATTEMPTS_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.reconnectMaxAttempts,
    ),
    reconnectDelayMs: toNumberInRange(
      settings.reconnectDelayMs,
      RECONNECT_DELAY_RANGE.min,
      RECONNECT_DELAY_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.reconnectDelayMs,
    ),
  }
}

function getElectronSettingsApi(): SettingsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  const candidate = (window as unknown as { electronAPI?: Partial<ElectronApi> }).electronAPI
  if (!candidate?.settings) {
    return null
  }

  const { settings } = candidate
  if (typeof settings.get !== 'function' || typeof settings.set !== 'function') {
    return null
  }

  return settings as SettingsApi
}

function loadSettingsFromLocalStorage(): LocalSettingsState {
  if (typeof window === 'undefined') {
    return {
      settings: { ...DEFAULT_RUNTIME_SETTINGS },
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        settings: { ...DEFAULT_RUNTIME_SETTINGS },
      }
    }

    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {
        settings: { ...DEFAULT_RUNTIME_SETTINGS },
      }
    }

    return {
      settings: {
        defaultShell: toDefaultShell(parsed.defaultShell),
        fontFamily: toFontFamily(parsed.fontFamily),
        readyTimeoutMs: toNumberInRange(
          parsed.readyTimeoutMs,
          READY_TIMEOUT_RANGE.min,
          READY_TIMEOUT_RANGE.max,
          DEFAULT_RUNTIME_SETTINGS.readyTimeoutMs,
        ),
        reconnectEnabled: toBoolean(parsed.reconnectEnabled, DEFAULT_RUNTIME_SETTINGS.reconnectEnabled),
        reconnectMaxAttempts: toNumberInRange(
          parsed.reconnectMaxAttempts,
          RECONNECT_ATTEMPTS_RANGE.min,
          RECONNECT_ATTEMPTS_RANGE.max,
          DEFAULT_RUNTIME_SETTINGS.reconnectMaxAttempts,
        ),
        reconnectDelayMs: toNumberInRange(
          parsed.reconnectDelayMs,
          RECONNECT_DELAY_RANGE.min,
          RECONNECT_DELAY_RANGE.max,
          DEFAULT_RUNTIME_SETTINGS.reconnectDelayMs,
        ),
      },
    }
  } catch {
    return {
      settings: { ...DEFAULT_RUNTIME_SETTINGS },
    }
  }
}

function saveSettingsToLocalStorage(settings: RuntimeSettings): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

async function readSettingValue(api: SettingsApi, key: string): Promise<string | null> {
  const result = await api.get(key)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
  return result.data.setting?.value ?? null
}

async function readSettingValueByPriority(api: SettingsApi, keys: readonly string[]): Promise<string | null> {
  for (const key of keys) {
    const value = await readSettingValue(api, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

async function writeSettingValue(api: SettingsApi, key: string, value: string): Promise<void> {
  const result = await api.set(key, value)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
}

async function loadSettingsFromElectron(api: SettingsApi): Promise<RuntimeSettings> {
  const [
    defaultShell,
    fontFamily,
    readyTimeoutMs,
    reconnectEnabled,
    reconnectMaxAttempts,
    reconnectDelayMs,
  ] = await Promise.all([
    readSettingValueByPriority(api, [RUNTIME_SETTING_KEYS.defaultShell, LEGACY_SETTING_KEYS.defaultShell]),
    readSettingValue(api, RUNTIME_SETTING_KEYS.fontFamily),
    readSettingValueByPriority(api, [RUNTIME_SETTING_KEYS.readyTimeoutMs, LEGACY_SETTING_KEYS.readyTimeoutMs]),
    readSettingValueByPriority(api, [RUNTIME_SETTING_KEYS.reconnectEnabled, LEGACY_SETTING_KEYS.reconnectEnabled]),
    readSettingValue(api, RUNTIME_SETTING_KEYS.reconnectMaxAttempts),
    readSettingValue(api, RUNTIME_SETTING_KEYS.reconnectDelayMs),
  ])

  return {
    defaultShell: toDefaultShell(defaultShell),
    fontFamily: toFontFamily(fontFamily),
    readyTimeoutMs: toNumberInRange(
      readyTimeoutMs,
      READY_TIMEOUT_RANGE.min,
      READY_TIMEOUT_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.readyTimeoutMs,
    ),
    reconnectEnabled: toBoolean(reconnectEnabled, DEFAULT_RUNTIME_SETTINGS.reconnectEnabled),
    reconnectMaxAttempts: toNumberInRange(
      reconnectMaxAttempts,
      RECONNECT_ATTEMPTS_RANGE.min,
      RECONNECT_ATTEMPTS_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.reconnectMaxAttempts,
    ),
    reconnectDelayMs: toNumberInRange(
      reconnectDelayMs,
      RECONNECT_DELAY_RANGE.min,
      RECONNECT_DELAY_RANGE.max,
      DEFAULT_RUNTIME_SETTINGS.reconnectDelayMs,
    ),
  }
}

async function saveSettingsToElectron(api: SettingsApi, settings: RuntimeSettings): Promise<void> {
  await Promise.all([
    writeSettingValue(api, RUNTIME_SETTING_KEYS.defaultShell, settings.defaultShell),
    writeSettingValue(api, RUNTIME_SETTING_KEYS.fontFamily, settings.fontFamily),
    writeSettingValue(api, RUNTIME_SETTING_KEYS.readyTimeoutMs, String(settings.readyTimeoutMs)),
    writeSettingValue(api, RUNTIME_SETTING_KEYS.reconnectEnabled, String(settings.reconnectEnabled)),
    writeSettingValue(api, RUNTIME_SETTING_KEYS.reconnectMaxAttempts, String(settings.reconnectMaxAttempts)),
    writeSettingValue(api, RUNTIME_SETTING_KEYS.reconnectDelayMs, String(settings.reconnectDelayMs)),
  ])
}

function createRuntimeSettingsState() {
  const localState = loadSettingsFromLocalStorage()
  const defaultShell = ref(localState.settings.defaultShell)
  const fontFamily = ref(localState.settings.fontFamily)
  const readyTimeoutMs = ref(localState.settings.readyTimeoutMs)
  const reconnectEnabled = ref(localState.settings.reconnectEnabled)
  const reconnectMaxAttempts = ref(localState.settings.reconnectMaxAttempts)
  const reconnectDelayMs = ref(localState.settings.reconnectDelayMs)
  const persistenceMode = ref<PersistenceMode>('pending')
  const isHydrating = ref(true)
  const electronSettingsApi = getElectronSettingsApi()

  function snapshot(): RuntimeSettings {
    return normalizeRuntimeSettings({
      defaultShell: defaultShell.value,
      fontFamily: fontFamily.value,
      readyTimeoutMs: readyTimeoutMs.value,
      reconnectEnabled: reconnectEnabled.value,
      reconnectMaxAttempts: reconnectMaxAttempts.value,
      reconnectDelayMs: reconnectDelayMs.value,
    })
  }

  function apply(settings: RuntimeSettings): void {
    defaultShell.value = settings.defaultShell
    fontFamily.value = settings.fontFamily
    readyTimeoutMs.value = settings.readyTimeoutMs
    reconnectEnabled.value = settings.reconnectEnabled
    reconnectMaxAttempts.value = settings.reconnectMaxAttempts
    reconnectDelayMs.value = settings.reconnectDelayMs
  }

  async function persistToElectronWithFallback(settings: RuntimeSettings): Promise<void> {
    if (!electronSettingsApi) {
      persistenceMode.value = 'local'
      saveSettingsToLocalStorage(settings)
      return
    }

    try {
      await saveSettingsToElectron(electronSettingsApi, settings)
    } catch {
      persistenceMode.value = 'local'
      saveSettingsToLocalStorage(settings)
    }
  }

  function persistSettings(): void {
    const normalized = snapshot()
    apply(normalized)
    saveSettingsToLocalStorage(normalized)

    if (persistenceMode.value === 'electron') {
      void persistToElectronWithFallback(normalized)
    }
  }

  watch(
    [defaultShell, fontFamily, readyTimeoutMs, reconnectEnabled, reconnectMaxAttempts, reconnectDelayMs],
    () => {
      if (isHydrating.value) {
        return
      }
      persistSettings()
    },
    { immediate: false },
  )

  async function initializePersistence(): Promise<void> {
    if (!electronSettingsApi) {
      persistenceMode.value = 'local'
      isHydrating.value = false
      persistSettings()
      return
    }

    try {
      const persisted = await loadSettingsFromElectron(electronSettingsApi)
      apply(persisted)
      persistenceMode.value = 'electron'
    } catch {
      persistenceMode.value = 'local'
    } finally {
      isHydrating.value = false
      persistSettings()
    }
  }

  void initializePersistence()

  return {
    defaultShell,
    fontFamily,
    readyTimeoutMs,
    reconnectEnabled,
    reconnectMaxAttempts,
    reconnectDelayMs,
    persistenceMode,
  }
}

const runtimeSettingsState = createRuntimeSettingsState()

export function useRuntimeSettings() {
  return runtimeSettingsState
}

export type RuntimeSettingsState = ReturnType<typeof createRuntimeSettingsState>
