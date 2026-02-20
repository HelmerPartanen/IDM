import https from 'https';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { SegmentDownloader } from './segment';
import { allocateFile, openFileForResume, closeFile, verifyFileSize } from './file-allocator';
import { DEFAULT_RETRY_CONFIG } from './retry';
import * as models from '../db/models';
import type {
  DownloadItem, SegmentInfo, AddDownloadRequest, DownloadStatus,
  DownloadProgressUpdate, AppSettings, RetryConfig
} from '../../shared/types';

export type { RetryConfig };

export interface EngineEvents {
  'download-added': (item: DownloadItem) => void;
  'download-progress': (update: DownloadProgressUpdate) => void;
  'download-complete': (item: DownloadItem) => void;
  'download-error': (id: string, error: string) => void;
  'download-paused': (id: string) => void;
  'download-resumed': (id: string) => void;
  'download-cancelled': (id: string) => void;
  'status-changed': (id: string, status: DownloadStatus) => void;
}

interface ActiveDownload {
  item: DownloadItem;
  segments: SegmentDownloader[];
  segmentInfos: SegmentInfo[];
  fd: number | null;
  speedSamples: number[];
  lastProgressTime: number;
  hashStream: crypto.Hash | null;
}

export class DownloadEngine extends EventEmitter {
  private activeDownloads: Map<string, ActiveDownload> = new Map();
  private settings: AppSettings;
  private retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG;

  constructor(settings: AppSettings) {
    super();
    this.settings = settings;
  }

