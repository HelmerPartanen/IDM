import log from 'electron-log';
import * as models from '../db/models';
import { DownloadEngine } from './engine';
import { QueueManager } from './queue-manager';
import type { ScheduleInfo } from '../../shared/types';

/**
 * Manages scheduled downloads, setting timers for future downloads
 * and optionally auto-shutting down the system on completion.
 */
export class Scheduler {
  private engine: DownloadEngine;
  private queueManager: QueueManager;
  private timers: Map<number, NodeJS.Timeout> = new Map();
  private shutdownTimer: NodeJS.Timeout | null = null;

  constructor(engine: DownloadEngine, queueManager: QueueManager) {
    this.engine = engine;
    this.queueManager = queueManager;
  }

  /**
   * Load all saved schedules from the database and set timers.
   */
  initialize(): void {
    const schedules = models.getSchedules();
    for (const schedule of schedules) {
      this.setTimer(schedule);
    }
    log.info(`[Scheduler] Initialized with ${schedules.length} scheduled downloads`);
  }

  /**
   * Add a new scheduled download.
   */
  addSchedule(schedule: Omit<ScheduleInfo, 'id'>): number {
    const id = models.insertSchedule(schedule);
    const fullSchedule = { ...schedule, id };
    this.setTimer(fullSchedule);
    log.info(`[Scheduler] Added schedule #${id} for download ${schedule.downloadId} at ${new Date(schedule.scheduledTime).toISOString()}`);
    return id;
  }

  /**
   * Remove a scheduled download.
   */
  removeSchedule(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    models.deleteSchedule(id);
    log.info(`[Scheduler] Removed schedule #${id}`);
  }

  /**
   * Get all active schedules.
   */
  getSchedules(): ScheduleInfo[] {
    return models.getSchedules();
  }

  /**
   * Stop all scheduled timers.
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
  }

  private setTimer(schedule: ScheduleInfo): void {
    const now = Date.now();
    let delay = schedule.scheduledTime - now;

    if (delay <= 0) {
      // Past schedule — run immediately if within 5 minutes
      if (Math.abs(delay) < 5 * 60 * 1000) {
        delay = 0;
      } else if (schedule.repeat === 'none') {
        // Too old, skip
        log.info(`[Scheduler] Skipping past schedule #${schedule.id}`);
        return;
      } else {
        // Calculate next occurrence
        delay = this.getNextOccurrenceDelay(schedule);
      }
    }

    const timer = setTimeout(async () => {
      this.timers.delete(schedule.id);

      try {
        log.info(`[Scheduler] Triggering scheduled download ${schedule.downloadId}`);
        await this.queueManager.enqueue(schedule.downloadId);

        // Handle auto-shutdown
        if (schedule.autoShutdown) {
          this.setupAutoShutdown(schedule.downloadId);
        }

        // Handle recurring schedules
        if (schedule.repeat !== 'none') {
          const nextDelay = this.getNextOccurrenceDelay(schedule);
          const nextTime = Date.now() + nextDelay;
          const nextSchedule = { ...schedule, scheduledTime: nextTime };
          this.setTimer(nextSchedule);
        }
      } catch (error: any) {
        log.error(`[Scheduler] Failed to trigger schedule #${schedule.id}:`, error.message);
      }
    }, delay);

    this.timers.set(schedule.id, timer);
  }

  private getNextOccurrenceDelay(schedule: ScheduleInfo): number {
    const now = Date.now();
    let nextTime = schedule.scheduledTime;

    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;

    const interval = schedule.repeat === 'daily' ? dayMs : weekMs;

    while (nextTime <= now) {
      nextTime += interval;
    }

    return nextTime - now;
  }

  private setupAutoShutdown(downloadId: string): void {
    // Monitor download completion, then initiate shutdown
    const checkInterval = setInterval(() => {
      const item = models.getDownload(downloadId);
      if (!item) {
        clearInterval(checkInterval);
        return;
      }

      if (item.status === 'completed') {
        clearInterval(checkInterval);
        log.info('[Scheduler] All scheduled downloads complete. Auto-shutdown in 60 seconds.');

        // Give user 60 seconds to cancel
        this.shutdownTimer = setTimeout(() => {
          const { exec } = require('child_process');
          exec('shutdown /s /t 0', (error: any) => {
            if (error) {
              log.error('[Scheduler] Failed to initiate shutdown:', error.message);
            }
          });
        }, 60000);
      } else if (item.status === 'error') {
        clearInterval(checkInterval);
        log.info('[Scheduler] Download failed — auto-shutdown cancelled');
      }
    }, 5000);
  }

  cancelShutdown(): void {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      log.info('[Scheduler] Auto-shutdown cancelled');

      // Also cancel any pending Windows shutdown
      const { exec } = require('child_process');
      exec('shutdown /a', () => {});
    }
  }
}
