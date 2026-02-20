import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/types';
import type {
  AddDownloadRequest, AppSettings, DownloadItem, DownloadProgressUpdate,
  Priority, ScheduleInfo
} from '../shared/types';

export interface ElectronAPI {
  // Downloads
  addDownload: (request: AddDownloadRequest) => Promise<{ success: boolean; item?: DownloadItem; error?: string }>;
  pauseDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  resumeDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  cancelDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  retryDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  removeDownload: (id: string) => Promise<{ success: boolean; error?: string }>;
  listDownloads: () => Promise<{ success: boolean; downloads?: DownloadItem[]; error?: string }>;
  openFile: (id: string) => Promise<{ success: boolean; error?: string }>;
  openFolder: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Settings
  getSettings: () => Promise<{ success: boolean; settings?: AppSettings; error?: string }>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<{ success: boolean; settings?: AppSettings; error?: string }>;

  // Queue
  setPriority: (id: string, priority: Priority) => Promise<{ success: boolean; error?: string }>;

  // Dialogs
  selectFolder: () => Promise<string | null>;

  // Schedule
  addSchedule: (schedule: Omit<ScheduleInfo, 'id'>) => Promise<{ success: boolean; id?: number; error?: string }>;
  removeSchedule: (id: number) => Promise<{ success: boolean; error?: string }>;
  listSchedules: () => Promise<{ success: boolean; schedules?: ScheduleInfo[]; error?: string }>;

  // File icons
  getFavicon: (domain: string) => Promise<string | null>;

  // Events
  onProgressBatch: (callback: (updates: DownloadProgressUpdate[]) => void) => () => void;
  onDownloadAdded: (callback: (item: DownloadItem) => void) => () => void;
  onStatusChanged: (callback: (id: string, status: string) => void) => () => void;

  // App
  minimizeToTray: () => void;
  quit: () => void;
}

const api: ElectronAPI = {
  // Downloads
  addDownload: (request) => ipcRenderer.invoke(IPC.DOWNLOAD_ADD, request),
  pauseDownload: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_PAUSE, id),
  resumeDownload: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_RESUME, id),
  cancelDownload: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, id),
  retryDownload: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_RETRY, id),
  removeDownload: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_REMOVE, id),
  listDownloads: () => ipcRenderer.invoke(IPC.DOWNLOAD_LIST),
  openFile: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FILE, id),
  openFolder: (id) => ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FOLDER, id),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (updates) => ipcRenderer.invoke(IPC.SETTINGS_UPDATE, updates),

  // Queue
  setPriority: (id, priority) => ipcRenderer.invoke(IPC.QUEUE_SET_PRIORITY, id, priority),

  // Dialogs
  selectFolder: () => ipcRenderer.invoke(IPC.DIALOG_SELECT_FOLDER),

  // Schedule
  addSchedule: (schedule) => ipcRenderer.invoke(IPC.SCHEDULE_ADD, schedule),
  removeSchedule: (id) => ipcRenderer.invoke(IPC.SCHEDULE_REMOVE, id),
  listSchedules: () => ipcRenderer.invoke(IPC.SCHEDULE_LIST),

  // File icons
  getFavicon: (domain) => ipcRenderer.invoke(IPC.GET_FAVICON, domain),

  // Events from main process
  onProgressBatch: (callback) => {
    const handler = (_event: any, updates: DownloadProgressUpdate[]) => callback(updates);
    ipcRenderer.on(IPC.DOWNLOAD_PROGRESS_BATCH, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_PROGRESS_BATCH, handler);
  },

  onDownloadAdded: (callback) => {
    const handler = (_event: any, item: DownloadItem) => callback(item);
    ipcRenderer.on(IPC.DOWNLOAD_ADDED, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_ADDED, handler);
  },

  onStatusChanged: (callback) => {
    const handler = (_event: any, id: string, status: string) => callback(id, status);
    ipcRenderer.on(IPC.DOWNLOAD_STATUS_CHANGED, handler);
    return () => ipcRenderer.removeListener(IPC.DOWNLOAD_STATUS_CHANGED, handler);
  },

  // App
  minimizeToTray: () => ipcRenderer.send(IPC.APP_MINIMIZE_TO_TRAY),
  quit: () => ipcRenderer.send(IPC.APP_QUIT)
};

contextBridge.exposeInMainWorld('api', api);
