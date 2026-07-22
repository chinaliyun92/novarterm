import path from 'node:path';
import { BrowserWindow, dialog } from 'electron';
import type { FileFilter, IpcMain, IpcMainInvokeEvent, SaveDialogOptions } from 'electron';

import { DIALOG_IPC_CHANNELS } from '../../shared/ipc/channels';
import type {
  DialogSaveFileRequest,
  DialogSaveFileResponse,
} from '../../shared/types/dialog';

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>;

const ALL_FILES_FILTER: FileFilter = { name: 'All Files', extensions: ['*'] };
const TEXT_FILTER_EXTENSIONS = [
  'txt',
  'log',
  'md',
  'markdown',
  'csv',
  'tsv',
  'xml',
  'html',
  'htm',
  'css',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'yaml',
  'yml',
] as const;
const JSON_FILTER_EXTENSIONS = ['json', 'jsonc'] as const;
const IMAGE_FILTER_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'avif',
] as const;

type KnownFilterPreset = {
  name: 'Text' | 'JSON' | 'Image';
  extensions: readonly string[];
};

const KNOWN_FILTER_PRESETS: readonly KnownFilterPreset[] = [
  { name: 'Text', extensions: TEXT_FILTER_EXTENSIONS },
  { name: 'JSON', extensions: JSON_FILTER_EXTENSIONS },
  { name: 'Image', extensions: IMAGE_FILTER_EXTENSIONS },
];

function inferDefaultExtension(defaultPath?: string): string | null {
  if (!defaultPath) {
    return null;
  }

  const filename = path.basename(defaultPath.trim());
  if (!filename || filename === '.' || filename === '..') {
    return null;
  }

  const extensionWithDot = path.extname(filename);
  if (!extensionWithDot) {
    return null;
  }

  const extension = extensionWithDot.slice(1).toLowerCase();
  return extension || null;
}

function withPreferredExtensionFirst(extensions: readonly string[], preferred: string): string[] {
  const ordered = [...extensions];
  const index = ordered.indexOf(preferred);
  if (index <= 0) {
    return ordered;
  }

  ordered.splice(index, 1);
  ordered.unshift(preferred);
  return ordered;
}

function resolveSaveDialogFilters(defaultPath?: string): FileFilter[] {
  const extension = inferDefaultExtension(defaultPath);
  if (!extension) {
    return [ALL_FILES_FILTER];
  }

  const preset = KNOWN_FILTER_PRESETS.find((item) => item.extensions.includes(extension));
  if (!preset) {
    return [ALL_FILES_FILTER];
  }

  return [
    {
      name: preset.name,
      extensions: withPreferredExtensionFirst(preset.extensions, extension),
    },
    ALL_FILES_FILTER,
  ];
}

export function registerDialogIPCHandlers(ipcMain: IpcMainLike): void {
  clearDialogIPCHandlers(ipcMain);

  ipcMain.handle(
    DIALOG_IPC_CHANNELS.showSaveDialog,
    async (event: IpcMainInvokeEvent, request: DialogSaveFileRequest) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const options: SaveDialogOptions = {
        title: request.title,
        defaultPath: request.defaultPath,
        buttonLabel: request.buttonLabel,
        filters: resolveSaveDialogFilters(request.defaultPath),
      };
      const result = browserWindow
        ? await dialog.showSaveDialog(browserWindow, options)
        : await dialog.showSaveDialog(options);

      return {
        canceled: result.canceled,
        filePath: result.filePath ?? null,
      } satisfies DialogSaveFileResponse;
    },
  );
}

export function clearDialogIPCHandlers(ipcMain: IpcMainLike): void {
  for (const channel of Object.values(DIALOG_IPC_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
