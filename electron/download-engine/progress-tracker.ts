import { BrowserWindow } from 'electron';
import log from 'electron-log';
import { DownloadEngine } from './engine';
import { IPC } from '../../shared/types';
import type { DownloadProgressUpdate } from '../../shared/types';

/**
 * Sends batched progress updates from the download engine to the renderer process.
 * Only runs its interval when there are active downloads — fully idle otherwise.
 * Dynamically adjusts update frequency based on window visibility.
 */
export class ProgressTracker {
  private engine: DownloadEngine;
  private mainWindow: BrowserWindow | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private activeIntervalMs = 100;    // 10 Hz when window is focused
  private backgroundIntervalMs = 500; // 2 Hz when minimized / background
  private isWindowVisible = true;
  private isRunning = false;          // whether the tracker has been started
  private hasActiveDownloads = false; // cached state to avoid unnecessary starts/stops

  constructor(engine: DownloadEngine) {
    this.engine = engine;

    // Auto-start interval when a download becomes active
    const onActivity = () => this.onDownloadsChanged(true);
    engine.on('download-added', onActivity);
    engine.on('download-resumed', onActivity);

    // Auto-stop interval when downloads finish/stop
    const onInactive = () => {
      // Defer check — the engine map is updated after the event fires
      setTimeout(() => this.checkIdle(), 100);
    };
    engine.on('download-complete', onInactive);
    engine.on('download-error', onInactive);
    engine.on('download-paused', onInactive);
    engine.on('download-cancelled', onInactive);
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

  /** Clear the window reference (e.g. when window is destroyed for idle suspension). */
  clearWindow(): void {
    this.mainWindow = null;
  }

  start(): void {
    this.isRunning = true;
    // Only spin up the interval if there are active downloads right now
    if (this.engine.getActiveDownloadIds().length > 0) {
      this.startInterval();
    }
    log.info('[ProgressTracker] Ready (activity-driven)');
  }

  stop(): void {
    this.isRunning = false;
    this.stopInterval();
  }

  /** Returns true when the interval is actually ticking. */
  get isTicking(): boolean {
    return this.intervalId !== null;
  }

  private onDownloadsChanged(active: boolean): void {
    if (!this.isRunning) return;
    if (active && !this.intervalId) {
      this.hasActiveDownloads = true;
      this.startInterval();
    }
  }

  private checkIdle(): void {
    if (!this.isRunning) return;
    const count = this.engine.getActiveDownloadIds().length;
    if (count === 0 && this.intervalId) {
      this.hasActiveDownloads = false;
      this.stopInterval();
      log.info('[ProgressTracker] All downloads idle — interval stopped');
    }
  }

  private startInterval(): void {
    if (this.intervalId) return;
    const ms = this.isWindowVisible ? this.activeIntervalMs : this.backgroundIntervalMs;
    this.intervalId = setInterval(() => this.sendProgressBatch(), ms);
  }

  private stopInterval(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private adjustInterval(): void {
    if (!this.intervalId) return;
    const desiredMs = this.isWindowVisible ? this.activeIntervalMs : this.backgroundIntervalMs;
    clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.sendProgressBatch(), desiredMs);
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
