import fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { LOCAL_FILE_IPC_CHANNELS } from '../../shared/ipc/channels'
import type {
  LocalFileActionData,
  LocalFileCreateDirectoryRequest,
  LocalFileCreateFileRequest,
  LocalFileDeleteRequest,
  LocalFileEntry,
  LocalFileErrorPayload,
  LocalFileListData,
  LocalFileListRequest,
  LocalFileRenameRequest,
  LocalFileResult,
} from '../../shared/types/local-file'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

class LocalFileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalFileValidationError'
  }
}

function toErrorPayload(error: unknown): LocalFileErrorPayload {
  if (error instanceof LocalFileValidationError) {
    return { code: 'validation_error', message: error.message || '请求参数无效' }
  }

  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return { code: 'not_found', message: '目标不存在' }
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { code: 'permission_denied', message: '没有访问权限' }
    }
    if (code === 'EEXIST') {
      return { code: 'validation_error', message: '目标已存在' }
    }
    return { code: 'io_error', message: error.message || '读取目录失败', detail: code }
  }

  return { code: 'unknown_error', message: String(error) }
}

function resolveParentPath(absolutePath: string): string | null {
  const parsed = path.parse(absolutePath)
  if (parsed.root === absolutePath) {
    return null
  }

  const parentPath = path.dirname(absolutePath)
  return parentPath === absolutePath ? null : parentPath
}

function toEntryType(dirent: Dirent): LocalFileEntry['type'] {
  if (dirent.isDirectory()) {
    return 'directory'
  }
  if (dirent.isFile()) {
    return 'file'
  }
  if (dirent.isSymbolicLink()) {
    return 'link'
  }
  return 'unknown'
}

async function toLocalFileEntries(basePath: string, dirents: Dirent[]): Promise<LocalFileEntry[]> {
  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const entryPath = path.join(basePath, dirent.name)
      let size: number | null = null
      let modifiedAt: string | null = null

      try {
        const stat = await fs.lstat(entryPath)
        size = stat.isFile() ? stat.size : null
        modifiedAt = Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : null
      } catch {
        size = null
        modifiedAt = null
      }

      return {
        name: dirent.name,
        path: entryPath,
        type: toEntryType(dirent),
        size,
        modifiedAt,
      } satisfies LocalFileEntry
    }),
  )

  entries.sort((left, right) => {
    const leftIsDir = left.type === 'directory'
    const rightIsDir = right.type === 'directory'
    if (leftIsDir !== rightIsDir) {
      return leftIsDir ? -1 : 1
    }
    return left.name.localeCompare(right.name)
  })

  return entries
}

async function listLocalPath(request: LocalFileListRequest): Promise<LocalFileListData> {
  const rawPath = request.path?.trim() ?? ''
  if (!rawPath) {
    throw new LocalFileValidationError('目标目录不能为空')
  }

  const absolutePath = path.resolve(rawPath)
  const stat = await fs.stat(absolutePath)
  if (!stat.isDirectory()) {
    throw new LocalFileValidationError('目标路径不是目录')
  }

  const dirents = await fs.readdir(absolutePath, { withFileTypes: true })
  const entries = await toLocalFileEntries(absolutePath, dirents)

  return {
    path: absolutePath,
    parentPath: resolveParentPath(absolutePath),
    entries,
  }
}

function normalizeAbsolutePath(value: unknown, fieldLabel: string): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    throw new LocalFileValidationError(`${fieldLabel}不能为空`)
  }

  return path.resolve(raw)
}

function normalizeEntryName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) {
    throw new LocalFileValidationError('名称不能为空')
  }
  if (name === '.' || name === '..') {
    throw new LocalFileValidationError('名称不合法')
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new LocalFileValidationError('名称不能包含路径分隔符')
  }
  return name
}

async function ensureDirectoryExists(absolutePath: string): Promise<void> {
  const stat = await fs.stat(absolutePath)
  if (!stat.isDirectory()) {
    throw new LocalFileValidationError('目标路径不是目录')
  }
}

