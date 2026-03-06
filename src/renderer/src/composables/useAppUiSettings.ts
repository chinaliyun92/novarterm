import { computed, ref, watch } from 'vue'

export type AppTheme = 'light' | 'dark'
export type AppCursorStyle = 'block' | 'bar' | 'underline'

export interface AppUiSettings {
  theme: AppTheme
  fontSize: number
  lineHeight: number
  cursorStyle: AppCursorStyle
}

const STORAGE_KEY = 'iterm.app-ui-settings.v1'
const MIGRATION_MARKER_KEY = 'uiSettingsMigrated.v1'

const UI_SETTING_KEYS = {
  theme: 'theme',
  fontSize: 'fontSize',
  lineHeight: 'lineHeight',
  cursorStyle: 'cursorStyle',
} as const

const DEFAULT_SETTINGS: AppUiSettings = {
  theme: 'light',
  fontSize: 14,
  lineHeight: 1.5,
  cursorStyle: 'block',
}

const FONT_SIZE_RANGE = { min: 11, max: 20 }
const LINE_HEIGHT_RANGE = { min: 1.1, max: 2 }

type PersistenceMode = 'pending' | 'electron' | 'local'

interface LocalSettingsState {
  settings: AppUiSettings
  hasStoredValue: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function toTheme(value: unknown): AppTheme {
  return value === 'dark' ? 'dark' : 'light'
}

function toCursorStyle(value: unknown): AppCursorStyle {
  if (value === 'bar' || value === 'underline') {
    return value
  }
  return 'block'
}

function toFontSize(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return clamp(parsed, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max)
  }

  return DEFAULT_SETTINGS.fontSize
}

function toLineHeight(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return clamp(parsed, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
    }
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
  }

  return DEFAULT_SETTINGS.lineHeight
}

function getElectronSettingsApi(): SettingsApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  const candidate = (window as unknown as { electronAPI?: Partial<ElectronApi> }).electronAPI
  if (!candidate || !candidate.settings) {
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
      settings: { ...DEFAULT_SETTINGS },
      hasStoredValue: false,
    }
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {
        settings: { ...DEFAULT_SETTINGS },
        hasStoredValue: false,
      }
    }

    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) {
      return {
        settings: { ...DEFAULT_SETTINGS },
        hasStoredValue: true,
      }
    }

    return {
      settings: {
        theme: toTheme(parsed.theme),
        fontSize: toFontSize(parsed.fontSize),
        lineHeight: toLineHeight(parsed.lineHeight),
        cursorStyle: toCursorStyle(parsed.cursorStyle),
      },
      hasStoredValue: true,
    }
  } catch {
    return {
      settings: { ...DEFAULT_SETTINGS },
      hasStoredValue: false,
    }
  }
}

