import type { Setting } from './db';

export type SettingsErrorCode = 'validation_error' | 'unknown_error';

export interface SettingsErrorPayload {
  code: SettingsErrorCode;
  message: string;
  detail?: string;
}

export interface SettingsResultSuccess<T> {
  ok: true;
  data: T;
}

export interface SettingsResultFailure {
  ok: false;
  error: SettingsErrorPayload;
}

export type SettingsResult<T> = SettingsResultSuccess<T> | SettingsResultFailure;

export interface SettingsGetRequest {
  key: string;
}

export interface SettingsGetResponse {
  setting: Setting | null;
}

export interface SettingsSetRequest {
  key: string;
  value: string;
}

export interface SettingsSetResponse {
  setting: Setting;
}

export interface SettingsCleanCommandBarHistoryRequest {
  keepSessionIds: string[];
}

export interface SettingsCleanCommandBarHistoryResponse {
  removedCount: number;
}
