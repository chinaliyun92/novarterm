import { computed, ref } from 'vue'

export type AppLanguage = 'en' | 'zh-CN'

type PersistenceMode = 'pending' | 'electron' | 'local'
type TranslationParams = Record<string, string | number>

const STORAGE_KEY = 'iterm.i18n.v1'
const LANGUAGE_SETTING_KEY = 'ui.language'
const DEFAULT_LANGUAGE: AppLanguage = 'en'

const messages: Record<AppLanguage, Record<string, string>> = {
  en: {
    'settings.title': 'Settings',
    'settings.close': 'Close',
    'settings.cancel': 'Cancel',
    'settings.tabsAria': 'Settings tabs',
    'settings.tab.general': 'General',
    'settings.tab.servers': 'Servers',
    'settings.tab.shortcuts': 'Shortcuts',
    'settings.tab.triggers': 'Triggers',
    'settings.general.language': 'Language',
    'settings.general.fontSize': 'Font Size',
    'settings.general.lineHeight': 'Line Height',
    'settings.general.update': 'Updates',
    'settings.language.english': 'English',
    'settings.language.chinese': 'Chinese',
    'settings.server.add': 'Add Server',
    'settings.server.localStorageHint': 'All data is stored locally on your computer.',
    'settings.server.loading': 'Loading...',
    'settings.server.empty': 'No servers',
    'settings.server.edit': 'Edit',
    'settings.server.delete': 'Delete',
    'settings.server.deleteConfirm': 'Delete server "{name}"?',
    'settings.server.createTitle': 'Add Server',
    'settings.server.editTitle': 'Edit Server',
    'settings.server.createConfirm': 'Create',
    'settings.server.editConfirm': 'Save',
    'settings.server.field.name': 'Name',
    'settings.server.field.host': 'Host',
    'settings.server.field.port': 'Port',
    'settings.server.field.username': 'Username',
    'settings.server.field.auth': 'Auth',
    'settings.server.field.password': 'Password',
    'settings.server.field.privateKeyPath': 'Private Key Path',
    'settings.server.field.passphrase': 'Key Passphrase',
    'settings.server.field.defaultDirectory': 'Default Directory',
    'settings.server.auth.password': 'Password',
    'settings.server.auth.privateKey': 'Private Key',
    'settings.server.error.portInvalid': 'Port must be a positive integer.',
    'settings.server.error.authInvalid': 'Auth must be password or privateKey.',
    'settings.server.error.nameRequired': 'Server name is required.',
    'settings.server.error.hostRequired': 'Host is required.',
    'settings.server.error.usernameRequired': 'Username is required.',
    'settings.server.error.passwordRequired': 'Password is required.',
    'settings.server.error.privateKeyRequired': 'Private key path is required for privateKey auth.',
    'settings.server.error.missingEditId': 'Missing server id for edit.',
    'settings.server.error.updateFailed': 'Failed to update server',
    'settings.server.error.createFailed': 'Failed to create server',
    'settings.server.error.deleteFailed': 'Failed to delete server',
    'settings.trigger.add': 'Add Trigger',
    'settings.trigger.empty': 'No triggers',
    'settings.trigger.patternPlaceholder': 'Listen pattern',
    'settings.trigger.sendPlaceholder': 'Auto send content',
    'settings.trigger.enabled': 'Enabled',
    'settings.trigger.delete': 'Delete',
    'settings.shortcut.field.keys': 'Shortcut',
    'settings.shortcut.field.action': 'Action',
    'settings.shortcut.field.scope': 'Scope',
    'settings.shortcut.scope.global': 'Global',
    'settings.shortcut.scope.terminal': 'Terminal',
    'settings.shortcut.scope.filePane': 'File Pane',
    'settings.shortcut.action.openSettings': 'Open/close settings dialog',
    'settings.shortcut.action.closePaneOrTab': 'Close focused pane or current tab',
    'settings.shortcut.action.newTab': 'Create new tab',
    'settings.shortcut.action.switchTab': 'Switch to tab 1-9',
    'settings.shortcut.action.toggleSidebar': 'Toggle left sidebar',
    'settings.shortcut.action.navigateFileParent': 'Navigate to parent directory',
    'settings.shortcut.action.zoomTerminalFont': 'Adjust terminal font size',
    'settings.update.check': 'Check for Updates',
    'settings.update.checking': 'Checking...',
    'settings.update.latest': 'You are already on the latest version.',
    'settings.update.opened': 'Opened release page for update.',
    'settings.update.unavailable': 'Update service is unavailable.',
    'settings.update.checkFailed': 'Failed to check updates',
    'terminal.menu.copy': 'Copy',
    'terminal.menu.paste': 'Paste',
    'terminal.menu.clear': 'Clear',
    'terminal.menu.splitHorizontal': 'Split Horizontal',
    'terminal.menu.splitVertical': 'Split Vertical',
    'terminal.menu.newTab': 'New Tab',
    'terminal.menu.newPane': 'New Pane',
    'terminal.menu.connectServer': 'Connect Server',
    'terminal.menu.loadingServers': 'Loading servers...',
    'terminal.menu.noServers': 'No servers',
    'terminal.menu.openInFileBrowserCurrentDir': 'Open in file pane',
    'file.menu.actionsAria': 'File action menu',
    'file.menu.createFile': 'Create File',
    'file.menu.createDirectory': 'Create Folder',
    'file.menu.rename': 'Rename',
    'file.menu.download': 'Download',
    'file.menu.delete': 'Delete',
    'file.toolbar.hiddenVisible': 'Hidden Files: Visible',
    'file.toolbar.hiddenHidden': 'Hidden Files: Hidden',
    'file.toolbar.hideHidden': 'Hide Hidden',
    'file.toolbar.showHidden': 'Show Hidden',
    'file.toolbar.parentDirectory': 'Parent Directory',
    'file.toolbar.refresh': 'Refresh',
    'file.toolbar.createFile': 'New File',
    'file.toolbar.createDirectory': 'New Folder',
    'file.toolbar.upload': 'Upload',
  },
  'zh-CN': {
    'settings.title': '设置',
    'settings.close': '关闭',
    'settings.cancel': '取消',
    'settings.tabsAria': '设置标签',
    'settings.tab.general': '通用',
    'settings.tab.servers': '服务器',
    'settings.tab.shortcuts': '快捷键',
    'settings.tab.triggers': '触发器',
    'settings.general.language': '语言',
    'settings.general.fontSize': '字号',
    'settings.general.lineHeight': '行高',
    'settings.general.update': '更新',
    'settings.language.english': '英文',
    'settings.language.chinese': '中文',
    'settings.server.add': '新增服务器',
    'settings.server.localStorageHint': '所有数据都保存在您的电脑上',
    'settings.server.loading': '加载中...',
    'settings.server.empty': '暂无服务器',
    'settings.server.edit': '编辑',
    'settings.server.delete': '删除',
    'settings.server.deleteConfirm': '确认删除服务器「{name}」吗？',
    'settings.server.createTitle': '新增服务器',
    'settings.server.editTitle': '编辑服务器',
    'settings.server.createConfirm': '创建',
    'settings.server.editConfirm': '保存',
    'settings.server.field.name': '名称',
    'settings.server.field.host': '主机',
    'settings.server.field.port': '端口',
    'settings.server.field.username': '用户名',
    'settings.server.field.auth': '认证',
    'settings.server.field.password': '密码',
    'settings.server.field.privateKeyPath': '私钥路径',
    'settings.server.field.passphrase': '私钥口令',
    'settings.server.field.defaultDirectory': '默认目录',
    'settings.server.auth.password': '密码',
    'settings.server.auth.privateKey': '私钥',
    'settings.server.error.portInvalid': '端口必须是正整数。',
    'settings.server.error.authInvalid': '认证方式仅支持 password 或 privateKey。',
    'settings.server.error.nameRequired': '服务器名称不能为空。',
    'settings.server.error.hostRequired': '主机地址不能为空。',
    'settings.server.error.usernameRequired': '用户名不能为空。',
    'settings.server.error.passwordRequired': '密码不能为空。',
    'settings.server.error.privateKeyRequired': '私钥认证必须提供私钥文件路径。',
    'settings.server.error.missingEditId': '缺少待编辑服务器 ID。',
    'settings.server.error.updateFailed': '更新服务器失败',
    'settings.server.error.createFailed': '新增服务器失败',
    'settings.server.error.deleteFailed': '删除服务器失败',
    'settings.trigger.add': '新增触发器',
    'settings.trigger.empty': '暂无触发器',
    'settings.trigger.patternPlaceholder': '监听字符',
    'settings.trigger.sendPlaceholder': '自动发送内容',
    'settings.trigger.enabled': '启用',
    'settings.trigger.delete': '删除',
    'settings.shortcut.field.keys': '快捷键',
    'settings.shortcut.field.action': '作用',
    'settings.shortcut.field.scope': '范围',
    'settings.shortcut.scope.global': '全局',
    'settings.shortcut.scope.terminal': '终端',
    'settings.shortcut.scope.filePane': '文件面板',
    'settings.shortcut.action.openSettings': '打开/关闭设置弹窗',
    'settings.shortcut.action.closePaneOrTab': '关闭当前分屏或当前标签',
    'settings.shortcut.action.newTab': '新建标签',
    'settings.shortcut.action.switchTab': '切换到第 1-9 个标签',
    'settings.shortcut.action.toggleSidebar': '显示/隐藏左侧栏',
    'settings.shortcut.action.navigateFileParent': '返回上级目录',
    'settings.shortcut.action.zoomTerminalFont': '调整终端字号',
    'settings.update.check': '检查更新',
    'settings.update.checking': '检查中...',
    'settings.update.latest': '您的版本已经是最新版本。',
    'settings.update.opened': '已打开更新下载页面。',
    'settings.update.unavailable': '更新服务不可用。',
    'settings.update.checkFailed': '检查更新失败',
    'terminal.menu.copy': '复制',
    'terminal.menu.paste': '粘贴',
    'terminal.menu.clear': '清屏',
    'terminal.menu.splitHorizontal': '水平分屏',
    'terminal.menu.splitVertical': '垂直分屏',
    'terminal.menu.newTab': '新建标签',
    'terminal.menu.newPane': '新建分屏',
    'terminal.menu.connectServer': '连接服务器',
    'terminal.menu.loadingServers': '加载服务器...',
    'terminal.menu.noServers': '暂无服务器',
    'terminal.menu.openInFileBrowserCurrentDir': '在文件面板中打开',
    'file.menu.actionsAria': '文件操作菜单',
    'file.menu.createFile': '新建文件',
    'file.menu.createDirectory': '新建文件夹',
    'file.menu.rename': '重命名',
    'file.menu.download': '下载',
    'file.menu.delete': '删除',
    'file.toolbar.hiddenVisible': '隐藏文件：显示中',
    'file.toolbar.hiddenHidden': '隐藏文件：已隐藏',
    'file.toolbar.hideHidden': '隐藏文件',
    'file.toolbar.showHidden': '显示隐藏',
    'file.toolbar.parentDirectory': '上级目录',
    'file.toolbar.refresh': '刷新',
    'file.toolbar.createFile': '新建文件',
    'file.toolbar.createDirectory': '新建文件夹',
    'file.toolbar.upload': '上传',
  },
}

