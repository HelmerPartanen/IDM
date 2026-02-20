"use strict";
const electron = require("electron");
const IPC = {
  DOWNLOAD_ADD: "download:add",
  DOWNLOAD_PAUSE: "download:pause",
  DOWNLOAD_RESUME: "download:resume",
  DOWNLOAD_CANCEL: "download:cancel",
  DOWNLOAD_RETRY: "download:retry",
  DOWNLOAD_REMOVE: "download:remove",
  DOWNLOAD_LIST: "download:list",
  DOWNLOAD_OPEN_FILE: "download:open-file",
  DOWNLOAD_OPEN_FOLDER: "download:open-folder",
  DOWNLOAD_PROGRESS_BATCH: "download:progress-batch",
  DOWNLOAD_ADDED: "download:added",
  DOWNLOAD_STATUS_CHANGED: "download:status-changed",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  QUEUE_SET_PRIORITY: "queue:set-priority",
  DIALOG_SELECT_FOLDER: "dialog:select-folder",
  APP_MINIMIZE_TO_TRAY: "app:minimize-to-tray",
  APP_QUIT: "app:quit",
  SCHEDULE_ADD: "schedule:add",
  SCHEDULE_REMOVE: "schedule:remove",
  SCHEDULE_LIST: "schedule:list",
  GET_FILE_ICON: "app:get-file-icon",
  GET_FAVICON: "app:get-favicon"
};
const api = {
  // Downloads
  addDownload: (request) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_ADD, request),
  pauseDownload: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_PAUSE, id),
  resumeDownload: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_RESUME, id),
  cancelDownload: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_CANCEL, id),
  retryDownload: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_RETRY, id),
  removeDownload: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_REMOVE, id),
  listDownloads: () => electron.ipcRenderer.invoke(IPC.DOWNLOAD_LIST),
  openFile: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FILE, id),
  openFolder: (id) => electron.ipcRenderer.invoke(IPC.DOWNLOAD_OPEN_FOLDER, id),
  // Settings
  getSettings: () => electron.ipcRenderer.invoke(IPC.SETTINGS_GET),
  updateSettings: (updates) => electron.ipcRenderer.invoke(IPC.SETTINGS_UPDATE, updates),
  // Queue
  setPriority: (id, priority) => electron.ipcRenderer.invoke(IPC.QUEUE_SET_PRIORITY, id, priority),
  // Dialogs
  selectFolder: () => electron.ipcRenderer.invoke(IPC.DIALOG_SELECT_FOLDER),
  // Schedule
  addSchedule: (schedule) => electron.ipcRenderer.invoke(IPC.SCHEDULE_ADD, schedule),
  removeSchedule: (id) => electron.ipcRenderer.invoke(IPC.SCHEDULE_REMOVE, id),
  listSchedules: () => electron.ipcRenderer.invoke(IPC.SCHEDULE_LIST),
  // File icons
  getFileIcon: (filePath) => electron.ipcRenderer.invoke(IPC.GET_FILE_ICON, filePath),
  getFavicon: (domain) => electron.ipcRenderer.invoke(IPC.GET_FAVICON, domain),
  // Events from main process
  onProgressBatch: (callback) => {
    const handler = (_event, updates) => callback(updates);
    electron.ipcRenderer.on(IPC.DOWNLOAD_PROGRESS_BATCH, handler);
    return () => electron.ipcRenderer.removeListener(IPC.DOWNLOAD_PROGRESS_BATCH, handler);
  },
  onDownloadAdded: (callback) => {
    const handler = (_event, item) => callback(item);
    electron.ipcRenderer.on(IPC.DOWNLOAD_ADDED, handler);
    return () => electron.ipcRenderer.removeListener(IPC.DOWNLOAD_ADDED, handler);
  },
  onStatusChanged: (callback) => {
    const handler = (_event, id, status) => callback(id, status);
    electron.ipcRenderer.on(IPC.DOWNLOAD_STATUS_CHANGED, handler);
    return () => electron.ipcRenderer.removeListener(IPC.DOWNLOAD_STATUS_CHANGED, handler);
  },
  // App
  minimizeToTray: () => electron.ipcRenderer.send(IPC.APP_MINIMIZE_TO_TRAY),
  quit: () => electron.ipcRenderer.send(IPC.APP_QUIT)
};
electron.contextBridge.exposeInMainWorld("api", api);
