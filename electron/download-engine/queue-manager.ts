import PQueue from 'p-queue';
import log from 'electron-log';
import { DownloadEngine } from './engine';
import type { DownloadItem, Priority, AppSettings } from '../../shared/types';
import * as models from '../db/models';

/**
 * Manages the global download queue with concurrency limits and priority support.
 * Uses p-queue for reliable concurrency control.
 * Supports auto-retry of failed downloads when enabled in settings.
 */
export class QueueManager {
  private engine: DownloadEngine;
  private queue: PQueue;
  private pendingItems: Map<string, { priority: number; addedAt: number }> = new Map();
  private retryCounts: Map<string, number> = new Map();
  private settings: AppSettings;

  constructor(engine: DownloadEngine, maxConcurrent: number = 3, settings?: AppSettings) {
    this.engine = engine;
    this.settings = settings || {} as AppSettings;

    this.queue = new PQueue({
      concurrency: maxConcurrent,
      autoStart: true
    });

    // When a download completes, clean up and log queue status
    this.engine.on('download-complete', (item: DownloadItem) => {
      log.info(`[QueueManager] Download complete: ${item.filename}. Queue: ${this.queue.size} pending, ${this.queue.pending} active`);
      this.pendingItems.delete(item.id);
      this.retryCounts.delete(item.id);
    });

    this.engine.on('download-error', (id: string, error: string) => {
      this.pendingItems.delete(id);

      // Auto-retry the download if enabled
      if (this.settings.autoRetryFailed) {
        const retries = this.retryCounts.get(id) || 0;
        const maxRetries = this.settings.maxRetries || 3;
        if (retries < maxRetries) {
          this.retryCounts.set(id, retries + 1);
          const delay = Math.min(5000 * Math.pow(2, retries), 60000);
          log.info(`[QueueManager] Auto-retrying ${id} in ${delay / 1000}s (attempt ${retries + 1}/${maxRetries})`);
          setTimeout(async () => {
            const item = models.getDownload(id);
            if (item && item.status === 'error') {
              try {
                await this.engine.retryDownload(id);
                await this.enqueue(id, item.priority);
              } catch (e: any) {
                log.error(`[QueueManager] Auto-retry of ${id} failed:`, e.message);
              }
            }
          }, delay);
        } else {
          log.info(`[QueueManager] Auto-retry exhausted for ${id} (${maxRetries} attempts)`);
          this.retryCounts.delete(id);
        }
      }
    });

    this.engine.on('download-cancelled', (id: string) => {
      this.pendingItems.delete(id);
      this.retryCounts.delete(id);
    });
  }

  /**
   * Update settings (e.g. when user changes them at runtime).
   */
  updateSettings(settings: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  /**
   * Set the maximum number of concurrent downloads.
   */
  setConcurrency(maxConcurrent: number): void {
    this.queue.concurrency = maxConcurrent;
    log.info(`[QueueManager] Concurrency set to ${maxConcurrent}`);
  }

  /**
   * Enqueue a download. It will start when a slot is available.
   * Skips items that are already actively downloading to prevent double-starts.
   */
  async enqueue(id: string, priority: Priority = 'normal'): Promise<void> {
    // Guard: skip if already downloading
    if (this.engine.getActiveDownloadIds().includes(id)) {
      return;
    }

    const priorityValue = this.priorityToNumber(priority);

    this.pendingItems.set(id, { priority: priorityValue, addedAt: Date.now() });

    // If the item is not yet downloading, set status to queued
    const item = models.getDownload(id);
    if (item && item.status === 'pending') {
      models.updateDownload(id, { status: 'queued' });
      this.engine.emit('status-changed', id, 'queued');
    }

    await this.queue.add(
      async () => {
        const current = models.getDownload(id);
        if (!current || current.status === 'completed' || current.status === 'error') {
          return;
        }
        // Double-check not already active (race condition guard)
        if (this.engine.getActiveDownloadIds().includes(id)) {
          return;
        }
        try {
          await this.engine.startDownload(id);
        } catch (error: any) {
          log.error(`[QueueManager] Failed to start download ${id}:`, error.message);
        }
      },
      { priority: priorityValue }
    );
  }

  /**
   * Update the priority of a queued download.
   */
  setPriority(id: string, priority: Priority): void {
    models.updateDownload(id, { priority });
    const pending = this.pendingItems.get(id);
    if (pending) {
      pending.priority = this.priorityToNumber(priority);
    }
  }

  /**
   * Pause all active downloads.
   */
  async pauseAll(): Promise<void> {
    this.queue.pause();
    const activeIds = this.engine.getActiveDownloadIds();
    await Promise.allSettled(activeIds.map(id => this.engine.pauseDownload(id)));
    log.info('[QueueManager] All downloads paused');
  }

  /**
   * Resume all paused downloads.
   */
  async resumeAll(): Promise<void> {
    this.queue.start();
    const pausedDownloads = models.getDownloadsByStatus('paused');
    for (const item of pausedDownloads) {
      await this.enqueue(item.id, item.priority);
    }
    log.info('[QueueManager] All downloads resumed');
  }

  /**
   * Get queue statistics.
   */
  getStats(): { pending: number; active: number; size: number } {
    return {
      pending: this.queue.size,
      active: this.queue.pending,
      size: this.queue.size + this.queue.pending
    };
  }

  /**
   * Clear all pending items from the queue.
   */
  clear(): void {
    this.queue.clear();
    this.pendingItems.clear();
  }

  private priorityToNumber(priority: Priority): number {
    switch (priority) {
      case 'high': return 2;
      case 'normal': return 1;
      case 'low': return 0;
      default: return 1;
    }
  }
}
