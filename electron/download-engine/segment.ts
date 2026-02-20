import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { writeAtOffset } from './file-allocator';
import { withRetry } from './retry';
import { httpsAgent, httpAgent } from './engine';
import type { SegmentInfo, SegmentStatus } from '../../shared/types';
import type { RetryConfig } from '../../shared/types';

/** Browser-like User-Agent to avoid server blocks */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** If no data arrives for this many ms, the segment is considered stalled */
const STALL_TIMEOUT_MS = 45000;

export interface SegmentEvents {
  progress: (segmentIndex: number, bytesDownloaded: number, chunkSize: number) => void;
  complete: (segmentIndex: number) => void;
  error: (segmentIndex: number, error: Error) => void;
  paused: (segmentIndex: number) => void;
}

export class SegmentDownloader extends EventEmitter {
  private segment: SegmentInfo;
  private url: string;
  private fd: number;
  private retryConfig: RetryConfig;
  private currentRequest: http.ClientRequest | null = null;
  private _paused = false;
  private _cancelled = false;
  private speedLimit: number; // bytes per second, 0 = unlimited
  private referrer: string | null;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    segment: SegmentInfo,
    url: string,
    fd: number,
    retryConfig: RetryConfig,
    speedLimit: number = 0,
    referrer: string | null = null
  ) {
    super();
    this.segment = { ...segment };
    this.url = url;
    this.fd = fd;
    this.retryConfig = retryConfig;
    this.speedLimit = speedLimit;
    this.referrer = referrer;
  }

  get paused(): boolean {
    return this._paused;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  get segmentInfo(): SegmentInfo {
    return { ...this.segment };
  }

  async start(): Promise<void> {
    if (this._cancelled) return;

    await withRetry(
      () => this.downloadSegment(),
      this.retryConfig,
      `Segment ${this.segment.index}`
    );
  }

  pause(): void {
    this._paused = true;
    this.clearStallTimer();
    this.abort();
    this.segment.status = 'paused';
    this.emit('paused', this.segment.index);
  }

  cancel(): void {
    this._cancelled = true;
    this.clearStallTimer();
    this.abort();
  }

  resume(): void {
    this._paused = false;
  }

  private abort(): void {
    if (this.currentRequest) {
      this.currentRequest.destroy();
      this.currentRequest = null;
    }
  }

  private resetStallTimer(res: http.IncomingMessage, reject: (err: Error) => void): void {
    this.clearStallTimer();
    this.stallTimer = setTimeout(() => {
      log.warn(`[Segment ${this.segment.index}] Stall detected — no data for ${STALL_TIMEOUT_MS / 1000}s`);
      res.destroy();
      const err = new Error(`Stall timeout on segment ${this.segment.index}`);
      (err as any).code = 'ETIMEDOUT';
      reject(err);
    }, STALL_TIMEOUT_MS);
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  private downloadSegment(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._paused || this._cancelled) {
        return resolve();
      }

      const startByte = this.segment.startByte + this.segment.downloadedBytes;
      const endByte = this.segment.endByte;

      if (startByte > endByte) {
        // Segment already complete
        this.segment.status = 'completed';
        this.emit('complete', this.segment.index);
        return resolve();
      }

      const parsedUrl = new URL(this.url);
      const isHttps = parsedUrl.protocol === 'https:';
      const httpModule = isHttps ? https : http;

      const headers: Record<string, string> = {
        'Range': `bytes=${startByte}-${endByte}`,
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Encoding': 'identity', // Don't use compression — we need exact byte ranges
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
      };

      if (this.referrer) {
        headers['Referer'] = this.referrer;
      }

      const options: http.RequestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers,
        agent: isHttps ? httpsAgent : httpAgent,
        timeout: 30000
      };

      this.segment.status = 'active';

      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;

        // Handle redirects within segment download
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          this.url = new URL(res.headers.location, this.url).href;
          log.info(`[Segment ${this.segment.index}] Following redirect to: ${this.url}`);
          // Retry with new URL
          this.downloadSegment().then(resolve).catch(reject);
          return;
        }

        // 206 Partial Content is expected for Range requests
        // 200 OK means server doesn't support ranges — only valid for first/only segment
        if (statusCode !== 206 && statusCode !== 200) {
          const error = new Error(`HTTP ${statusCode} for segment ${this.segment.index}`);
          (error as any).statusCode = statusCode;
          res.resume(); // Drain the response
          return reject(error);
        }

        let writeOffset = startByte;
        let tokenBucket = this.speedLimit > 0 ? this.speedLimit : Infinity;
        let lastTokenRefill = Date.now();

        // Start stall detection
        this.resetStallTimer(res, reject);

        res.on('data', async (chunk: Buffer) => {
          if (this._paused || this._cancelled) {
            this.clearStallTimer();
            res.destroy();
            return resolve();
          }

          // Reset stall timer on each data chunk
          this.resetStallTimer(res, reject);

          try {
            // Speed limiting via token bucket
            if (this.speedLimit > 0) {
              const now = Date.now();
              const elapsed = (now - lastTokenRefill) / 1000;
              lastTokenRefill = now;
              tokenBucket = Math.min(this.speedLimit, tokenBucket + this.speedLimit * elapsed);

              if (tokenBucket < chunk.length) {
                // Pause the stream until we have enough tokens
                res.pause();
                const waitMs = ((chunk.length - tokenBucket) / this.speedLimit) * 1000;
                await new Promise(r => setTimeout(r, waitMs));
                if (this._paused || this._cancelled) {
                  this.clearStallTimer();
                  res.destroy();
                  return resolve();
                }
                tokenBucket = chunk.length; // Refill
                res.resume();
              }
              tokenBucket -= chunk.length;
            }

            // Write directly to the correct file offset
            await writeAtOffset(this.fd, chunk, writeOffset, chunk.length);
            writeOffset += chunk.length;
            this.segment.downloadedBytes += chunk.length;

            this.emit('progress', this.segment.index, this.segment.downloadedBytes, chunk.length);
          } catch (writeError) {
            this.clearStallTimer();
            res.destroy();
            reject(writeError);
          }
        });

        res.on('end', () => {
          this.clearStallTimer();
          if (this._paused || this._cancelled) {
            return resolve();
          }
          this.segment.status = 'completed';
          this.emit('complete', this.segment.index);
          resolve();
        });

        res.on('error', (err) => {
          this.clearStallTimer();
          reject(err);
        });
      });

      req.on('error', (err) => {
        this.clearStallTimer();
        reject(err);
      });

      req.on('timeout', () => {
        this.clearStallTimer();
        req.destroy();
        const error = new Error(`Timeout for segment ${this.segment.index}`);
        (error as any).code = 'ETIMEDOUT';
        reject(error);
      });

      this.currentRequest = req;
      req.end();
    });
  }
}
