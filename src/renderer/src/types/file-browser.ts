import type { SftpListItem, SSHResult } from '../../../shared/types/ssh'

export type RemoteFileEntry = SftpListItem
export type RemoteFileType = RemoteFileEntry['type']

export interface RemoteBreadcrumbItem {
  label: string
  path: string
}

export interface RemoteDirectoryNode {
  path: string
  name: string
  parentPath: string | null
  expanded: boolean
  loading: boolean
  loaded: boolean
  error: string | null
  childrenPaths: string[]
}

export interface RemoteDirectoryTreeRow {
  path: string
  name: string
  depth: number
  expanded: boolean
  loading: boolean
  loaded: boolean
  error: string | null
  isActive: boolean
}

export interface UseRemoteFileBrowserStateOptions {
  initialPath?: string
  autoLoad?: boolean
}

export interface RemoteUploadItem {
  localPath: string
  remotePath: string
}

export interface RemoteUploadProgress {
  active: boolean
  total: number
  completed: number
  percent: number
  currentFileName: string | null
}

export interface SftpWriteTextRequest {
  sessionId: string
  remotePath: string
  content: string
}

export interface SftpWithWriteTextApi {
  writeText?: (request: SftpWriteTextRequest) => Promise<SSHResult<void>>
}

export const ROOT_REMOTE_PATH = '/'

export function normalizeRemotePath(input?: string | null): string {
  if (!input) {
    return ROOT_REMOTE_PATH
  }

  const normalized = input.replaceAll('\\', '/').trim()
  if (!normalized) {
    return ROOT_REMOTE_PATH
  }

  const withPrefix = normalized.startsWith('/') ? normalized : `/${normalized}`
  const collapsed = withPrefix.replace(/\/{2,}/g, '/')

  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1)
  }

  return collapsed || ROOT_REMOTE_PATH
}

export function splitRemotePath(path: string): string[] {
  const normalized = normalizeRemotePath(path)
  if (normalized === ROOT_REMOTE_PATH) {
    return []
  }

  return normalized.slice(1).split('/').filter(Boolean)
}

export function getRemoteBasename(path: string): string {
  const segments = splitRemotePath(path)
  return segments[segments.length - 1] ?? ROOT_REMOTE_PATH
}

export function getRemoteParentPath(path: string): string | null {
  const segments = splitRemotePath(path)
  if (segments.length === 0) {
    return null
  }

  if (segments.length === 1) {
    return ROOT_REMOTE_PATH
  }

  return `/${segments.slice(0, -1).join('/')}`
}

export function joinRemotePath(basePath: string, childName: string): string {
  const base = normalizeRemotePath(basePath)
  const child = childName.replaceAll('\\', '/').trim()

  if (!child || child === '.') {
    return base
  }

  if (child === '..') {
    return getRemoteParentPath(base) ?? ROOT_REMOTE_PATH
  }

  if (child.startsWith('/')) {
    return normalizeRemotePath(child)
  }

  return normalizeRemotePath(base === ROOT_REMOTE_PATH ? `/${child}` : `${base}/${child}`)
}

export function normalizeRemoteEntryName(input: string): string {
  return input.replaceAll('\\', '/').trim().replaceAll('/', '')
}

export function isValidRemoteEntryName(input: string): boolean {
  if (!input) {
    return false
  }

  if (input === '.' || input === '..') {
    return false
  }

  return !input.includes('/')
}

export function buildRemoteBreadcrumbs(path: string): RemoteBreadcrumbItem[] {
  const normalized = normalizeRemotePath(path)
  const segments = splitRemotePath(normalized)

  const items: RemoteBreadcrumbItem[] = [{ label: ROOT_REMOTE_PATH, path: ROOT_REMOTE_PATH }]

  let cursor = ''
  for (const segment of segments) {
    cursor = `${cursor}/${segment}`
    items.push({
      label: segment,
      path: cursor,
    })
  }

  return items
}

export function isDirectoryEntry(entry: RemoteFileEntry): boolean {
  return entry.type === 'directory'
}

export function sortRemoteEntries(entries: RemoteFileEntry[]): RemoteFileEntry[] {
  return [...entries].sort((left, right) => {
    const leftDir = isDirectoryEntry(left)
    const rightDir = isDirectoryEntry(right)

    if (leftDir !== rightDir) {
      return leftDir ? -1 : 1
    }

    const nameCompare = left.name.localeCompare(right.name)
    if (nameCompare !== 0) {
      return nameCompare
    }

    return left.path.localeCompare(right.path)
  })
}

export function getRemotePathDepth(path: string): number {
  return splitRemotePath(path).length
}

export function createDirectoryNode(path: string): RemoteDirectoryNode {
  const normalized = normalizeRemotePath(path)

  return {
    path: normalized,
    name: getRemoteBasename(normalized),
    parentPath: getRemoteParentPath(normalized),
    expanded: normalized === ROOT_REMOTE_PATH,
    loading: false,
    loaded: false,
    error: null,
    childrenPaths: [],
  }
}

export function toErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === 'string' && error.trim()) {
    return error
  }

  return fallback
}