async function createLocalFile(request: LocalFileCreateFileRequest): Promise<LocalFileActionData> {
  const directoryPath = normalizeAbsolutePath(request.directoryPath, '目录路径')
  const name = normalizeEntryName(request.name)
  await ensureDirectoryExists(directoryPath)

  const targetPath = path.join(directoryPath, name)
  const content = typeof request.content === 'string' ? request.content : ''
  await fs.writeFile(targetPath, content, { flag: 'wx' })
  return { path: targetPath }
}

async function createLocalDirectory(request: LocalFileCreateDirectoryRequest): Promise<LocalFileActionData> {
  const directoryPath = normalizeAbsolutePath(request.directoryPath, '目录路径')
  const name = normalizeEntryName(request.name)
  await ensureDirectoryExists(directoryPath)

  const targetPath = path.join(directoryPath, name)
  await fs.mkdir(targetPath)
  return { path: targetPath }
}

async function renameLocalEntry(request: LocalFileRenameRequest): Promise<LocalFileActionData> {
  const fromPath = normalizeAbsolutePath(request.path, '目标路径')
  const nextName = normalizeEntryName(request.nextName)
  const targetPath = path.join(path.dirname(fromPath), nextName)
  await fs.rename(fromPath, targetPath)
  return { path: targetPath }
}

async function deleteLocalEntry(request: LocalFileDeleteRequest): Promise<LocalFileActionData> {
  const targetPath = normalizeAbsolutePath(request.path, '目标路径')
  await fs.rm(targetPath, { recursive: true, force: false })
  return { path: targetPath }
}

export function registerLocalFileIPCHandlers(ipcMain: IpcMainLike): void {
  clearLocalFileIPCHandlers(ipcMain)

  ipcMain.handle(
    LOCAL_FILE_IPC_CHANNELS.list,
    async (_event: IpcMainInvokeEvent, request: LocalFileListRequest): Promise<LocalFileResult<LocalFileListData>> => {
      try {
        const data = await listLocalPath(request)
        return { ok: true, data }
      } catch (error) {
        return {
          ok: false,
          error: toErrorPayload(error),
        }
      }
    },
  )

  ipcMain.handle(
    LOCAL_FILE_IPC_CHANNELS.createFile,
    async (
      _event: IpcMainInvokeEvent,
      request: LocalFileCreateFileRequest,
    ): Promise<LocalFileResult<LocalFileActionData>> => {
      try {
        const data = await createLocalFile(request)
        return { ok: true, data }
      } catch (error) {
        return {
          ok: false,
          error: toErrorPayload(error),
        }
      }
    },
  )

  ipcMain.handle(
    LOCAL_FILE_IPC_CHANNELS.createDirectory,
    async (
      _event: IpcMainInvokeEvent,
      request: LocalFileCreateDirectoryRequest,
    ): Promise<LocalFileResult<LocalFileActionData>> => {
      try {
        const data = await createLocalDirectory(request)
        return { ok: true, data }
      } catch (error) {
        return {
          ok: false,
          error: toErrorPayload(error),
        }
      }
    },
  )

  ipcMain.handle(
    LOCAL_FILE_IPC_CHANNELS.rename,
    async (
      _event: IpcMainInvokeEvent,
      request: LocalFileRenameRequest,
    ): Promise<LocalFileResult<LocalFileActionData>> => {
      try {
        const data = await renameLocalEntry(request)
        return { ok: true, data }
      } catch (error) {
        return {
          ok: false,
          error: toErrorPayload(error),
        }
      }
    },
  )

  ipcMain.handle(
    LOCAL_FILE_IPC_CHANNELS.delete,
    async (
      _event: IpcMainInvokeEvent,
      request: LocalFileDeleteRequest,
    ): Promise<LocalFileResult<LocalFileActionData>> => {
      try {
        const data = await deleteLocalEntry(request)
        return { ok: true, data }
      } catch (error) {
        return {
          ok: false,
          error: toErrorPayload(error),
        }
      }
    },
  )
}

export function clearLocalFileIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(LOCAL_FILE_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }
}
