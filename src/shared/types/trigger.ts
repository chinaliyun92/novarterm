export type TerminalTriggerSource = 'user' | 'server_hidden';

export interface TerminalTriggerRule {
  id: string;
  pattern: string;
  sendText: string;
  enabled: boolean;
  autoSend: boolean;
  hidden?: boolean;
  source?: TerminalTriggerSource;
  sourceServerId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TriggerErrorPayload {
  code: string;
  message: string;
  detail?: string;
}

export interface TriggerResultSuccess<T> {
  ok: true;
  data: T;
}

export interface TriggerResultFailure {
  ok: false;
  error: TriggerErrorPayload;
}

export type TriggerResult<T> = TriggerResultSuccess<T> | TriggerResultFailure;

export interface TriggerListResponse {
  rules: TerminalTriggerRule[];
}

export interface TriggerReplaceAllRequest {
  rules: TerminalTriggerRule[];
}

export interface TriggerReplaceAllResponse {
  rules: TerminalTriggerRule[];
}
