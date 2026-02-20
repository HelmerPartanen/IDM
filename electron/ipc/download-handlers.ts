import { ipcMain, dialog, shell } from 'electron';
import log from 'electron-log';
import { DownloadEngine } from '../download-engine/engine';
import { QueueManager } from '../download-engine/queue-manager';
import * as models from '../db/models';
import { IPC } from '../../shared/types';
import type { AddDownloadRequest, Priority } from '../../shared/types';

export function registerDownloadHandlers(
  engine: DownloadEngine,
  queueManager: QueueManager
): void {
  // Add a new download
  ipcMain.handle(IPC.DOWNLOAD_ADD, async (_event, request: AddDownloadRequest) => {
    try {
      const item = await engine.addDownload(request);
      await queueManager.enqueue(item.id, request.priority || 'normal');
      return { success: true, item };
    } catch (error: any) {
      log.error('[IPC] download:add failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Pause a download
  ipcMain.handle(IPC.DOWNLOAD_PAUSE, async (_event, id: string) => {
    try {
      await engine.pauseDownload(id);
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] download:pause failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Resume a download
  ipcMain.handle(IPC.DOWNLOAD_RESUME, async (_event, id: string) => {
    try {
      await queueManager.enqueue(id, models.getDownload(id)?.priority || 'normal');
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] download:resume failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Cancel a download
  ipcMain.handle(IPC.DOWNLOAD_CANCEL, async (_event, id: string) => {
    try {
      await engine.cancelDownload(id);
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] download:cancel failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Retry a failed download
  ipcMain.handle(IPC.DOWNLOAD_RETRY, async (_event, id: string) => {
    try {
      await engine.retryDownload(id);
      await queueManager.enqueue(id);
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] download:retry failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Remove a download from the list
  ipcMain.handle(IPC.DOWNLOAD_REMOVE, async (_event, id: string) => {
    try {
      engine.removeDownload(id);
      return { success: true };
    } catch (error: any) {
      log.error('[IPC] download:remove failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Get all downloads
  ipcMain.handle(IPC.DOWNLOAD_LIST, async () => {
    try {
      const downloads = models.getAllDownloads();
      return { success: true, downloads };
    } catch (error: any) {
      log.error('[IPC] download:list failed:', error.message);
      return { success: false, error: error.message };
    }
  });

  // Open downloaded file
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE, async (_event, id: string) => {
    try {
      const item = models.getDownload(id);
      if (item) {
        await shell.openPath(item.savePath);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Open folder containing the download
  ipcMain.handle(IPC.DOWNLOAD_OPEN_FOLDER, async (_event, id: string) => {
    try {
      const item = models.getDownload(id);
      if (item) {
        shell.showItemInFolder(item.savePath);
      }
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  // Select folder dialog
  ipcMain.handle(IPC.DIALOG_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    });
    return result.filePaths[0] || null;
  });

  // Queue operations
  ipcMain.handle(IPC.QUEUE_SET_PRIORITY, async (_event, id: string, priority: Priority) => {
    try {
      queueManager.setPriority(id, priority);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });

  log.info('[IPC] Download handlers registered');
}
