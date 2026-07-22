export type UpdateErrorCode = 'network_error' | 'invalid_response' | 'unknown_error'

export interface UpdateErrorPayload {
  code: UpdateErrorCode
  message: string
  detail?: string
}

export interface UpdateResultSuccess<T> {
  ok: true
  data: T
}

export interface UpdateResultFailure {
  ok: false
  error: UpdateErrorPayload
}

export type UpdateResult<T> = UpdateResultSuccess<T> | UpdateResultFailure

export interface UpdateCheckResponse {
  currentVersion: string
  latestVersion: string
  latestTag: string
  releaseUrl: string
  hasUpdate: boolean
  managedByNativeUpdater: boolean
  checkedAt: string
}

export type NativeUpdatePhase = 'idle' | 'available' | 'downloading' | 'downloaded' | 'error'

export interface NativeUpdateState {
  phase: NativeUpdatePhase
  currentVersion: string
  latestVersion: string | null
  latestTag: string | null
  releaseUrl: string
  progressPercent: number
  transferredBytes: number
  totalBytes: number
  errorMessage?: string
}

export interface UpdatePromptRequest {
  currentVersion: string
  latestVersion: string
  latestTag?: string | null
  releaseUrl: string
}

export interface UpdatePromptResponse {
  action: 'update' | 'later'
  openedReleasePage: boolean
  releaseUrl: string
}

export interface UpdateOpenReleaseRequest {
  releaseUrl?: string | null
}

export interface UpdateOpenReleaseResponse {
  opened: boolean
  releaseUrl: string
}

export interface UpdateDownloadResponse {
  started: boolean
}

export interface UpdateRestartResponse {
  accepted: boolean
}
