import https from 'https';
import http from 'http';
import { EventEmitter } from 'events';
import log from 'electron-log';
import { writeAtOffset } from './file-allocator';
import { withRetry } from './retry';
import type { SegmentInfo, SegmentStatus } from '../../shared/types';
import type { RetryConfig } from '../../shared/types';

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
  private abortController: AbortController | null = null;
  private currentRequest: http.ClientRequest | null = null;
  private _paused = false;
  private _cancelled = false;
  private speedLimit: number; // bytes per second, 0 = unlimited
  private referrer: string | null;

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
    this.abort();
    this.segment.status = 'paused';
    this.emit('paused', this.segment.index);
  }

  cancel(): void {
    this._cancelled = true;
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
        'User-Agent': 'IDM-Clone/1.0',
        'Accept': '*/*',
        'Accept-Encoding': 'identity', // Don't use compression — we need exact byte ranges
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
        timeout: 30000
      };

      this.segment.status = 'active';

      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;

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

        res.on('data', async (chunk: Buffer) => {
          if (this._paused || this._cancelled) {
            res.destroy();
            return resolve();
          }

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
            res.destroy();
            reject(writeError);
          }
        });

        res.on('end', () => {
          if (this._paused || this._cancelled) {
            return resolve();
          }
          this.segment.status = 'completed';
          this.emit('complete', this.segment.index);
          resolve();
        });

        res.on('error', (err) => {
          reject(err);
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
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
