import type { IpcMain, IpcMainInvokeEvent } from 'electron'

import { LOG_IPC_CHANNELS } from '../../shared/ipc/channels'
import type { RendererErrorReport } from '../../shared/types/log'
import type { AppLogger } from '../logger'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export function registerLogIPCHandlers(ipcMain: IpcMainLike, logger: AppLogger): void {
  clearLogIPCHandlers(ipcMain)

  ipcMain.handle(
    LOG_IPC_CHANNELS.reportRendererError,
    async (_event: IpcMainInvokeEvent, report: RendererErrorReport) => {
      logger.error('renderer', formatRendererErrorReport(report))
    },
  )
}

export function clearLogIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(LOG_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }
}

function formatRendererErrorReport(report: RendererErrorReport): string {
  const locationParts: string[] = []

  if (report.source?.trim()) {
    locationParts.push(report.source.trim())
  }
  if (Number.isFinite(report.lineno) && report.lineno && report.lineno > 0) {
    locationParts.push(`line=${report.lineno}`)
  }
  if (Number.isFinite(report.colno) && report.colno && report.colno > 0) {
    locationParts.push(`col=${report.colno}`)
  }

  const locationText = locationParts.length ? ` (${locationParts.join(', ')})` : ''
  const stackText = report.stack?.trim() ? ` stack=${report.stack.trim()}` : ''
  return `[${report.kind}] ${report.message}${locationText}${stackText}`
}
