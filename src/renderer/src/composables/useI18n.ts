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
    'common.confirm': 'Confirm',
    'common.processing': 'Processing...',
    'settings.cancel': 'Cancel',
    'settings.tabsAria': 'Settings tabs',
    'settings.tab.general': 'General',
    'settings.tab.servers': 'Servers',
    'settings.tab.shortcuts': 'Shortcuts',
    'settings.tab.triggers': 'Triggers',
    'settings.tab.ai': 'AI',
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
    'settings.trigger.autoSend': 'Auto Send',
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
    'settings.shortcut.action.toggleAiCommandBar': 'Open/close AI command bar',
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
    'settings.ai.platformName': 'Platform Name',
    'settings.ai.apiUrl': 'API URL',
    'settings.ai.apiKey': 'API Key',
    'settings.ai.model': 'Model',
    'settings.ai.modelPlaceholder': 'e.g. gpt-4',
    'settings.ai.add': 'Add Platform',
    'settings.ai.createTitle': 'Add AI Platform',
    'settings.ai.editTitle': 'Edit AI Platform',
    'settings.ai.createConfirm': 'Create',
    'settings.ai.editConfirm': 'Save',
    'settings.ai.empty': 'No AI platforms',
    'settings.ai.localStorageHint': 'All data is stored locally on your computer.',
    'settings.ai.deleteConfirm': 'Delete platform "{name}"?',
    'settings.ai.deleteFailed': 'Failed to delete platform.',
    'settings.ai.error.fieldsRequired': 'Platform name, API URL and API Key are required.',
    'settings.ai.error.missingEditId': 'Missing platform id for edit.',
    'settings.ai.save': 'Save',
    'settings.ai.saving': 'Saving...',
    'settings.ai.saved': 'Saved.',
    'settings.ai.saveFailed': 'Save failed.',
    'settings.ai.loadFailed': 'Failed to load settings.',
    'settings.ai.unavailable': 'Settings unavailable.',
    'terminal.menu.copy': 'Copy',
    'terminal.menu.aiExplain': 'AI Explain',
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
    'terminal.tabs.closeAria': 'Close tab',
    'terminal.tabs.createTitle': 'Create tab',
    'terminal.tabs.maxTitle': 'Maximum {max} tabs',
    'terminal.downloadCenter.buttonAria': 'Toggle download center',
    'terminal.downloadCenter.buttonTitle': 'Transfer center',
    'terminal.downloadCenter.buttonLabel': 'Transfers',
    'terminal.downloadCenter.title': 'Transfer Center',
    'terminal.downloadCenter.clear': 'Clear all',
    'terminal.downloadCenter.empty': 'No transfer records yet.',
    'terminal.downloadCenter.status.download.started': 'Starting',
    'terminal.downloadCenter.status.download.progress': 'Downloading',
    'terminal.downloadCenter.status.download.completed': 'Download completed',
    'terminal.downloadCenter.status.download.failed': 'Download failed',
    'terminal.downloadCenter.status.upload.started': 'Starting',
    'terminal.downloadCenter.status.upload.progress': 'Uploading',
    'terminal.downloadCenter.status.upload.completed': 'Upload completed',
    'terminal.downloadCenter.status.upload.failed': 'Upload failed',
    'terminal.downloadCenter.direction.download': 'Download',
    'terminal.downloadCenter.direction.upload': 'Upload',
    'terminal.downloadCenter.progressUnknown': '{transferred} transferred',
    'terminal.downloadCenter.remotePathLabel': 'Remote:',
    'terminal.downloadCenter.localPathLabel': 'Saved to:',
    'terminal.downloadCenter.openDirectory': 'Open Folder',
    'terminal.pane.label.local': 'local',
    'terminal.pane.label.remote': 'remote',
    'terminal.pane.closeAria': 'Close current pane',
    'terminal.pane.closeTitle': 'Close (Command+W)',
    'terminal.pane.resizeHeightAria': 'Drag to resize height',
    'terminal.pane.resizeWidthAria': 'Drag to resize width',
    'terminal.pane.emptyUnavailable': 'Pane session is unavailable.',
    'terminal.fileBrowser.title': 'File Browser',
    'terminal.layout.error.splitLimitReached': 'Split limit reached (max {max} panes)',
    'terminal.layout.error.createPaneSessionFailed': 'Failed to create new pane session',
    'terminal.layout.error.tabLimitReached': 'Tab limit reached (max {max} tabs)',
    'terminal.split.error.inheritRemoteServerUnavailable':
      'Split failed to inherit remote server: source server is unavailable',
    'terminal.server.error.loadServersFailed': 'Load servers failed: {detail}',
    'terminal.server.error.connectFailed': 'Failed to connect server',
    'terminal.server.error.invalidServerId': 'Invalid server id',
    'terminal.server.error.serverNotFound': 'Server #{id} not found',
    'terminal.server.error.notLocalShell': 'Current session is not a local shell',
    'terminal.server.error.sendSshCommandFailed': 'Failed to send ssh command',
    'terminal.history.searchPrompt': 'History search: enter keyword (leave empty for latest)',
    'terminal.history.promptUnsupported': 'History search is unavailable in this environment (prompt is not supported)',
    'terminal.history.searchKeyword': 'keyword "{keyword}"',
    'terminal.history.searchRecent': 'latest command',
    'terminal.history.searchNotFound': 'No match found for {label}',
    'terminal.paste.confirm.escapePathLike':
      'Detected possible file path with spaces/special characters.\nOK: escape for shell and paste\nCancel: paste original text',
    'terminal.paste.confirm.multiline':
      'Detected multiline paste ({count} lines).\nOK: continue pasting\nCancel: abort this paste',
    'terminal.fileBrowser.error.sourceSessionUnavailable': 'Source session is unavailable',
    'terminal.fileBrowser.error.cwdUnavailable': 'Current working directory is unavailable',
    'terminal.fileBrowser.error.createPaneFailed': 'Failed to create file browser pane',
    'terminal.fileBrowser.error.unsavedSshTarget':
      'Cannot open remote file pane: current SSH target is not in saved servers.',
    'terminal.fileBrowser.error.sftpHelperNotReady': 'Open file browser failed: SFTP helper connection is not ready',
    'terminal.upload.error.unsavedSshTarget':
      'Upload failed: current SSH target is not in saved servers, unable to establish SFTP channel.',
    'terminal.upload.error.sftpHelperNotReady': 'Upload failed: SFTP helper connection is not ready',
    'terminal.upload.error.activeSessionUnavailable': 'Upload failed: active terminal session is unavailable',
    'terminal.upload.error.sftpApiUnavailable':
      'Upload failed: window.electronAPI.ssh.sftp.list/put is unavailable',
    'terminal.upload.error.cwdUnavailable': 'Upload failed: current working directory is unavailable',
    'terminal.upload.confirm.retryFailedFile':
      'File upload failed: {fileName}\nReason: {reason}\nOK: retry once\nCancel: skip this file and continue',
    'terminal.bridge.error.unavailable': 'window.electronAPI.terminal is unavailable',
    'terminal.bridge.error.onDataUnavailable': 'window.electronAPI.terminal.onData is unavailable',
    'terminal.session.error.activeUnavailable': 'Active terminal session is unavailable',
    'terminal.tempFile.error.pathUnavailable': 'Temp file write failed: path is unavailable',
    'terminal.aiBar.resizeHandleTitle': 'Drag to resize',
    'terminal.aiBar.title': 'Ask AI',
    'terminal.aiBar.modelSelectAria': 'Model selector',
    'terminal.aiBar.modelDefault': 'Default',
    'terminal.aiBar.platformFallback': 'Platform',
    'terminal.aiBar.closeAria': 'Close',
    'terminal.aiBar.userRole': 'You',
    'terminal.aiBar.assistantRole': 'AI',
    'terminal.aiBar.action.run': 'run',
    'terminal.aiBar.action.insert': 'insert',
    'terminal.aiBar.action.expand': 'expand',
    'terminal.aiBar.loading': 'Requesting...',
    'terminal.aiBar.busy': 'AI is still responding. Please send again after it finishes.',
    'terminal.aiBar.error.requestFailed': 'Request failed ({status}): {detail}',
    'terminal.aiBar.error.default': 'Request failed. Please try again later.',
    'terminal.aiBar.error.streamUnavailable': 'Unable to read response stream',
    'terminal.aiBar.error.proxyAuthFailed': 'Proxy auth failed ({status}): {detail}',
    'terminal.aiBar.error.quotaExceeded': 'Daily request limit reached. Please try again tomorrow.',
    'terminal.aiBar.error.quotaExceededWithLimit':
      'Daily request limit reached ({limit}/day). Please try again tomorrow.',
    'terminal.aiBar.error.rateLimited': 'Too many requests. Please try again later.',
    'terminal.aiBar.error.rateLimitedWithRetry':
      'Too many requests. Please retry in {seconds} seconds.',
    'terminal.aiBar.error.quotaExceededActionHint':
      'You can add a custom model for a better experience.',
    'terminal.aiBar.error.addModelNow': 'Add now',
    'terminal.debugHint.detected': 'Potential error detected in terminal output.',
    'terminal.debugHint.detectedWithExitCode': 'Command failed (exit code {code})',
    'terminal.debugHint.commandFailed': 'Command failed',
    'terminal.debugHint.explainAction': 'Explain Error',
    'terminal.debugHint.debugAction': 'Debug With AI',
    'terminal.debugHint.action': 'Debug With AI',
    'terminal.debugHint.dismissAria': 'Dismiss debug suggestion',
    'terminal.debugHint.userMessage': 'Debug this error',
    'terminal.debugHint.explainUserMessage': 'Explain this error',
    'terminal.debugHint.terminalOutput': 'Terminal Output',
    'terminal.debugHint.command': 'Command',
    'terminal.debugHint.noOutput': '(No terminal output captured)',
    'terminal.debugHint.noCommand': '(No command captured)',
    'terminal.debugHint.openingAnalysis': 'Opening AI analysis...',
    'terminal.debugHint.linkExpired': 'This action link has expired. Run the command again to regenerate it.',
    'terminal.debugHint.linkAlreadyUsed': 'This action link has already been used.',
    'terminal.debugHint.busy': 'AI is still responding. Please try again shortly.',
    'terminal.inlineAi.loading': 'loading...',
    'terminal.inlineAi.commandLabel': 'AI command:',
    'terminal.inlineAi.insertAction': 'Insert',
    'terminal.inlineAi.runAction': 'Run',
    'terminal.inlineAi.error': 'AI command generation failed: {reason}',
    'terminal.inlineAi.emptyPrompt': 'Please enter prompt text after ">"',
    'terminal.inlineAi.busy': 'AI command generation is in progress. Please wait.',
    'terminal.inlineAi.invalidCommandReply': 'No executable command was returned.',
    'terminal.inlineAi.linkExpired': 'This command action link has expired.',
    'terminal.aiBar.inputPlaceholder': 'Type your question and press Enter...',
    'file.menu.actionsAria': 'File action menu',
    'file.menu.createFile': 'Create File',
    'file.menu.createDirectory': 'Create Folder',
    'file.menu.rename': 'Rename',
    'file.menu.download': 'Download',
    'file.menu.extract': 'Extract',
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
    'file.toolbar.uploadDirectory': 'Upload Folder',
    'file.emptyDirectory': 'Current directory is empty',
    'file.loading': 'Loading...',
    'file.error.currentPathUnavailable': 'Current path is unavailable. Please refresh first.',
    'file.confirm.deleteEntry': 'Delete "{name}"?',
    'file.dialog.confirmDefault': 'Confirm',
    'file.dialog.createFile.title': 'Create File',
    'file.dialog.createFile.placeholder': 'Enter new file name',
    'file.dialog.createFile.confirm': 'Create',
    'file.dialog.createFile.nameRequired': 'File name is required.',
    'file.dialog.createDirectory.title': 'Create Folder',
    'file.dialog.createDirectory.placeholder': 'Enter new folder name',
    'file.dialog.createDirectory.confirm': 'Create',
    'file.dialog.createDirectory.nameRequired': 'Folder name is required.',
    'file.dialog.rename.title': 'Rename',
    'file.dialog.rename.placeholder': 'Enter new name',
    'file.dialog.rename.confirm': 'Save',
    'file.dialog.rename.nameRequired': 'Name is required.',
    'file.message.createdFile': 'Created file: {name}',
    'file.message.createdDirectory': 'Created folder: {name}',
    'file.message.renamed': 'Renamed to: {name}',
    'file.message.deleted': 'Deleted: {name}',
    'file.message.downloadCompleted': 'Download complete: {name}',
    'file.message.extractCompleted': 'Extracted: {name}',
    'file.local.error.apiUnavailable': 'Local file feature is unavailable. Please restart the app and try again.',
    'file.local.error.readDirectoryFailed': 'Failed to read directory',
    'file.local.error.createFileFailed': 'Failed to create file',
    'file.local.error.createDirectoryFailed': 'Failed to create folder',
    'file.local.error.renameFailed': 'Failed to rename',
    'file.local.error.deleteFailed': 'Failed to delete',
    'file.local.error.currentPathUnavailable': 'Current path is unavailable. Please refresh first.',
    'file.local.error.noUploadPathDetected': 'No local paths detected for upload.',
    'file.local.error.uploadFailed': 'Upload failed',
    'file.local.confirm.uploadPaths': 'Upload {count} file(s)/folder(s) to "{path}"?',
    'file.remote.error.sessionRequired': 'Please select a connected session',
    'file.remote.error.noUploadPathDetected':
      'No local files/folders detected for upload. Please verify the drag source is accessible.',
    'file.remote.error.noUploadDirectoryDetected':
      'No folder files detected for upload. Please verify the folder is accessible.',
    'file.remote.error.downloadFileOnly': 'Only file download is supported; directory download is not supported.',
    'file.remote.error.extractZipOnly': 'Only .zip file extraction is supported.',
    'file.remote.error.uploadConflictDirectory':
      'Upload conflict: "{path}" is an existing directory and cannot be overwritten as a file.',
    'file.remote.upload.skippedCount': '{count} unavailable item(s) will be skipped.',
    'file.remote.confirm.uploadFiles': 'Upload {count} file(s) to "{path}"?{skippedText}',
    'file.remote.confirm.uploadDirectory': 'Upload directory ({count} files) to "{path}"?{skippedText}',
    'file.remote.confirm.extractZip': 'Extract "{name}" now?',
    'file.remote.dialog.saveTitle': 'Save File: {name}',
    'file.remote.dialog.saveButton': 'Save',
    'file.inspector.title': 'File Preview / Basic Edit',
    'file.inspector.currentEncoding': 'Current encoding: {encoding}',
    'file.inspector.saveEncoding': 'Save encoding: {encoding}',
    'file.inspector.label.noFileSelected': 'No file selected',
    'file.inspector.label.directorySelected': '{name} (directory)',
    'file.inspector.hint.binaryPreviewUnsupported': 'This file appears to be binary and cannot be previewed.',
    'file.inspector.hint.readFileApiUnavailable':
      'ssh.sftp.readFile is unavailable in this environment. Please expose it in preload and retry.',
    'file.inspector.notice.largeLogTail':
      'Large file protection: file size {size}, showing only the last {lineLimit} lines (up to {charLimit} chars).',
    'file.inspector.notice.largeTextHead':
      'Large file protection: file size {size}, showing only the first {charLimit} chars.',
    'file.inspector.error.readFileFailed': 'Failed to read remote file',
    'file.inspector.error.jsonParseFailed': 'JSON parse failed',
    'file.inspector.error.sessionUnavailableForSave': 'Missing active session, cannot save file.',
    'file.inspector.error.writeTextApiUnavailable': 'ssh.sftp.writeText is unavailable in this environment.',
    'file.inspector.error.saveFailed': 'Save failed',
    'file.inspector.error.saveAsFailed': 'Save As failed',
    'file.inspector.error.invalidSaveAsPath': 'Invalid Save As path.',
    'file.inspector.confirm.reloadDiscardChanges':
      'This file has unsaved changes. Reload and discard local changes?',
    'file.inspector.confirm.encodingWriteback':
      'Detected file encoding GB18030.\nIt will be written back as UTF-8 and may change the original encoding.\nContinue {action}?',
    'file.inspector.prompt.saveAsPath': 'Enter Save As path:',
    'file.inspector.message.saved': 'Saved: {path}',
    'file.inspector.message.savedAs': 'Saved As: {path}',
    'file.inspector.message.unsavedChanges': 'This file has unsaved changes',
    'file.inspector.action.reload': 'Reload',
    'file.inspector.action.preview': 'Preview',
    'file.inspector.action.edit': 'Edit',
    'file.inspector.action.save': 'Save',
    'file.inspector.action.saving': 'Saving...',
    'file.inspector.action.saveAs': 'Save As',
    'file.inspector.action.autoScrollBottom': 'Auto-scroll to bottom',
    'file.inspector.action.scrollBottom': 'Scroll to bottom',
    'file.inspector.placeholder.selectSession': 'Select a session before viewing files.',
    'file.inspector.placeholder.selectFile': 'Select a file from the file list to preview.',
    'file.inspector.placeholder.directoryUnsupported': 'A directory is selected. Content preview is unavailable.',
    'file.inspector.placeholder.loading': 'Loading file content...',
    'file.inspector.placeholder.emptyImage': 'Image content is empty.',
    'file.inspector.placeholder.editor': 'Editable text content. Supports Save and Save As.',
    'file.inspector.placeholder.unsupportedPreview': 'Preview is not supported for this file type.',
    'file.upload.progressTitle': 'Uploading',
    'file.upload.progressPreparing': 'Preparing upload...',
    'file.upload.completed': 'Upload completed: {count} file(s)',
    'file.upload.directoryCompleted': 'Folder upload completed: {count} file(s)',
    'file.remoteState.error.sessionIdRequired': 'Missing sessionId; cannot perform remote file operation.',
    'file.remoteState.error.loadRemoteDirectoryFailed': 'Failed to load remote directory',
    'file.remoteState.error.loadDirectoryTreeFailed': 'Failed to load directory tree',
    'file.remoteState.error.loadDirectoryFailed': 'Failed to load directory',
    'file.remoteState.error.writeTextApiUnavailable': 'ssh.sftp.writeText is unavailable in this environment.',
    'file.remoteState.error.createFileFailed': 'Failed to create file',
    'file.remoteState.error.createDirectoryFailed': 'Failed to create folder',
    'file.remoteState.error.deleteFailed': 'Failed to delete',
    'file.remoteState.error.renameFailed': 'Failed to rename',
    'file.remoteState.error.uploadFailed': 'Upload failed',
    'file.remoteState.error.downloadFailed': 'Download failed',
    'file.remoteState.error.extractZipApiUnavailable':
      'ssh.sftp.extractZip is unavailable in this environment.',
    'file.remoteState.error.extractZipFailed': 'Failed to extract zip file',
    'server.sidebar.state.disconnected': 'Disconnected',
    'server.sidebar.state.connecting': 'Connecting',
    'server.sidebar.state.connected': 'Connected',
    'server.sidebar.state.disconnecting': 'Disconnecting',
    'server.sidebar.state.reconnecting': 'Reconnecting',
    'server.sidebar.state.failed': 'Failed',
    'server.sidebar.error.serverApiUnavailable':
      'Desktop bridge is not ready: electronAPI.server is unavailable. Please restart the app.',
    'server.sidebar.error.sshApiUnavailable':
      'Desktop bridge is not ready: electronAPI.ssh is unavailable. Please restart the app.',
    'server.sidebar.error.loadServersFailed': 'Failed to load servers',
    'server.sidebar.error.loadServerDataFailed': 'Failed to load server data',
    'server.sidebar.error.createServerFailed': 'Failed to create server',
    'server.sidebar.error.updateServerFailed': 'Failed to update server',
    'server.sidebar.error.deleteServerFailed': 'Failed to delete server',
    'server.sidebar.error.connectFailed': 'Failed to connect server',
    'server.sidebar.error.noBoundServerForSession': 'No bound server found for current session',
    'server.sidebar.error.disconnectFailed': 'Failed to disconnect',
    'server.sidebar.error.reconnectFailed': 'Failed to reconnect',
    'server.sidebar.error.readStatusFailed': 'Failed to read connection status',
    'server.sidebar.error.recordRecentDirectoryFailed': 'Failed to record recent directory',
    'terminal.filePane.sourceSelectAria': 'File source selector',
    'terminal.filePane.sourceLocal': 'Local',
    'terminal.filePane.sourceLoadingServers': 'Loading servers...',
    'terminal.filePane.sourceUnknownRemote': 'Remote (bound session unavailable)',
    'terminal.filePane.sourceServerMissing': 'Selected server no longer exists.',
    'terminal.filePane.sourceSwitchFailed': 'Failed to switch file source: {detail}',
    'terminal.filePane.sourceSwitchFailedFallback': 'switch failed',
    'terminal.filePane.sourceLoadFailed': 'Failed to load server list: {detail}',
    'terminal.filePane.sourceLoadFailedFallback': 'load failed',
  },
  'zh-CN': {
    'settings.title': '设置',
    'settings.close': '关闭',
    'common.confirm': '确定',
    'common.processing': '处理中...',
    'settings.cancel': '取消',
    'settings.tabsAria': '设置标签',
    'settings.tab.general': '通用',
    'settings.tab.servers': '服务器',
    'settings.tab.shortcuts': '快捷键',
    'settings.tab.triggers': '触发器',
    'settings.tab.ai': 'AI',
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
    'settings.trigger.autoSend': '自动发送',
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
    'settings.shortcut.action.toggleAiCommandBar': '打开/关闭 AI 命令栏',
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
    'settings.ai.platformName': '平台名称',
    'settings.ai.apiUrl': '接口地址',
    'settings.ai.apiKey': 'API Key',
    'settings.ai.model': '模型',
    'settings.ai.modelPlaceholder': '如 gpt-4',
    'settings.ai.add': '添加平台',
    'settings.ai.createTitle': '添加 AI 平台',
    'settings.ai.editTitle': '编辑 AI 平台',
    'settings.ai.createConfirm': '创建',
    'settings.ai.editConfirm': '保存',
    'settings.ai.empty': '暂无 AI 平台',
    'settings.ai.localStorageHint': '所有数据均保存在本机。',
    'settings.ai.deleteConfirm': '确定删除平台「{name}」吗？',
    'settings.ai.deleteFailed': '删除平台失败。',
    'settings.ai.error.fieldsRequired': '平台名称、接口地址和 API Key 为必填。',
    'settings.ai.error.missingEditId': '编辑时缺少平台 id。',
    'settings.ai.save': '保存',
    'settings.ai.saving': '保存中...',
    'settings.ai.saved': '已保存。',
    'settings.ai.saveFailed': '保存失败。',
    'settings.ai.loadFailed': '加载设置失败。',
    'settings.ai.unavailable': '设置不可用。',
    'terminal.menu.copy': '复制',
    'terminal.menu.aiExplain': 'AI 解释',
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
    'terminal.tabs.closeAria': '关闭标签',
    'terminal.tabs.createTitle': '新建标签',
    'terminal.tabs.maxTitle': '最多 {max} 个标签页',
    'terminal.downloadCenter.buttonAria': '切换下载中心',
    'terminal.downloadCenter.buttonTitle': '传输中心',
    'terminal.downloadCenter.buttonLabel': '传输',
    'terminal.downloadCenter.title': '传输中心',
    'terminal.downloadCenter.clear': '清除记录',
    'terminal.downloadCenter.empty': '暂无传输记录。',
    'terminal.downloadCenter.status.download.started': '准备中',
    'terminal.downloadCenter.status.download.progress': '下载中',
    'terminal.downloadCenter.status.download.completed': '下载完成',
    'terminal.downloadCenter.status.download.failed': '下载失败',
    'terminal.downloadCenter.status.upload.started': '准备中',
    'terminal.downloadCenter.status.upload.progress': '上传中',
    'terminal.downloadCenter.status.upload.completed': '上传完成',
    'terminal.downloadCenter.status.upload.failed': '上传失败',
    'terminal.downloadCenter.direction.download': '下载',
    'terminal.downloadCenter.direction.upload': '上传',
    'terminal.downloadCenter.progressUnknown': '已传输 {transferred}',
    'terminal.downloadCenter.remotePathLabel': '远程：',
    'terminal.downloadCenter.localPathLabel': '保存到：',
    'terminal.downloadCenter.openDirectory': '打开目录',
    'terminal.pane.label.local': 'local',
    'terminal.pane.label.remote': 'remote',
    'terminal.pane.closeAria': '关闭当前终端',
    'terminal.pane.closeTitle': '关闭 (Command+W)',
    'terminal.pane.resizeHeightAria': '拖动调整高度',
    'terminal.pane.resizeWidthAria': '拖动调整宽度',
    'terminal.pane.emptyUnavailable': '分屏会话不可用。',
    'terminal.fileBrowser.title': '文件面板',
    'terminal.layout.error.splitLimitReached': '分屏数量已达上限（最多 {max} 个）',
    'terminal.layout.error.createPaneSessionFailed': '创建新分屏会话失败',
    'terminal.layout.error.tabLimitReached': '标签数量已达上限（最多 {max} 个）',
    'terminal.split.error.inheritRemoteServerUnavailable': '分屏继承远程服务器失败：来源服务器不可用',
    'terminal.server.error.loadServersFailed': '加载服务器失败：{detail}',
    'terminal.server.error.connectFailed': '连接服务器失败',
    'terminal.server.error.invalidServerId': '无效的服务器 ID',
    'terminal.server.error.serverNotFound': '未找到服务器 #{id}',
    'terminal.server.error.notLocalShell': '当前会话不是本地 shell',
    'terminal.server.error.sendSshCommandFailed': '发送 ssh 命令失败',
    'terminal.history.searchPrompt': '历史搜索：输入关键词（留空匹配最近一条）',
    'terminal.history.promptUnsupported': '历史搜索在此环境不可用（不支持 prompt 弹窗）',
    'terminal.history.searchKeyword': '关键词 \"{keyword}\"',
    'terminal.history.searchRecent': '最近命令',
    'terminal.history.searchNotFound': '未找到{label}的匹配项',
    'terminal.paste.confirm.escapePathLike':
      '检测到可能是文件路径且包含空格或特殊字符。\n确定：自动做 shell 转义后粘贴\n取消：保持原文粘贴',
    'terminal.paste.confirm.multiline': '检测到多行粘贴（{count} 行）。\n确定：继续粘贴\n取消：终止本次粘贴',
    'terminal.fileBrowser.error.sourceSessionUnavailable': '来源会话不可用',
    'terminal.fileBrowser.error.cwdUnavailable': '当前工作目录不可用',
    'terminal.fileBrowser.error.createPaneFailed': '创建文件面板失败',
    'terminal.fileBrowser.error.unsavedSshTarget': '无法打开远程文件面板：当前 SSH 目标不在已保存服务器列表中。',
    'terminal.fileBrowser.error.sftpHelperNotReady': '打开文件面板失败：SFTP 辅助连接尚未就绪',
    'terminal.upload.error.unsavedSshTarget':
      '上传失败：当前 SSH 目标不在已保存服务器列表中，无法建立 SFTP 通道。',
    'terminal.upload.error.sftpHelperNotReady': '上传失败：SFTP 辅助连接尚未就绪',
    'terminal.upload.error.activeSessionUnavailable': '上传失败：当前终端会话不可用',
    'terminal.upload.error.sftpApiUnavailable': '上传失败：window.electronAPI.ssh.sftp.list/put 不可用',
    'terminal.upload.error.cwdUnavailable': '上传失败：当前工作目录不可用',
    'terminal.upload.confirm.retryFailedFile':
      '文件上传失败：{fileName}\n原因：{reason}\n确定：重试一次\n取消：跳过该文件并继续',
    'terminal.bridge.error.unavailable': 'window.electronAPI.terminal 不可用',
    'terminal.bridge.error.onDataUnavailable': 'window.electronAPI.terminal.onData 不可用',
    'terminal.session.error.activeUnavailable': '当前终端会话不可用',
    'terminal.tempFile.error.pathUnavailable': '写入临时文件失败：路径不可用',
    'terminal.aiBar.resizeHandleTitle': '拖动调整高度',
    'terminal.aiBar.title': '问 AI',
    'terminal.aiBar.modelSelectAria': '模型选择',
    'terminal.aiBar.modelDefault': '默认',
    'terminal.aiBar.platformFallback': '平台',
    'terminal.aiBar.closeAria': '关闭',
    'terminal.aiBar.userRole': '你',
    'terminal.aiBar.assistantRole': 'AI',
    'terminal.aiBar.action.run': '运行',
    'terminal.aiBar.action.insert': '插入',
    'terminal.aiBar.action.expand': '展开',
    'terminal.aiBar.loading': '正在请求…',
    'terminal.aiBar.busy': 'AI 正在回复，请等待当前回复完成后再发送。',
    'terminal.aiBar.error.requestFailed': '请求失败（{status}）：{detail}',
    'terminal.aiBar.error.default': '请求失败，请稍后重试。',
    'terminal.aiBar.error.streamUnavailable': '无法读取响应流',
    'terminal.aiBar.error.proxyAuthFailed': '代理鉴权失败（{status}）：{detail}',
    'terminal.aiBar.error.quotaExceeded': '今日调用次数已达上限，请明天再试。',
    'terminal.aiBar.error.quotaExceededWithLimit': '今日调用次数已达上限（{limit} 次/天），请明天再试。',
    'terminal.aiBar.error.rateLimited': '请求过于频繁，请稍后再试。',
    'terminal.aiBar.error.rateLimitedWithRetry': '请求过于频繁，请在 {seconds} 秒后重试。',
    'terminal.aiBar.error.quotaExceededActionHint': '您可以添加自定义模型以获得更优体验。',
    'terminal.aiBar.error.addModelNow': '现在添加',
    'terminal.debugHint.detected': '检测到终端输出疑似错误。',
    'terminal.debugHint.detectedWithExitCode': '命令执行失败（exit code {code}）',
    'terminal.debugHint.commandFailed': 'Command failed',
    'terminal.debugHint.explainAction': 'Explain Error',
    'terminal.debugHint.debugAction': 'Debug With AI',
    'terminal.debugHint.action': 'Debug With AI',
    'terminal.debugHint.dismissAria': '关闭调试提示',
    'terminal.debugHint.userMessage': '排查这个错误',
    'terminal.debugHint.explainUserMessage': '解释这个错误',
    'terminal.debugHint.terminalOutput': '终端输出',
    'terminal.debugHint.command': '命令',
    'terminal.debugHint.noOutput': '（未捕获到终端输出）',
    'terminal.debugHint.noCommand': '（未捕获到命令）',
    'terminal.debugHint.openingAnalysis': '正在打开 AI 分析...',
    'terminal.debugHint.linkExpired': '该操作链接已过期，请重新执行命令后再试。',
    'terminal.debugHint.linkAlreadyUsed': '该操作链接已被使用。',
    'terminal.debugHint.busy': 'AI 正在回复，请稍后再试。',
    'terminal.inlineAi.loading': 'loading...',
    'terminal.inlineAi.commandLabel': 'AI 命令：',
    'terminal.inlineAi.insertAction': 'Insert',
    'terminal.inlineAi.runAction': 'Run',
    'terminal.inlineAi.error': 'AI 命令生成失败：{reason}',
    'terminal.inlineAi.emptyPrompt': '请在 ">" 后输入提示内容',
    'terminal.inlineAi.busy': 'AI 命令正在生成中，请稍候。',
    'terminal.inlineAi.invalidCommandReply': '模型未返回可执行命令。',
    'terminal.inlineAi.linkExpired': '该命令操作链接已过期。',
    'terminal.aiBar.inputPlaceholder': '输入问题后按 Enter 发送...',
    'file.menu.actionsAria': '文件操作菜单',
    'file.menu.createFile': '新建文件',
    'file.menu.createDirectory': '新建文件夹',
    'file.menu.rename': '重命名',
    'file.menu.download': '下载',
    'file.menu.extract': '解压',
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
    'file.toolbar.uploadDirectory': '上传目录',
    'file.emptyDirectory': '当前目录为空',
    'file.loading': '加载中...',
    'file.error.currentPathUnavailable': '当前目录不可用，请先刷新目录。',
    'file.confirm.deleteEntry': '确认删除「{name}」吗？',
    'file.dialog.confirmDefault': '确定',
    'file.dialog.createFile.title': '新建文件',
    'file.dialog.createFile.placeholder': '请输入新文件名',
    'file.dialog.createFile.confirm': '创建',
    'file.dialog.createFile.nameRequired': '文件名不能为空。',
    'file.dialog.createDirectory.title': '新建文件夹',
    'file.dialog.createDirectory.placeholder': '请输入新文件夹名称',
    'file.dialog.createDirectory.confirm': '创建',
    'file.dialog.createDirectory.nameRequired': '文件夹名不能为空。',
    'file.dialog.rename.title': '重命名',
    'file.dialog.rename.placeholder': '请输入新名称',
    'file.dialog.rename.confirm': '保存',
    'file.dialog.rename.nameRequired': '名称不能为空。',
    'file.message.createdFile': '已创建文件：{name}',
    'file.message.createdDirectory': '已创建文件夹：{name}',
    'file.message.renamed': '已重命名为：{name}',
    'file.message.deleted': '已删除：{name}',
    'file.message.downloadCompleted': '下载完成：{name}',
    'file.message.extractCompleted': '解压完成：{name}',
    'file.local.error.apiUnavailable': '本地文件功能暂不可用，请重启应用后重试。',
    'file.local.error.readDirectoryFailed': '读取目录失败',
    'file.local.error.createFileFailed': '新建文件失败',
    'file.local.error.createDirectoryFailed': '新建文件夹失败',
    'file.local.error.renameFailed': '重命名失败',
    'file.local.error.deleteFailed': '删除失败',
    'file.local.error.currentPathUnavailable': '当前目录不可用，请先刷新目录。',
    'file.local.error.noUploadPathDetected': '未检测到可上传的本地路径。',
    'file.local.error.uploadFailed': '上传失败',
    'file.local.confirm.uploadPaths': '确认上传 {count} 个文件/目录到「{path}」吗？',
    'file.remote.error.sessionRequired': '请选择已连接的 session',
    'file.remote.error.noUploadPathDetected': '未读取到可上传的目录/文件，请确认拖拽来源可访问。',
    'file.remote.error.noUploadDirectoryDetected': '未读取到可上传的目录文件，请确认目录可访问。',
    'file.remote.error.downloadFileOnly': '当前仅支持下载文件，不支持目录下载。',
    'file.remote.error.extractZipOnly': '当前仅支持解压 .zip 文件。',
    'file.remote.error.uploadConflictDirectory': '上传冲突："{path}" 是已存在目录，无法作为文件覆盖。',
    'file.remote.upload.skippedCount': '将跳过 {count} 个不可用条目。',
    'file.remote.confirm.uploadFiles': '确认上传 {count} 个文件到「{path}」吗？{skippedText}',
    'file.remote.confirm.uploadDirectory': '确认上传目录（共 {count} 个文件）到「{path}」吗？{skippedText}',
    'file.remote.confirm.extractZip': '确认解压「{name}」吗？',
    'file.remote.dialog.saveTitle': '保存文件：{name}',
    'file.remote.dialog.saveButton': '保存',
    'file.inspector.title': '文件预览 / 基础编辑',
    'file.inspector.currentEncoding': '当前编码：{encoding}',
    'file.inspector.saveEncoding': '保存编码：{encoding}',
    'file.inspector.label.noFileSelected': '未选中文件',
    'file.inspector.label.directorySelected': '{name}（目录）',
    'file.inspector.hint.binaryPreviewUnsupported': '该文件疑似二进制文件，暂不支持预览。',
    'file.inspector.hint.readFileApiUnavailable':
      '当前环境未暴露 ssh.sftp.readFile，无法读取远程文件内容。请补充 preload 暴露后重试。',
    'file.inspector.notice.largeLogTail':
      '大文件保护：文件大小 {size}，日志仅显示尾部 {lineLimit} 行（最多 {charLimit} 个字符）。',
    'file.inspector.notice.largeTextHead':
      '大文件保护：文件大小 {size}，当前仅预览前 {charLimit} 个字符。',
    'file.inspector.error.readFileFailed': '读取远程文件失败',
    'file.inspector.error.jsonParseFailed': 'JSON 解析失败',
    'file.inspector.error.sessionUnavailableForSave': '缺少活动 session，无法保存文件。',
    'file.inspector.error.writeTextApiUnavailable': '当前环境不支持 ssh.sftp.writeText。',
    'file.inspector.error.saveFailed': '保存失败',
    'file.inspector.error.saveAsFailed': '另存为失败',
    'file.inspector.error.invalidSaveAsPath': '另存为路径不合法。',
    'file.inspector.confirm.reloadDiscardChanges': '当前文件有未保存修改，确认重新加载并丢弃修改吗？',
    'file.inspector.confirm.encodingWriteback':
      '检测到当前文件编码为 GB18030。\n将按 UTF-8 写回，可能改变原文件编码。\n确认继续{action}吗？',
    'file.inspector.prompt.saveAsPath': '请输入另存为路径：',
    'file.inspector.message.saved': '已保存：{path}',
    'file.inspector.message.savedAs': '已另存为：{path}',
    'file.inspector.message.unsavedChanges': '当前文件有未保存修改',
    'file.inspector.action.reload': '重新加载',
    'file.inspector.action.preview': '预览',
    'file.inspector.action.edit': '编辑',
    'file.inspector.action.save': '保存',
    'file.inspector.action.saving': '保存中...',
    'file.inspector.action.saveAs': '另存为',
    'file.inspector.action.autoScrollBottom': '自动滚动到底部',
    'file.inspector.action.scrollBottom': '滚动到底部',
    'file.inspector.placeholder.selectSession': '请选择会话后再查看文件。',
    'file.inspector.placeholder.selectFile': '点击右侧文件列表中的文件开始预览。',
    'file.inspector.placeholder.directoryUnsupported': '当前选中的是目录，不支持内容预览。',
    'file.inspector.placeholder.loading': '正在读取文件内容...',
    'file.inspector.placeholder.emptyImage': '图片内容为空。',
    'file.inspector.placeholder.editor': '可编辑文本内容，支持保存与另存为',
    'file.inspector.placeholder.unsupportedPreview': '该文件类型暂不支持预览。',
    'file.upload.progressTitle': '正在上传',
    'file.upload.progressPreparing': '正在准备上传...',
    'file.upload.completed': '上传完成：{count} 个文件',
    'file.upload.directoryCompleted': '目录上传完成：{count} 个文件',
    'file.remoteState.error.sessionIdRequired': '缺少 sessionId，无法执行远程文件操作。',
    'file.remoteState.error.loadRemoteDirectoryFailed': '加载远程目录失败',
    'file.remoteState.error.loadDirectoryTreeFailed': '目录树加载失败',
    'file.remoteState.error.loadDirectoryFailed': '目录加载失败',
    'file.remoteState.error.writeTextApiUnavailable': '当前环境不支持 ssh.sftp.writeText。',
    'file.remoteState.error.createFileFailed': '新建文件失败',
    'file.remoteState.error.createDirectoryFailed': '新建文件夹失败',
    'file.remoteState.error.deleteFailed': '删除失败',
    'file.remoteState.error.renameFailed': '重命名失败',
    'file.remoteState.error.uploadFailed': '上传失败',
    'file.remoteState.error.downloadFailed': '下载失败',
    'file.remoteState.error.extractZipApiUnavailable': '当前环境不支持 ssh.sftp.extractZip。',
    'file.remoteState.error.extractZipFailed': '解压 zip 文件失败',
    'server.sidebar.state.disconnected': '未连接',
    'server.sidebar.state.connecting': '连接中',
    'server.sidebar.state.connected': '已连接',
    'server.sidebar.state.disconnecting': '断开中',
    'server.sidebar.state.reconnecting': '重连中',
    'server.sidebar.state.failed': '失败',
    'server.sidebar.error.serverApiUnavailable': '桌面桥接未就绪：electronAPI.server 不可用，请重启应用。',
    'server.sidebar.error.sshApiUnavailable': '桌面桥接未就绪：electronAPI.ssh 不可用，请重启应用。',
    'server.sidebar.error.loadServersFailed': '加载服务器失败',
    'server.sidebar.error.loadServerDataFailed': '加载服务器数据失败',
    'server.sidebar.error.createServerFailed': '创建服务器失败',
    'server.sidebar.error.updateServerFailed': '更新服务器失败',
    'server.sidebar.error.deleteServerFailed': '删除服务器失败',
    'server.sidebar.error.connectFailed': '连接服务器失败',
    'server.sidebar.error.noBoundServerForSession': '未找到当前会话绑定的服务器',
    'server.sidebar.error.disconnectFailed': '断开连接失败',
    'server.sidebar.error.reconnectFailed': '重连失败',
    'server.sidebar.error.readStatusFailed': '读取连接状态失败',
    'server.sidebar.error.recordRecentDirectoryFailed': '记录最近目录失败',
    'terminal.filePane.sourceSelectAria': '文件来源选择',
    'terminal.filePane.sourceLocal': '本地',
    'terminal.filePane.sourceLoadingServers': '正在加载服务器...',
    'terminal.filePane.sourceUnknownRemote': '远程（绑定会话不可用）',
    'terminal.filePane.sourceServerMissing': '所选服务器不存在或已被删除。',
    'terminal.filePane.sourceSwitchFailed': '切换文件来源失败：{detail}',
    'terminal.filePane.sourceSwitchFailedFallback': '切换失败',
    'terminal.filePane.sourceLoadFailed': '加载服务器列表失败：{detail}',
    'terminal.filePane.sourceLoadFailedFallback': '加载失败',
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
