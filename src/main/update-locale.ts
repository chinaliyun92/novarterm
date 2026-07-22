export type MainUpdateLanguage = 'en' | 'zh-CN'

export interface UpdateDialogCopy {
  checkForUpdatesTitle: string
  latestVersionMessage: string
  updateReadyTitle: string
  restartNow: string
  later: string
  updateReadyMessage: (version: string) => string
  updateReadyDetail: string
  downloadFailedMessage: string
  downloadFailedDetail: string
  openDownloadPage: string
  cancel: string
  updateAvailableTitle: string
  updateNow: string
  updateAvailableMessage: (latestVersion: string) => string
  currentVersionLabel: string
  latestVersionLabel: string
  releaseTagLabel: string
  openDownloadPageHint: string
}

const EN_COPY: UpdateDialogCopy = {
  checkForUpdatesTitle: 'Check for Updates',
  latestVersionMessage: 'You are already on the latest version.',
  updateReadyTitle: 'Update Ready',
  restartNow: 'Restart Now',
  later: 'Later',
  updateReadyMessage: (version: string) => `Version ${version} has been downloaded. Restart now to install?`,
  updateReadyDetail:
    'Selecting "Restart Now" will close the app and install the new version. Selecting "Later" will install on next startup or when you restart manually.',
  downloadFailedMessage: 'Failed to download the update.',
  downloadFailedDetail: 'You can retry later, or open the release page to download manually.',
  openDownloadPage: 'Open Download Page',
  cancel: 'Cancel',
  updateAvailableTitle: 'Update Available',
  updateNow: 'Update Now',
  updateAvailableMessage: (latestVersion: string) => `A new version is available: ${latestVersion}`,
  currentVersionLabel: 'Current version',
  latestVersionLabel: 'Latest version',
  releaseTagLabel: 'Release tag',
  openDownloadPageHint: 'Click "Update Now" to open the download page.',
}

const ZH_CN_COPY: UpdateDialogCopy = {
  checkForUpdatesTitle: '检查更新',
  latestVersionMessage: '您的版本已经是最新版本。',
  updateReadyTitle: '更新就绪',
  restartNow: '立即重启',
  later: '稍后',
  updateReadyMessage: (version: string) => `新版本 ${version} 已下载完成，是否立即重启安装？`,
  updateReadyDetail:
    '点击「立即重启」将关闭应用并安装新版本。点击「稍后」会在下次启动或手动重启时安装。',
  downloadFailedMessage: '新版本下载失败。',
  downloadFailedDetail: '您可以稍后重试，或打开发布页手动下载更新。',
  openDownloadPage: '打开下载页面',
  cancel: '取消',
  updateAvailableTitle: '发现新版本',
  updateNow: '立即更新',
  updateAvailableMessage: (latestVersion: string) => `发现新版本：${latestVersion}`,
  currentVersionLabel: '当前版本',
  latestVersionLabel: '最新版本',
  releaseTagLabel: '发布标签',
  openDownloadPageHint: '点击「立即更新」将打开下载页面。',
}

export function normalizeMainUpdateLanguage(raw: string | null | undefined): MainUpdateLanguage {
  if (!raw) {
    return 'en'
  }
  const lowered = raw.trim().toLowerCase()
  if (lowered.startsWith('zh')) {
    return 'zh-CN'
  }
  return 'en'
}

export function getUpdateDialogCopy(rawLanguage: string | null | undefined): UpdateDialogCopy {
  return normalizeMainUpdateLanguage(rawLanguage) === 'zh-CN' ? ZH_CN_COPY : EN_COPY
}
