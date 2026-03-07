import { shell } from 'electron'
import type { IpcMain } from 'electron'
import { SHELL_IPC_CHANNELS } from '../../shared/ipc/channels'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const

function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return ALLOWED_PROTOCOLS.includes(url.protocol as (typeof ALLOWED_PROTOCOLS)[number])
  } catch {
    return false
  }
}

export function registerShellIPCHandlers(ipcMain: IpcMainLike): void {
  clearShellIPCHandlers(ipcMain)
  ipcMain.handle(SHELL_IPC_CHANNELS.openExternal, async (_event, url: string) => {
    if (typeof url !== 'string' || !url.trim()) {
      return { ok: false, error: 'missing url' }
    }
    const trimmed = url.trim()
    if (!isAllowedUrl(trimmed)) {
      return { ok: false, error: 'only http and https URLs are allowed' }
    }
    await shell.openExternal(trimmed)
    return { ok: true }
  })
}

export function clearShellIPCHandlers(ipcMain: IpcMainLike): void {
  ipcMain.removeHandler(SHELL_IPC_CHANNELS.openExternal)
}
