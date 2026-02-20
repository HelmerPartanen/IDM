import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { DownloadEngine } from './engine';
import { IPC } from '../../shared/types';
import type { DownloadProgressUpdate } from '../../shared/types';

/**
 * Sends batched progress updates from the download engine to the renderer process.
 * Throttled to ~10 Hz (every 100ms) for optimal UI performance.
 */
export class ProgressTracker {
  private engine: DownloadEngine;
  private mainWindow: BrowserWindow | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private updateIntervalMs = 100; // 10 updates per second

  constructor(engine: DownloadEngine) {
    this.engine = engine;
  }

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  start(): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      this.sendProgressBatch();
    }, this.updateIntervalMs);

    log.info('[ProgressTracker] Started progress tracking');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private sendProgressBatch(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    const updates = this.engine.getProgressUpdates();
    if (updates.length === 0) return;

    try {
      this.mainWindow.webContents.send(IPC.DOWNLOAD_PROGRESS_BATCH, updates);
    } catch (error) {
      // Window may have been closed
    }
  }
}
