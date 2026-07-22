export interface DialogSaveFileRequest {
  title?: string;
  defaultPath?: string;
  buttonLabel?: string;
}

export interface DialogSaveFileResponse {
  canceled: boolean;
  filePath: string | null;
}