function saveSettingsToLocalStorage(settings: AppUiSettings): void {
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

async function writeSettingValue(api: SettingsApi, key: string, value: string): Promise<void> {
  const result = await api.set(key, value)

  if (!result.ok) {
    throw new Error(result.error.message)
  }
}

async function loadSettingsFromElectron(api: SettingsApi): Promise<AppUiSettings> {
  const [theme, fontSize, lineHeight, cursorStyle] = await Promise.all([
    readSettingValue(api, UI_SETTING_KEYS.theme),
    readSettingValue(api, UI_SETTING_KEYS.fontSize),
    readSettingValue(api, UI_SETTING_KEYS.lineHeight),
    readSettingValue(api, UI_SETTING_KEYS.cursorStyle),
  ])

  return {
    theme: toTheme(theme),
    fontSize: toFontSize(fontSize),
    lineHeight: toLineHeight(lineHeight),
    cursorStyle: toCursorStyle(cursorStyle),
  }
}

async function saveSettingsToElectron(api: SettingsApi, settings: AppUiSettings): Promise<void> {
  await Promise.all([
    writeSettingValue(api, UI_SETTING_KEYS.theme, settings.theme),
    writeSettingValue(api, UI_SETTING_KEYS.fontSize, String(settings.fontSize)),
    writeSettingValue(api, UI_SETTING_KEYS.lineHeight, String(settings.lineHeight)),
    writeSettingValue(api, UI_SETTING_KEYS.cursorStyle, settings.cursorStyle),
  ])
}

function createAppUiSettingsState() {
  const localState = loadSettingsFromLocalStorage()
  const theme = ref<AppTheme>(localState.settings.theme)
  const fontSize = ref<number>(localState.settings.fontSize)
  const lineHeight = ref<number>(localState.settings.lineHeight)
  const cursorStyle = ref<AppCursorStyle>(localState.settings.cursorStyle)
  const persistenceMode = ref<PersistenceMode>('pending')
  const electronSettingsApi = getElectronSettingsApi()

  const cssVars = computed<Record<string, string>>(() => {
    const isDark = theme.value === 'dark'
    return {
      '--app-bg': isDark ? '#0c1224' : '#f4f6fb',
      '--app-fg': isDark ? '#dbe5ff' : '#1f2a44',
      '--app-panel-bg': isDark ? '#111a31' : '#ffffff',
      '--app-panel-border': isDark ? '#2a375f' : '#d9dfef',
      '--app-topbar-bg': isDark ? '#111a31' : '#ffffff',
      '--app-status-bg': isDark ? '#0f1831' : '#ffffff',
      '--app-muted-fg': isDark ? '#9fb0df' : '#556586',
      '--app-accent': '#2251ff',
      '--app-font-size': `${fontSize.value}px`,
      '--app-line-height': String(lineHeight.value),
      '--app-cursor-style': cursorStyle.value,
      '--term-bg': isDark ? '#020617' : '#020617',
      '--term-fg': isDark ? '#d6deeb' : '#d6deeb',
      '--term-cursor': isDark ? '#8fb9ff' : '#8fb9ff',
      '--term-cursor-accent': isDark ? '#020617' : '#020617',
      '--term-selection-bg': isDark ? '#3b82f655' : '#3b82f655',
      '--term-black': isDark ? '#3b4252' : '#3b4252',
      '--term-red': isDark ? '#e06c75' : '#e06c75',
      '--term-green': isDark ? '#98c379' : '#98c379',
      '--term-yellow': isDark ? '#e5c07b' : '#e5c07b',
      '--term-blue': isDark ? '#61afef' : '#61afef',
      '--term-magenta': isDark ? '#c678dd' : '#c678dd',
      '--term-cyan': isDark ? '#56b6c2' : '#56b6c2',
      '--term-white': isDark ? '#d6deeb' : '#d6deeb',
      '--term-bright-black': isDark ? '#4b5563' : '#4b5563',
      '--term-bright-red': isDark ? '#f87171' : '#f87171',
      '--term-bright-green': isDark ? '#86efac' : '#86efac',
      '--term-bright-yellow': isDark ? '#fde68a' : '#fde68a',
      '--term-bright-blue': isDark ? '#93c5fd' : '#93c5fd',
      '--term-bright-magenta': isDark ? '#e9d5ff' : '#e9d5ff',
      '--term-bright-cyan': isDark ? '#99f6e4' : '#99f6e4',
      '--term-bright-white': isDark ? '#f8fafc' : '#f8fafc',
      '--term-scrollbar-bg': isDark ? '#020617' : '#020617',
      '--term-scrollbar-thumb': isDark ? '#334155' : '#334155',
      '--term-scrollbar-thumb-hover': isDark ? '#475569' : '#475569',
      '--term-scrollbar-thumb-active': isDark ? '#64748b' : '#64748b',
    }
  })

  function normalizeCurrentSettings(): AppUiSettings {
    return {
      theme: toTheme(theme.value),
      fontSize: toFontSize(fontSize.value),
      lineHeight: toLineHeight(lineHeight.value),
      cursorStyle: toCursorStyle(cursorStyle.value),
    }
  }

  function applyCssVariables(): void {
    if (typeof document === 'undefined') {
      return
    }

    const rootStyle = document.documentElement.style
    for (const [name, value] of Object.entries(cssVars.value)) {
      rootStyle.setProperty(name, value)
    }
  }

  async function persistToElectronWithFallback(settings: AppUiSettings): Promise<void> {
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

  function persistAndApply(): void {
    const normalized = normalizeCurrentSettings()

    theme.value = normalized.theme
    fontSize.value = normalized.fontSize
    lineHeight.value = normalized.lineHeight
    cursorStyle.value = normalized.cursorStyle

    applyCssVariables()

    if (persistenceMode.value === 'electron') {
      saveSettingsToLocalStorage(normalized)
      void persistToElectronWithFallback(normalized)
      return
    }

    if (persistenceMode.value === 'local') {
      saveSettingsToLocalStorage(normalized)
    }
  }

  watch([theme, fontSize, lineHeight, cursorStyle], persistAndApply, { immediate: true })

  async function initializePersistence(): Promise<void> {
    if (!electronSettingsApi) {
      persistenceMode.value = 'local'
      persistAndApply()
      return
    }

    try {
      const migratedFlag = await readSettingValue(electronSettingsApi, MIGRATION_MARKER_KEY)
      const shouldMigrate = localState.hasStoredValue && migratedFlag !== 'true'

      if (shouldMigrate) {
        await saveSettingsToElectron(electronSettingsApi, normalizeCurrentSettings())
        await writeSettingValue(electronSettingsApi, MIGRATION_MARKER_KEY, 'true')
      }

      const persistedSettings = await loadSettingsFromElectron(electronSettingsApi)
      theme.value = persistedSettings.theme
      fontSize.value = persistedSettings.fontSize
      lineHeight.value = persistedSettings.lineHeight
      cursorStyle.value = persistedSettings.cursorStyle

      persistenceMode.value = 'electron'
    } catch {
      persistenceMode.value = 'local'
    }

    persistAndApply()
  }

  void initializePersistence()

  return {
    theme,
    fontSize,
    lineHeight,
    cursorStyle,
    cssVars,
  }
}

const appUiSettingsState = createAppUiSettingsState()

function useAppUiSettings() {
  return appUiSettingsState
}

export { useAppUiSettings }
export type AppUiSettingsState = ReturnType<typeof createAppUiSettingsState>
