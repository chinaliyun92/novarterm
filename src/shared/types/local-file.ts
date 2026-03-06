export type LocalFileEntryType = 'file' | 'directory' | 'link' | 'unknown'

export interface LocalFileEntry {
  name: string
  path: string
  type: LocalFileEntryType
  size: number | null
  modifiedAt: string | null
}

export interface LocalFileListRequest {
  path: string
}

export interface LocalFileCreateFileRequest {
  directoryPath: string
  name: string
  content?: string
}

export interface LocalFileCreateDirectoryRequest {
  directoryPath: string
  name: string
}

export interface LocalFileRenameRequest {
  path: string
  nextName: string
}

export interface LocalFileDeleteRequest {
  path: string
}

export interface LocalFileListData {
  path: string
  parentPath: string | null
  entries: LocalFileEntry[]
}

export interface LocalFileActionData {
  path: string
}

export interface LocalFileErrorPayload {
  code: 'validation_error' | 'not_found' | 'permission_denied' | 'io_error' | 'unknown_error'
  message: string
  detail?: string
}

export type LocalFileResult<T> = { ok: true; data: T } | { ok: false; error: LocalFileErrorPayload }