function normalizeLanguage(value: unknown): AppLanguage {
  if (typeof value !== 'string') {
    return DEFAULT_LANGUAGE
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
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

function loadLanguageFromLocalStorage(): AppLanguage {
  if (typeof window === 'undefined') {
    return DEFAULT_LANGUAGE
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_LANGUAGE
    }
    return normalizeLanguage(raw)
  } catch {
    return DEFAULT_LANGUAGE
  }
}

function saveLanguageToLocalStorage(language: AppLanguage): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // ignore storage failures
  }
}

async function readLanguageFromElectron(api: SettingsApi): Promise<AppLanguage | null> {
  const result = await api.get(LANGUAGE_SETTING_KEY)
  if (!result.ok) {
    throw new Error(result.error.message)
  }

  const value = result.data.setting?.value
  if (!value) {
    return null
  }
  return normalizeLanguage(value)
}

async function writeLanguageToElectron(api: SettingsApi, language: AppLanguage): Promise<void> {
  const result = await api.set(LANGUAGE_SETTING_KEY, language)
  if (!result.ok) {
    throw new Error(result.error.message)
  }
}

function interpolate(template: string, params?: TranslationParams): string {
  if (!params) {
    return template
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    const value = params[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

function createI18nState() {
  const language = ref<AppLanguage>(loadLanguageFromLocalStorage())
  const persistenceMode = ref<PersistenceMode>('pending')
  const api = getElectronSettingsApi()

  const locale = computed<AppLanguage>({
    get: () => language.value,
    set: (next) => {
      void setLanguage(next)
    },
  })

  const availableLanguages = computed(() => ['en', 'zh-CN'] as AppLanguage[])

  function t(key: string, params?: TranslationParams): string {
    const current = messages[language.value][key]
    if (current) {
      return interpolate(current, params)
    }

    const fallback = messages.en[key] ?? key
    return interpolate(fallback, params)
  }

  async function setLanguage(nextLanguage: AppLanguage): Promise<void> {
    const normalized = normalizeLanguage(nextLanguage)
    language.value = normalized
    saveLanguageToLocalStorage(normalized)

    if (!api) {
      persistenceMode.value = 'local'
      return
    }

    try {
      await writeLanguageToElectron(api, normalized)
      persistenceMode.value = 'electron'
    } catch {
      persistenceMode.value = 'local'
    }
  }

  async function hydrateFromElectron(): Promise<void> {
    if (!api) {
      persistenceMode.value = 'local'
      return
    }

    try {
      const loaded = await readLanguageFromElectron(api)
      if (loaded) {
        language.value = loaded
        saveLanguageToLocalStorage(loaded)
      } else {
        await writeLanguageToElectron(api, language.value)
      }
      persistenceMode.value = 'electron'
    } catch {
      persistenceMode.value = 'local'
    }
  }

  void hydrateFromElectron()

  return {
    locale,
    availableLanguages,
    persistenceMode: computed(() => persistenceMode.value),
    t,
    setLanguage,
  }
}

let i18nState: ReturnType<typeof createI18nState> | null = null

export function useI18n() {
  if (!i18nState) {
    i18nState = createI18nState()
  }
  return i18nState
}