  updateSettings(settings: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...settings };
  }

  getActiveDownloadIds(): string[] {
    return Array.from(this.activeDownloads.keys());
  }

  getProgressUpdates(): DownloadProgressUpdate[] {
    const updates: DownloadProgressUpdate[] = [];
    for (const [id, active] of this.activeDownloads) {
      const now = Date.now();
      const speed = this.calculateSpeed(active);
      const eta = speed > 0
        ? (active.item.totalSize - active.item.downloadedBytes) / speed
        : 0;

      updates.push({
        id,
        downloadedBytes: active.item.downloadedBytes,
        speed,
        eta,
        status: active.item.status,
        segments: active.segmentInfos
      });
    }
    return updates;
  }

  /**
   * Add and start a new download.
   */
  async addDownload(request: AddDownloadRequest): Promise<DownloadItem> {
    const { url, referrer, priority, checksum, checksumType } = request;

    // Probe the URL to get file info
    const probeResult = await this.probeUrl(url, referrer || null);

    const filename = request.filename || probeResult.filename || this.filenameFromUrl(url);
    const savePath = request.savePath || path.join(this.settings.downloadFolder, filename);
    const threads = request.threads || this.settings.maxThreadsPerDownload;

    // Ensure the save directory exists
    const saveDir = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }

    const item: DownloadItem = {
      id: uuidv4(),
      url,
      filename,
      savePath,
      totalSize: probeResult.totalSize,
      downloadedBytes: 0,
      status: 'pending',
      speed: 0,
      eta: 0,
      threads: probeResult.supportsRange ? threads : 1,
      priority: priority || 'normal',
      createdAt: Date.now(),
      completedAt: null,
      resumable: probeResult.supportsRange,
      checksum: checksum || null,
      checksumType: checksumType || null,
      error: null,
      referrer: referrer || null,
      mime: probeResult.mime || null
    };

    // Save to database
    models.insertDownload(item);

    this.emit('download-added', item);
    this.emit('status-changed', item.id, item.status);

    return item;
  }

  /**
   * Start downloading a pending/queued item.
   */
  async startDownload(id: string): Promise<void> {
    const item = models.getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);

    if (item.status === 'downloading') return;

    try {
      this.setStatus(id, 'downloading');

      if (item.resumable && item.totalSize > 0) {
        await this.startMultiSegmentDownload(item);
      } else {
        await this.startSingleConnectionDownload(item);
      }
    } catch (error: any) {
      log.error(`[Engine] Download failed: ${id}`, error.message);
      this.setStatus(id, 'error');
      models.updateDownload(id, { error: error.message, status: 'error' });
      this.emit('download-error', id, error.message);
      this.cleanupActiveDownload(id);
    }
  }

  /**
   * Pause an active download.
   */
  async pauseDownload(id: string): Promise<void> {
    const active = this.activeDownloads.get(id);
    if (!active) return;

    // Pause all segments
    for (const seg of active.segments) {
      seg.pause();
    }

    // Save progress to DB
    models.updateDownload(id, {
      downloadedBytes: active.item.downloadedBytes,
      status: 'paused'
    });

    if (active.segmentInfos.length > 0) {
      models.bulkUpdateSegments(id, active.segmentInfos.map(s => {
        const downloader = active.segments.find((_, i) => i === s.index);
        return downloader ? downloader.segmentInfo : s;
      }));
    }

    this.setStatus(id, 'paused');
    this.emit('download-paused', id);
    this.cleanupActiveDownload(id);
  }

  /**
   * Resume a paused download.
   */
  async resumeDownload(id: string): Promise<void> {
    const item = models.getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);
    if (item.status !== 'paused' && item.status !== 'error') return;

    this.emit('download-resumed', id);
    await this.startDownload(id);
  }

  /**
   * Cancel and remove a download.
   */
  async cancelDownload(id: string): Promise<void> {
    const active = this.activeDownloads.get(id);
    if (active) {
      for (const seg of active.segments) {
        seg.cancel();
      }
      this.cleanupActiveDownload(id);
    }

    // Remove partial file
    const item = models.getDownload(id);
    if (item && fs.existsSync(item.savePath)) {
      try {
        fs.unlinkSync(item.savePath);
      } catch (e) { /* ignore */ }
    }

    this.setStatus(id, 'error');
    models.updateDownload(id, { status: 'error', error: 'Cancelled by user' });
    this.emit('download-cancelled', id);
  }

  /**
   * Retry a failed download.
   */
  async retryDownload(id: string): Promise<void> {
    const item = models.getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);

    // Reset progress
    models.updateDownload(id, {
      downloadedBytes: 0,
      status: 'pending',
      error: null
    });
    models.deleteSegments(id);

    await this.startDownload(id);
  }

  /**
   * Remove a download completely from the database.
   */
  removeDownload(id: string): void {
    const active = this.activeDownloads.get(id);
    if (active) {
      for (const seg of active.segments) {
        seg.cancel();
      }
      this.cleanupActiveDownload(id);
    }
    models.deleteSegments(id);
    models.deleteDownload(id);
  }

  // ─── PRIVATE METHODS ──────────────────────────────────────────────────────

  private async startMultiSegmentDownload(item: DownloadItem): Promise<void> {
    log.info(`[Engine] Starting multi-segment download: ${item.filename} (${item.threads} threads)`);

    // Check for existing segments (resume case)
    let segmentInfos = models.getSegments(item.id);
    const isResume = segmentInfos.length > 0;
    let fd: number;

    if (isResume) {
      fd = await openFileForResume(item.savePath);
      log.info(`[Engine] Resuming download with ${segmentInfos.filter(s => s.status !== 'completed').length} incomplete segments`);
    } else {
      // Create new segments
      segmentInfos = this.createSegments(item.id, item.totalSize, item.threads);
      models.insertSegments(segmentInfos);
      fd = await allocateFile(item.savePath, item.totalSize);
    }

    const speedPerSegment = this.settings.speedLimitEnabled
      ? Math.floor(this.settings.speedLimitBytesPerSec / item.threads)
      : 0;

    const active: ActiveDownload = {
      item: { ...item, status: 'downloading' },
      segments: [],
      segmentInfos,
      fd,
      speedSamples: [],
      lastProgressTime: Date.now(),
      hashStream: null
    };

    this.activeDownloads.set(item.id, active);

    // Create segment downloaders for incomplete segments
    const incompleteSegments = segmentInfos.filter(s => s.status !== 'completed');
    const completedCount = segmentInfos.length - incompleteSegments.length;

    // Track downloaded bytes from completed segments
    active.item.downloadedBytes = segmentInfos.reduce((sum, s) => sum + s.downloadedBytes, 0);

    const segmentPromises: Promise<void>[] = [];

    for (const segInfo of incompleteSegments) {
      const downloader = new SegmentDownloader(
        segInfo,
        item.url,
        fd,
        this.retryConfig,
        speedPerSegment,
        item.referrer
      );

      downloader.on('progress', (index: number, bytesDownloaded: number, chunkSize: number) => {
        active.item.downloadedBytes += chunkSize;
        active.speedSamples.push(chunkSize);

        // Update segment info
        const segIdx = active.segmentInfos.findIndex(s => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].downloadedBytes = bytesDownloaded;
          active.segmentInfos[segIdx].status = 'active';
        }
      });

      downloader.on('complete', (index: number) => {
        const segIdx = active.segmentInfos.findIndex(s => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].status = 'completed';
        }
        models.updateSegment(item.id, index, { status: 'completed', downloadedBytes: active.segmentInfos[segIdx]?.downloadedBytes });
      });

      downloader.on('error', (index: number, error: Error) => {
        log.error(`[Engine] Segment ${index} error for ${item.id}:`, error.message);
        const segIdx = active.segmentInfos.findIndex(s => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].status = 'error';
        }
      });

      active.segments.push(downloader);
      segmentPromises.push(downloader.start());
    }

    // Wait for all segments to complete
    try {
      await Promise.all(segmentPromises);

      if (active.item.status !== 'downloading') {
        return; // Paused or cancelled
      }

      // Close file
      await closeFile(fd);
      active.fd = null;

      // Verify file size
      if (item.totalSize > 0) {
        const sizeOk = await verifyFileSize(item.savePath, item.totalSize);
        if (!sizeOk) {
          throw new Error(`File size mismatch: expected ${item.totalSize} bytes`);
        }
      }

      // Verify checksum if provided
      if (item.checksum && item.checksumType) {
        this.setStatus(item.id, 'verifying');
        const computedHash = await this.computeFileHash(item.savePath, item.checksumType);
        if (computedHash.toLowerCase() !== item.checksum.toLowerCase()) {
          throw new Error(`Checksum mismatch: expected ${item.checksum}, got ${computedHash}`);
        }
        log.info(`[Engine] Checksum verified for ${item.filename}`);
      }

      // Mark complete
      const now = Date.now();
      models.updateDownload(item.id, {
        status: 'completed',
        downloadedBytes: item.totalSize,
        completedAt: now
      });
      active.item.status = 'completed';
      active.item.completedAt = now;

      this.setStatus(item.id, 'completed');
      this.emit('download-complete', active.item);
      this.activeDownloads.delete(item.id);

      log.info(`[Engine] Download complete: ${item.filename}`);
    } catch (error: any) {
      if (active.fd !== null) {
        await closeFile(active.fd).catch(() => {});
      }
      throw error;
    }
  }

  private async startSingleConnectionDownload(item: DownloadItem): Promise<void> {
    log.info(`[Engine] Starting single-connection download: ${item.filename}`);

    const active: ActiveDownload = {
      item: { ...item, status: 'downloading' },
      segments: [],
      segmentInfos: [],
      fd: null,
      speedSamples: [],
      lastProgressTime: Date.now(),
      hashStream: null
    };

    this.activeDownloads.set(item.id, active);

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(item.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'IDM-Clone/1.0',
        'Accept': '*/*',
        'Connection': 'keep-alive'
      };

      if (item.referrer) {
        headers['Referer'] = item.referrer;
      }

      const writeStream = fs.createWriteStream(item.savePath);

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        timeout: 30000
      };

      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          // Follow redirect
          res.resume();
          item.url = new URL(res.headers.location, item.url).href;
          this.startSingleConnectionDownload(item).then(resolve).catch(reject);
          return;
        }

        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }

        const totalSize = parseInt(res.headers['content-length'] || '0', 10);
        if (totalSize > 0 && active.item.totalSize === 0) {
          active.item.totalSize = totalSize;
          models.updateDownload(item.id, { totalSize });
        }

        res.on('data', (chunk: Buffer) => {
          if (active.item.status !== 'downloading') {
            res.destroy();
            writeStream.end();
            return resolve();
          }
          active.item.downloadedBytes += chunk.length;
          active.speedSamples.push(chunk.length);
        });

        res.pipe(writeStream);

        writeStream.on('finish', async () => {
          models.updateDownload(item.id, {
            status: 'completed',
            downloadedBytes: active.item.downloadedBytes,
            totalSize: active.item.totalSize || active.item.downloadedBytes,
            completedAt: Date.now()
          });
          active.item.status = 'completed';
          this.setStatus(item.id, 'completed');
          this.emit('download-complete', active.item);
          this.activeDownloads.delete(item.id);
          resolve();
        });

        writeStream.on('error', reject);
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });

      req.end();
    });
  }

  private createSegments(downloadId: string, totalSize: number, threads: number): SegmentInfo[] {
    const segmentSize = Math.ceil(totalSize / threads);
    const segments: SegmentInfo[] = [];

    for (let i = 0; i < threads; i++) {
      const startByte = i * segmentSize;
      const endByte = Math.min((i + 1) * segmentSize - 1, totalSize - 1);

      segments.push({
        id: 0, // Auto-assigned by DB
        downloadId,
        index: i,
        startByte,
        endByte,
        downloadedBytes: 0,
        status: 'pending'
      });
    }

    return segments;
  }

  private async probeUrl(url: string, referrer: string | null): Promise<{
    totalSize: number;
    supportsRange: boolean;
    filename: string | null;
    mime: string | null;
  }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers: Record<string, string> = {
        'User-Agent': 'IDM-Clone/1.0',
        'Accept': '*/*'
      };

      if (referrer) {
        headers['Referer'] = referrer;
      }

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'HEAD',
        headers,
        timeout: 15000
      };

      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;

        // Follow redirects for HEAD
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          const newUrl = new URL(res.headers.location, url).href;
          this.probeUrl(newUrl, referrer).then(resolve).catch(reject);
          return;
        }

        if (statusCode !== 200 && statusCode !== 206) {
          res.resume();
          // Fall back to unknown size
          return resolve({
            totalSize: 0,
            supportsRange: false,
            filename: null,
            mime: null
          });
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        const acceptRanges = res.headers['accept-ranges'];
        const supportsRange = acceptRanges === 'bytes' ||
          (contentLength > 0 && acceptRanges !== 'none');

        // Extract filename from Content-Disposition
        let filename: string | null = null;
        const contentDisp = res.headers['content-disposition'];
        if (contentDisp) {
          const match = contentDisp.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
          if (match) {
            filename = decodeURIComponent(match[1]);
          }
        }

        const mime = res.headers['content-type']?.split(';')[0]?.trim() || null;

        res.resume();
        resolve({
          totalSize: contentLength,
          supportsRange,
          filename,
          mime
        });
      });

      req.on('error', (err) => {
        log.warn(`[Engine] HEAD request failed for ${url}:`, err.message);
        // Don't reject — fall back to single-connection
        resolve({
          totalSize: 0,
          supportsRange: false,
          filename: null,
          mime: null
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          totalSize: 0,
          supportsRange: false,
          filename: null,
          mime: null
        });
      });

      req.end();
    });
  }

  private filenameFromUrl(url: string): string {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 0) {
        return decodeURIComponent(segments[segments.length - 1]);
      }
    } catch { /* ignore */ }
    return `download_${Date.now()}`;
  }

  private calculateSpeed(active: ActiveDownload): number {
    const now = Date.now();
    const elapsed = (now - active.lastProgressTime) / 1000;

    if (elapsed <= 0) return active.item.speed;

    const totalBytes = active.speedSamples.reduce((sum, b) => sum + b, 0);
    const speed = totalBytes / elapsed;

    // Reset samples periodically
    if (elapsed >= 1) {
      active.speedSamples = [];
      active.lastProgressTime = now;
      active.item.speed = speed;
    }

    return speed;
  }

  private setStatus(id: string, status: DownloadStatus): void {
    const active = this.activeDownloads.get(id);
    if (active) {
      active.item.status = status;
    }
    models.updateDownload(id, { status });
    this.emit('status-changed', id, status);
  }

  private async cleanupActiveDownload(id: string): Promise<void> {
    const active = this.activeDownloads.get(id);
    if (!active) return;

    if (active.fd !== null) {
      try {
        await closeFile(active.fd);
      } catch { /* ignore */ }
    }

    this.activeDownloads.delete(id);
  }

  private computeFileHash(filePath: string, algorithm: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm.toLowerCase());
      const stream = fs.createReadStream(filePath);

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }
}
