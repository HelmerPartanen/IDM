/** Shared types used across main process, renderer, and IPC */

export type DownloadStatus =
  | 'pending'
  | 'downloading'
  | 'paused'
  | 'completed'
  | 'error'
  | 'queued'
  | 'merging'
  | 'verifying'
  | 'scheduled';

export type SegmentStatus = 'pending' | 'active' | 'paused' | 'completed' | 'error';

export type Priority = 'high' | 'normal' | 'low';

export interface DownloadItem {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  totalSize: number;
  downloadedBytes: number;
  status: DownloadStatus;
  speed: number; // bytes per second
  eta: number; // seconds remaining
  threads: number;
  priority: Priority;
  createdAt: number;
  completedAt: number | null;
  resumable: boolean;
  checksum: string | null;
  checksumType: string | null;
  error: string | null;
  referrer: string | null;
  mime: string | null;
}

export interface SegmentInfo {
  id: number;
  downloadId: string;
  index: number;
  startByte: number;
  endByte: number;
  downloadedBytes: number;
  status: SegmentStatus;
}

export interface ScheduleInfo {
  id: number;
  downloadId: string;
  scheduledTime: number; // unix timestamp ms
  repeat: 'none' | 'daily' | 'weekly';
  autoShutdown: boolean;
  enabled: boolean;
}

export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  jitter: boolean;
}

export interface AppSettings {
  downloadFolder: string;
  maxThreadsPerDownload: number;
  maxConcurrentDownloads: number;
  autoStartOnBoot: boolean;
  speedLimitEnabled: boolean;
  speedLimitBytesPerSec: number;
  minimizeToTray: boolean;
  showNotifications: boolean;
  autoRetryFailed: boolean;
  maxRetries: number;
  fileTypeFilters: string[];
  minFileSizeToIntercept: number; // bytes
  theme: 'dark' | 'light';
}

export const DEFAULT_SETTINGS: AppSettings = {
  downloadFolder: '',
  maxThreadsPerDownload: 8,
  maxConcurrentDownloads: 3,
  autoStartOnBoot: true,
  speedLimitEnabled: false,
  speedLimitBytesPerSec: 0,
  minimizeToTray: true,
  showNotifications: true,
  autoRetryFailed: true,
  maxRetries: 5,
  fileTypeFilters: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
    '.exe', '.msi', '.dmg', '.iso', '.img',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
    '.mp3', '.flac', '.wav', '.aac', '.ogg',
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp',
    '.apk', '.deb', '.rpm'
  ],
  minFileSizeToIntercept: 1048576, // 1 MB
  theme: 'dark'
};

export interface DownloadProgressUpdate {
  id: string;
  downloadedBytes: number;
  speed: number;
  eta: number;
  status: DownloadStatus;
  segments?: SegmentInfo[];
}

export interface AddDownloadRequest {
  url: string;
  filename?: string;
  savePath?: string;
  referrer?: string;
  threads?: number;
  priority?: Priority;
  scheduledTime?: number;
  checksum?: string;
  checksumType?: string;
}

export interface NativeMessage {
  url: string;
  filename?: string;
  referrer?: string;
  fileSize?: number;
  mime?: string;
}

/** IPC channel names */
export const IPC = {
  DOWNLOAD_ADD: 'download:add',
  DOWNLOAD_PAUSE: 'download:pause',
  DOWNLOAD_RESUME: 'download:resume',
  DOWNLOAD_CANCEL: 'download:cancel',
  DOWNLOAD_RETRY: 'download:retry',
  DOWNLOAD_REMOVE: 'download:remove',
  DOWNLOAD_LIST: 'download:list',
  DOWNLOAD_OPEN_FILE: 'download:open-file',
  DOWNLOAD_OPEN_FOLDER: 'download:open-folder',
  DOWNLOAD_PROGRESS_BATCH: 'download:progress-batch',
  DOWNLOAD_ADDED: 'download:added',
  DOWNLOAD_STATUS_CHANGED: 'download:status-changed',
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  QUEUE_REORDER: 'queue:reorder',
  QUEUE_SET_PRIORITY: 'queue:set-priority',
  DIALOG_SELECT_FOLDER: 'dialog:select-folder',
  APP_MINIMIZE_TO_TRAY: 'app:minimize-to-tray',
  APP_QUIT: 'app:quit',
  SCHEDULE_ADD: 'schedule:add',
  SCHEDULE_REMOVE: 'schedule:remove',
  SCHEDULE_LIST: 'schedule:list',
  GET_FILE_ICON: 'app:get-file-icon',
  GET_FAVICON: 'app:get-favicon',
} as const;
