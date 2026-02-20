import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { DownloadEngine } from './engine';
import { IPC } from '../../shared/types';
import type { DownloadProgressUpdate } from '../../shared/types';

/**
 * Sends batched progress updates from the download engine to the renderer process.
 * Dynamically adjusts update frequency based on window visibility.
 */
export class ProgressTracker {
  private engine: DownloadEngine;
  private mainWindow: BrowserWindow | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private activeIntervalMs = 100;    // 10 Hz when window is focused
  private backgroundIntervalMs = 500; // 2 Hz when minimized / background
  private isWindowVisible = true;

  constructor(engine: DownloadEngine) {
    this.engine = engine;
  }

  setWindow(window: BrowserWindow): void {
    this.mainWindow = window;

    // Track visibility for adaptive throttling
    window.on('show', () => { this.isWindowVisible = true; this.adjustInterval(); });
    window.on('hide', () => { this.isWindowVisible = false; this.adjustInterval(); });
    window.on('minimize', () => { this.isWindowVisible = false; this.adjustInterval(); });
    window.on('restore', () => { this.isWindowVisible = true; this.adjustInterval(); });
    window.on('focus', () => { this.isWindowVisible = true; this.adjustInterval(); });
    window.on('blur', () => { /* keep rate — user may have overlay */ });
  }

  start(): void {
    if (this.intervalId) return;
    this.scheduleInterval(this.activeIntervalMs);
    log.info('[ProgressTracker] Started progress tracking');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private adjustInterval(): void {
    if (!this.intervalId) return;
    const desiredMs = this.isWindowVisible ? this.activeIntervalMs : this.backgroundIntervalMs;
    // Re-schedule at new rate
    clearInterval(this.intervalId);
    this.scheduleInterval(desiredMs);
  }

  private scheduleInterval(ms: number): void {
    this.intervalId = setInterval(() => {
      this.sendProgressBatch();
    }, ms);
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
