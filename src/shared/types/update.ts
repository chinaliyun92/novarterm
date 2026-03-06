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
  checkedAt: string
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
