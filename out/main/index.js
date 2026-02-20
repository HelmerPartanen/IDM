"use strict";
const electron = require("electron");
const path = require("path");
const utils = require("@electron-toolkit/utils");
const log = require("electron-log");
const fs = require("fs");
const Database = require("better-sqlite3");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const events = require("events");
const uuid = require("uuid");
const Store = require("electron-store");
const net = require("net");
let db = null;
function getDbPath() {
  const userDataPath = electron.app.getPath("userData");
  return path.join(userDataPath, "idm-clone.db");
}
function getDb() {
  if (!db) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return db;
}
function initDatabase() {
  if (db) return db;
  const dbPath = getDbPath();
  log.info(`Initializing database at: ${dbPath}`);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  log.info("Database initialized successfully");
  return db;
}
function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      filename TEXT NOT NULL,
      save_path TEXT NOT NULL,
      total_size INTEGER NOT NULL DEFAULT 0,
      downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      threads INTEGER NOT NULL DEFAULT 8,
      priority TEXT NOT NULL DEFAULT 'normal',
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      resumable INTEGER NOT NULL DEFAULT 1,
      checksum TEXT,
      checksum_type TEXT,
      error TEXT,
      referrer TEXT,
      mime TEXT,
      speed REAL NOT NULL DEFAULT 0,
      eta REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      download_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      start_byte INTEGER NOT NULL,
      end_byte INTEGER NOT NULL,
      downloaded_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      download_id TEXT NOT NULL,
      scheduled_time INTEGER NOT NULL,
      repeat TEXT NOT NULL DEFAULT 'none',
      auto_shutdown INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
    CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at);
    CREATE INDEX IF NOT EXISTS idx_segments_download_id ON segments(download_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_download_id ON schedules(download_id);
    CREATE INDEX IF NOT EXISTS idx_schedules_time ON schedules(scheduled_time);
  `);
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    log.info("Database closed");
  }
}
async function allocateFile(filePath, totalSize) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, "w+", (err, fd) => {
      if (err) {
        log.error(`[FileAllocator] Failed to open file: ${filePath}`, err.message);
        return reject(err);
      }
      if (totalSize <= 0) {
        resolve(fd);
        return;
      }
      fs.ftruncate(fd, totalSize, (err2) => {
        if (err2) {
          log.error(`[FileAllocator] Failed to allocate ${totalSize} bytes for: ${filePath}`, err2.message);
          fs.close(fd, () => {
          });
          return reject(err2);
        }
        log.info(`[FileAllocator] Allocated ${formatBytes(totalSize)} for: ${filePath}`);
        resolve(fd);
      });
    });
  });
}
async function openFileForResume(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, "r+", (err, fd) => {
      if (err) {
        log.error(`[FileAllocator] Failed to open file for resume: ${filePath}`, err.message);
        return reject(err);
      }
      resolve(fd);
    });
  });
}
async function closeFile(fd) {
  return new Promise((resolve, reject) => {
    fs.close(fd, (err) => {
      if (err) {
        log.error(`[FileAllocator] Failed to close fd: ${fd}`, err.message);
        return reject(err);
      }
      resolve();
    });
  });
}
async function writeAtOffset(fd, buffer, offset, length) {
  return new Promise((resolve, reject) => {
    fs.write(fd, buffer, 0, length, offset, (err, bytesWritten) => {
      if (err) {
        return reject(err);
      }
      resolve(bytesWritten);
    });
  });
}
async function verifyFileSize(filePath, expectedSize) {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) return reject(err);
      resolve(stats.size === expectedSize);
    });
  });
}
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
const DEFAULT_RETRY_CONFIG = {
  maxRetries: 5,
  initialDelay: 1e3,
  maxDelay: 3e4,
  backoffFactor: 2,
  jitter: true
};
function calculateRetryDelay(attempt, config = DEFAULT_RETRY_CONFIG) {
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.backoffFactor, attempt),
    config.maxDelay
  );
  if (config.jitter) {
    const jitterFactor = 0.75 + Math.random() * 0.5;
    return Math.floor(baseDelay * jitterFactor);
  }
  return Math.floor(baseDelay);
}
function isRetryableError(error) {
  if (error.code === "ECONNRESET" || error.code === "ECONNREFUSED" || error.code === "ETIMEDOUT" || error.code === "EPIPE" || error.code === "ENOTFOUND" || error.code === "EAI_AGAIN" || error.code === "EHOSTUNREACH" || error.code === "ENETUNREACH") {
    return true;
  }
  const statusCode = error.statusCode || error.response?.statusCode;
  if (statusCode) {
    if (statusCode === 429) return true;
    if (statusCode >= 500 && statusCode < 600) return true;
    if (statusCode >= 400 && statusCode < 500) return false;
  }
  if (error.name === "TimeoutError" || error.message?.includes("timeout")) {
    return true;
  }
  return true;
}
function getRetryAfterMs(error) {
  const retryAfter = error.response?.headers?.["retry-after"];
  if (!retryAfter) return null;
  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1e3;
  }
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }
  return null;
}
async function withRetry(fn, config = DEFAULT_RETRY_CONFIG, label = "operation") {
  let lastError;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries) {
        log.error(`[Retry] ${label}: All ${config.maxRetries} retries exhausted`, error.message);
        throw error;
      }
      if (!isRetryableError(error)) {
        log.error(`[Retry] ${label}: Non-retryable error`, error.message);
        throw error;
      }
      const retryAfter = getRetryAfterMs(error);
      const delay = retryAfter ?? calculateRetryDelay(attempt, config);
      log.warn(`[Retry] ${label}: Attempt ${attempt + 1}/${config.maxRetries} failed. Retrying in ${delay}ms...`, error.message);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
class SegmentDownloader extends events.EventEmitter {
  segment;
  url;
  fd;
  retryConfig;
  abortController = null;
  currentRequest = null;
  _paused = false;
  _cancelled = false;
  speedLimit;
  // bytes per second, 0 = unlimited
  referrer;
  constructor(segment, url, fd, retryConfig, speedLimit = 0, referrer = null) {
    super();
    this.segment = { ...segment };
    this.url = url;
    this.fd = fd;
    this.retryConfig = retryConfig;
    this.speedLimit = speedLimit;
    this.referrer = referrer;
  }
  get paused() {
    return this._paused;
  }
  get cancelled() {
    return this._cancelled;
  }
  get segmentInfo() {
    return { ...this.segment };
  }
  async start() {
    if (this._cancelled) return;
    await withRetry(
      () => this.downloadSegment(),
      this.retryConfig,
      `Segment ${this.segment.index}`
    );
  }
  pause() {
    this._paused = true;
    this.abort();
    this.segment.status = "paused";
    this.emit("paused", this.segment.index);
  }
  cancel() {
    this._cancelled = true;
    this.abort();
  }
  resume() {
    this._paused = false;
  }
  abort() {
    if (this.currentRequest) {
      this.currentRequest.destroy();
      this.currentRequest = null;
    }
  }
  downloadSegment() {
    return new Promise((resolve, reject) => {
      if (this._paused || this._cancelled) {
        return resolve();
      }
      const startByte = this.segment.startByte + this.segment.downloadedBytes;
      const endByte = this.segment.endByte;
      if (startByte > endByte) {
        this.segment.status = "completed";
        this.emit("complete", this.segment.index);
        return resolve();
      }
      const parsedUrl = new URL(this.url);
      const isHttps = parsedUrl.protocol === "https:";
      const httpModule = isHttps ? https : http;
      const headers = {
        "Range": `bytes=${startByte}-${endByte}`,
        "User-Agent": "IDM-Clone/1.0",
        "Accept": "*/*",
        "Accept-Encoding": "identity",
        // Don't use compression — we need exact byte ranges
        "Connection": "keep-alive"
      };
      if (this.referrer) {
        headers["Referer"] = this.referrer;
      }
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers,
        timeout: 3e4
      };
      this.segment.status = "active";
      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;
        if (statusCode !== 206 && statusCode !== 200) {
          const error = new Error(`HTTP ${statusCode} for segment ${this.segment.index}`);
          error.statusCode = statusCode;
          res.resume();
          return reject(error);
        }
        let writeOffset = startByte;
        let tokenBucket = this.speedLimit > 0 ? this.speedLimit : Infinity;
        let lastTokenRefill = Date.now();
        res.on("data", async (chunk) => {
          if (this._paused || this._cancelled) {
            res.destroy();
            return resolve();
          }
          try {
            if (this.speedLimit > 0) {
              const now = Date.now();
              const elapsed = (now - lastTokenRefill) / 1e3;
              lastTokenRefill = now;
              tokenBucket = Math.min(this.speedLimit, tokenBucket + this.speedLimit * elapsed);
              if (tokenBucket < chunk.length) {
                res.pause();
                const waitMs = (chunk.length - tokenBucket) / this.speedLimit * 1e3;
                await new Promise((r) => setTimeout(r, waitMs));
                if (this._paused || this._cancelled) {
                  res.destroy();
                  return resolve();
                }
                tokenBucket = chunk.length;
                res.resume();
              }
              tokenBucket -= chunk.length;
            }
            await writeAtOffset(this.fd, chunk, writeOffset, chunk.length);
            writeOffset += chunk.length;
            this.segment.downloadedBytes += chunk.length;
            this.emit("progress", this.segment.index, this.segment.downloadedBytes, chunk.length);
          } catch (writeError) {
            res.destroy();
            reject(writeError);
          }
        });
        res.on("end", () => {
          if (this._paused || this._cancelled) {
            return resolve();
          }
          this.segment.status = "completed";
          this.emit("complete", this.segment.index);
          resolve();
        });
        res.on("error", (err) => {
          reject(err);
        });
      });
      req.on("error", (err) => {
        reject(err);
      });
      req.on("timeout", () => {
        req.destroy();
        const error = new Error(`Timeout for segment ${this.segment.index}`);
        error.code = "ETIMEDOUT";
        reject(error);
      });
      this.currentRequest = req;
      req.end();
    });
  }
}
function insertDownload(item) {
  const db2 = getDb();
  const stmt = db2.prepare(`
    INSERT INTO downloads (id, url, filename, save_path, total_size, downloaded_bytes, status,
      threads, priority, created_at, completed_at, resumable, checksum, checksum_type, error, referrer, mime, speed, eta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    item.id,
    item.url,
    item.filename,
    item.savePath,
    item.totalSize,
    item.downloadedBytes,
    item.status,
    item.threads,
    item.priority,
    item.createdAt,
    item.completedAt,
    item.resumable ? 1 : 0,
    item.checksum,
    item.checksumType,
    item.error,
    item.referrer,
    item.mime,
    item.speed,
    item.eta
  );
}
function updateDownload(id, updates) {
  const db2 = getDb();
  const fields = [];
  const values = [];
  const columnMap = {
    url: "url",
    filename: "filename",
    savePath: "save_path",
    totalSize: "total_size",
    downloadedBytes: "downloaded_bytes",
    status: "status",
    threads: "threads",
    priority: "priority",
    completedAt: "completed_at",
    resumable: "resumable",
    checksum: "checksum",
    checksumType: "checksum_type",
    error: "error",
    referrer: "referrer",
    mime: "mime",
    speed: "speed",
    eta: "eta"
  };
  for (const [key, val] of Object.entries(updates)) {
    const col = columnMap[key];
    if (col) {
      fields.push(`${col} = ?`);
      values.push(key === "resumable" ? val ? 1 : 0 : val);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  db2.prepare(`UPDATE downloads SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}
function getDownload(id) {
  const db2 = getDb();
  const row = db2.prepare("SELECT * FROM downloads WHERE id = ?").get(id);
  return row ? mapRowToDownload(row) : void 0;
}
function getAllDownloads() {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM downloads ORDER BY created_at DESC").all();
  return rows.map(mapRowToDownload);
}
function getDownloadsByStatus(status) {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM downloads WHERE status = ? ORDER BY created_at DESC").all(status);
  return rows.map(mapRowToDownload);
}
function deleteDownload(id) {
  const db2 = getDb();
  db2.prepare("DELETE FROM downloads WHERE id = ?").run(id);
}
function mapRowToDownload(row) {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    savePath: row.save_path,
    totalSize: row.total_size,
    downloadedBytes: row.downloaded_bytes,
    status: row.status,
    speed: row.speed || 0,
    eta: row.eta || 0,
    threads: row.threads,
    priority: row.priority,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    resumable: !!row.resumable,
    checksum: row.checksum,
    checksumType: row.checksum_type,
    error: row.error,
    referrer: row.referrer,
    mime: row.mime
  };
}
function insertSegments(segments) {
  const db2 = getDb();
  const stmt = db2.prepare(`
    INSERT INTO segments (download_id, segment_index, start_byte, end_byte, downloaded_bytes, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMany = db2.transaction((segs) => {
    for (const s of segs) {
      stmt.run(s.downloadId, s.index, s.startByte, s.endByte, s.downloadedBytes, s.status);
    }
  });
  insertMany(segments);
}
function updateSegment(downloadId, index, updates) {
  const db2 = getDb();
  const fields = [];
  const values = [];
  if (updates.downloadedBytes !== void 0) {
    fields.push("downloaded_bytes = ?");
    values.push(updates.downloadedBytes);
  }
  if (updates.status !== void 0) {
    fields.push("status = ?");
    values.push(updates.status);
  }
  if (fields.length === 0) return;
  values.push(downloadId, index);
  db2.prepare(`UPDATE segments SET ${fields.join(", ")} WHERE download_id = ? AND segment_index = ?`).run(...values);
}
function getSegments(downloadId) {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM segments WHERE download_id = ? ORDER BY segment_index ASC").all(downloadId);
  return rows.map(mapRowToSegment);
}
function deleteSegments(downloadId) {
  const db2 = getDb();
  db2.prepare("DELETE FROM segments WHERE download_id = ?").run(downloadId);
}
function bulkUpdateSegments(downloadId, segments) {
  const db2 = getDb();
  const stmt = db2.prepare(`
    UPDATE segments SET downloaded_bytes = ?, status = ?
    WHERE download_id = ? AND segment_index = ?
  `);
  const updateMany = db2.transaction((segs) => {
    for (const s of segs) {
      stmt.run(s.downloadedBytes, s.status, downloadId, s.index);
    }
  });
  updateMany(segments);
}
function mapRowToSegment(row) {
  return {
    id: row.id,
    downloadId: row.download_id,
    index: row.segment_index,
    startByte: row.start_byte,
    endByte: row.end_byte,
    downloadedBytes: row.downloaded_bytes,
    status: row.status
  };
}
function insertSchedule(schedule) {
  const db2 = getDb();
  const result = db2.prepare(`
    INSERT INTO schedules (download_id, scheduled_time, repeat, auto_shutdown, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(schedule.downloadId, schedule.scheduledTime, schedule.repeat, schedule.autoShutdown ? 1 : 0, schedule.enabled ? 1 : 0);
  return result.lastInsertRowid;
}
function getSchedules() {
  const db2 = getDb();
  const rows = db2.prepare("SELECT * FROM schedules WHERE enabled = 1 ORDER BY scheduled_time ASC").all();
  return rows.map(mapRowToSchedule);
}
function deleteSchedule(id) {
  const db2 = getDb();
  db2.prepare("DELETE FROM schedules WHERE id = ?").run(id);
}
function mapRowToSchedule(row) {
  return {
    id: row.id,
    downloadId: row.download_id,
    scheduledTime: row.scheduled_time,
    repeat: row.repeat,
    autoShutdown: !!row.auto_shutdown,
    enabled: !!row.enabled
  };
}
class DownloadEngine extends events.EventEmitter {
  activeDownloads = /* @__PURE__ */ new Map();
  settings;
  retryConfig = DEFAULT_RETRY_CONFIG;
  constructor(settings) {
    super();
    this.settings = settings;
  }
  updateSettings(settings) {
    this.settings = { ...this.settings, ...settings };
  }
  getActiveDownloadIds() {
    return Array.from(this.activeDownloads.keys());
  }
  getProgressUpdates() {
    const updates = [];
    for (const [id, active] of this.activeDownloads) {
      const speed = this.calculateSpeed(active);
      const eta = speed > 0 ? (active.item.totalSize - active.item.downloadedBytes) / speed : 0;
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
  async addDownload(request) {
    const { url, referrer, priority, checksum, checksumType } = request;
    const probeResult = await this.probeUrl(url, referrer || null);
    const filename = request.filename || probeResult.filename || this.filenameFromUrl(url);
    const savePath = request.savePath || path.join(this.settings.downloadFolder, filename);
    const threads = request.threads || this.settings.maxThreadsPerDownload;
    const saveDir = path.dirname(savePath);
    if (!fs.existsSync(saveDir)) {
      fs.mkdirSync(saveDir, { recursive: true });
    }
    const item = {
      id: uuid.v4(),
      url,
      filename,
      savePath,
      totalSize: probeResult.totalSize,
      downloadedBytes: 0,
      status: "pending",
      speed: 0,
      eta: 0,
      threads: probeResult.supportsRange ? threads : 1,
      priority: priority || "normal",
      createdAt: Date.now(),
      completedAt: null,
      resumable: probeResult.supportsRange,
      checksum: checksum || null,
      checksumType: checksumType || null,
      error: null,
      referrer: referrer || null,
      mime: probeResult.mime || null
    };
    insertDownload(item);
    this.emit("download-added", item);
    this.emit("status-changed", item.id, item.status);
    return item;
  }
  /**
   * Start downloading a pending/queued item.
   */
  async startDownload(id) {
    const item = getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);
    if (item.status === "downloading") return;
    try {
      this.setStatus(id, "downloading");
      if (item.resumable && item.totalSize > 0) {
        await this.startMultiSegmentDownload(item);
      } else {
        await this.startSingleConnectionDownload(item);
      }
    } catch (error) {
      log.error(`[Engine] Download failed: ${id}`, error.message);
      this.setStatus(id, "error");
      updateDownload(id, { error: error.message, status: "error" });
      this.emit("download-error", id, error.message);
      this.cleanupActiveDownload(id);
    }
  }
  /**
   * Pause an active download.
   */
  async pauseDownload(id) {
    const active = this.activeDownloads.get(id);
    if (!active) return;
    for (const seg of active.segments) {
      seg.pause();
    }
    updateDownload(id, {
      downloadedBytes: active.item.downloadedBytes,
      status: "paused"
    });
    if (active.segmentInfos.length > 0) {
      bulkUpdateSegments(id, active.segmentInfos.map((s) => {
        const downloader = active.segments.find((_, i) => i === s.index);
        return downloader ? downloader.segmentInfo : s;
      }));
    }
    this.setStatus(id, "paused");
    this.emit("download-paused", id);
    this.cleanupActiveDownload(id);
  }
  /**
   * Resume a paused download.
   */
  async resumeDownload(id) {
    const item = getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);
    if (item.status !== "paused" && item.status !== "error") return;
    this.emit("download-resumed", id);
    await this.startDownload(id);
  }
  /**
   * Cancel and remove a download.
   */
  async cancelDownload(id) {
    const active = this.activeDownloads.get(id);
    if (active) {
      for (const seg of active.segments) {
        seg.cancel();
      }
      this.cleanupActiveDownload(id);
    }
    const item = getDownload(id);
    if (item && fs.existsSync(item.savePath)) {
      try {
        fs.unlinkSync(item.savePath);
      } catch (e) {
      }
    }
    this.setStatus(id, "error");
    updateDownload(id, { status: "error", error: "Cancelled by user" });
    this.emit("download-cancelled", id);
  }
  /**
   * Retry a failed download.
   */
  async retryDownload(id) {
    const item = getDownload(id);
    if (!item) throw new Error(`Download not found: ${id}`);
    updateDownload(id, {
      downloadedBytes: 0,
      status: "pending",
      error: null
    });
    deleteSegments(id);
    await this.startDownload(id);
  }
  /**
   * Remove a download completely from the database.
   */
  removeDownload(id) {
    const active = this.activeDownloads.get(id);
    if (active) {
      for (const seg of active.segments) {
        seg.cancel();
      }
      this.cleanupActiveDownload(id);
    }
    deleteSegments(id);
    deleteDownload(id);
  }
  // ─── PRIVATE METHODS ──────────────────────────────────────────────────────
  async startMultiSegmentDownload(item) {
    log.info(`[Engine] Starting multi-segment download: ${item.filename} (${item.threads} threads)`);
    let segmentInfos = getSegments(item.id);
    const isResume = segmentInfos.length > 0;
    let fd;
    if (isResume) {
      fd = await openFileForResume(item.savePath);
      log.info(`[Engine] Resuming download with ${segmentInfos.filter((s) => s.status !== "completed").length} incomplete segments`);
    } else {
      segmentInfos = this.createSegments(item.id, item.totalSize, item.threads);
      insertSegments(segmentInfos);
      fd = await allocateFile(item.savePath, item.totalSize);
    }
    const speedPerSegment = this.settings.speedLimitEnabled ? Math.floor(this.settings.speedLimitBytesPerSec / item.threads) : 0;
    const active = {
      item: { ...item, status: "downloading" },
      segments: [],
      segmentInfos,
      fd,
      speedSamples: [],
      lastProgressTime: Date.now(),
      hashStream: null
    };
    this.activeDownloads.set(item.id, active);
    const incompleteSegments = segmentInfos.filter((s) => s.status !== "completed");
    segmentInfos.length - incompleteSegments.length;
    active.item.downloadedBytes = segmentInfos.reduce((sum, s) => sum + s.downloadedBytes, 0);
    const segmentPromises = [];
    for (const segInfo of incompleteSegments) {
      const downloader = new SegmentDownloader(
        segInfo,
        item.url,
        fd,
        this.retryConfig,
        speedPerSegment,
        item.referrer
      );
      downloader.on("progress", (index, bytesDownloaded, chunkSize) => {
        active.item.downloadedBytes += chunkSize;
        active.speedSamples.push(chunkSize);
        const segIdx = active.segmentInfos.findIndex((s) => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].downloadedBytes = bytesDownloaded;
          active.segmentInfos[segIdx].status = "active";
        }
      });
      downloader.on("complete", (index) => {
        const segIdx = active.segmentInfos.findIndex((s) => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].status = "completed";
        }
        updateSegment(item.id, index, { status: "completed", downloadedBytes: active.segmentInfos[segIdx]?.downloadedBytes });
      });
      downloader.on("error", (index, error) => {
        log.error(`[Engine] Segment ${index} error for ${item.id}:`, error.message);
        const segIdx = active.segmentInfos.findIndex((s) => s.index === index);
        if (segIdx >= 0) {
          active.segmentInfos[segIdx].status = "error";
        }
      });
      active.segments.push(downloader);
      segmentPromises.push(downloader.start());
    }
    try {
      await Promise.all(segmentPromises);
      if (active.item.status !== "downloading") {
        return;
      }
      await closeFile(fd);
      active.fd = null;
      if (item.totalSize > 0) {
        const sizeOk = await verifyFileSize(item.savePath, item.totalSize);
        if (!sizeOk) {
          throw new Error(`File size mismatch: expected ${item.totalSize} bytes`);
        }
      }
      if (item.checksum && item.checksumType) {
        this.setStatus(item.id, "verifying");
        const computedHash = await this.computeFileHash(item.savePath, item.checksumType);
        if (computedHash.toLowerCase() !== item.checksum.toLowerCase()) {
          throw new Error(`Checksum mismatch: expected ${item.checksum}, got ${computedHash}`);
        }
        log.info(`[Engine] Checksum verified for ${item.filename}`);
      }
      const now = Date.now();
      updateDownload(item.id, {
        status: "completed",
        downloadedBytes: item.totalSize,
        completedAt: now
      });
      active.item.status = "completed";
      active.item.completedAt = now;
      this.setStatus(item.id, "completed");
      this.emit("download-complete", active.item);
      this.activeDownloads.delete(item.id);
      log.info(`[Engine] Download complete: ${item.filename}`);
    } catch (error) {
      if (active.fd !== null) {
        await closeFile(active.fd).catch(() => {
        });
      }
      throw error;
    }
  }
  async startSingleConnectionDownload(item) {
    log.info(`[Engine] Starting single-connection download: ${item.filename}`);
    const active = {
      item: { ...item, status: "downloading" },
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
      const isHttps = parsedUrl.protocol === "https:";
      const httpModule = isHttps ? https : http;
      const headers = {
        "User-Agent": "IDM-Clone/1.0",
        "Accept": "*/*",
        "Connection": "keep-alive"
      };
      if (item.referrer) {
        headers["Referer"] = item.referrer;
      }
      const writeStream = fs.createWriteStream(item.savePath);
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "GET",
        headers,
        timeout: 3e4
      };
      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          item.url = new URL(res.headers.location, item.url).href;
          this.startSingleConnectionDownload(item).then(resolve).catch(reject);
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const totalSize = parseInt(res.headers["content-length"] || "0", 10);
        if (totalSize > 0 && active.item.totalSize === 0) {
          active.item.totalSize = totalSize;
          updateDownload(item.id, { totalSize });
        }
        res.on("data", (chunk) => {
          if (active.item.status !== "downloading") {
            res.destroy();
            writeStream.end();
            return resolve();
          }
          active.item.downloadedBytes += chunk.length;
          active.speedSamples.push(chunk.length);
        });
        res.pipe(writeStream);
        writeStream.on("finish", async () => {
          updateDownload(item.id, {
            status: "completed",
            downloadedBytes: active.item.downloadedBytes,
            totalSize: active.item.totalSize || active.item.downloadedBytes,
            completedAt: Date.now()
          });
          active.item.status = "completed";
          this.setStatus(item.id, "completed");
          this.emit("download-complete", active.item);
          this.activeDownloads.delete(item.id);
          resolve();
        });
        writeStream.on("error", reject);
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Connection timeout"));
      });
      req.end();
    });
  }
  createSegments(downloadId, totalSize, threads) {
    const segmentSize = Math.ceil(totalSize / threads);
    const segments = [];
    for (let i = 0; i < threads; i++) {
      const startByte = i * segmentSize;
      const endByte = Math.min((i + 1) * segmentSize - 1, totalSize - 1);
      segments.push({
        id: 0,
        // Auto-assigned by DB
        downloadId,
        index: i,
        startByte,
        endByte,
        downloadedBytes: 0,
        status: "pending"
      });
    }
    return segments;
  }
  async probeUrl(url, referrer) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const isHttps = parsedUrl.protocol === "https:";
      const httpModule = isHttps ? https : http;
      const headers = {
        "User-Agent": "IDM-Clone/1.0",
        "Accept": "*/*"
      };
      if (referrer) {
        headers["Referer"] = referrer;
      }
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: "HEAD",
        headers,
        timeout: 15e3
      };
      const req = httpModule.request(options, (res) => {
        const statusCode = res.statusCode || 0;
        if (statusCode >= 300 && statusCode < 400 && res.headers.location) {
          res.resume();
          const newUrl = new URL(res.headers.location, url).href;
          this.probeUrl(newUrl, referrer).then(resolve).catch(reject);
          return;
        }
        if (statusCode !== 200 && statusCode !== 206) {
          res.resume();
          return resolve({
            totalSize: 0,
            supportsRange: false,
            filename: null,
            mime: null
          });
        }
        const contentLength = parseInt(res.headers["content-length"] || "0", 10);
        const acceptRanges = res.headers["accept-ranges"];
        const supportsRange = acceptRanges === "bytes" || contentLength > 0 && acceptRanges !== "none";
        let filename = null;
        const contentDisp = res.headers["content-disposition"];
        if (contentDisp) {
          const match = contentDisp.match(/filename\*?=(?:UTF-8''|"?)([^";]+)"?/i);
          if (match) {
            filename = decodeURIComponent(match[1]);
          }
        }
        const mime = res.headers["content-type"]?.split(";")[0]?.trim() || null;
        res.resume();
        resolve({
          totalSize: contentLength,
          supportsRange,
          filename,
          mime
        });
      });
      req.on("error", (err) => {
        log.warn(`[Engine] HEAD request failed for ${url}:`, err.message);
        resolve({
          totalSize: 0,
          supportsRange: false,
          filename: null,
          mime: null
        });
      });
      req.on("timeout", () => {
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
  filenameFromUrl(url) {
    try {
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length > 0) {
        return decodeURIComponent(segments[segments.length - 1]);
      }
    } catch {
    }
    return `download_${Date.now()}`;
  }
  calculateSpeed(active) {
    const now = Date.now();
    const elapsed = (now - active.lastProgressTime) / 1e3;
    if (elapsed <= 0) return active.item.speed;
    const totalBytes = active.speedSamples.reduce((sum, b) => sum + b, 0);
    const speed = totalBytes / elapsed;
    if (elapsed >= 1) {
      active.speedSamples = [];
      active.lastProgressTime = now;
      active.item.speed = speed;
    }
    return speed;
  }
  setStatus(id, status) {
    const active = this.activeDownloads.get(id);
    if (active) {
      active.item.status = status;
    }
    updateDownload(id, { status });
    this.emit("status-changed", id, status);
  }
  async cleanupActiveDownload(id) {
    const active = this.activeDownloads.get(id);
    if (!active) return;
    if (active.fd !== null) {
      try {
        await closeFile(active.fd);
      } catch {
      }
    }
    this.activeDownloads.delete(id);
  }
  computeFileHash(filePath, algorithm) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(algorithm.toLowerCase());
      const stream = fs.createReadStream(filePath);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }
}
const DEFAULT_SETTINGS = {
  downloadFolder: "",
  maxThreadsPerDownload: 8,
  maxConcurrentDownloads: 3,
  autoStartOnBoot: false,
  speedLimitEnabled: false,
  speedLimitBytesPerSec: 0,
  minimizeToTray: true,
  showNotifications: true,
  autoRetryFailed: true,
  maxRetries: 5,
  fileTypeFilters: [
    ".zip",
    ".rar",
    ".7z",
    ".tar",
    ".gz",
    ".bz2",
    ".xz",
    ".exe",
    ".msi",
    ".dmg",
    ".iso",
    ".img",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".mp4",
    ".mkv",
    ".avi",
    ".mov",
    ".wmv",
    ".flv",
    ".webm",
    ".mp3",
    ".flac",
    ".wav",
    ".aac",
    ".ogg",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".svg",
    ".webp",
    ".apk",
    ".deb",
    ".rpm"
  ],
  minFileSizeToIntercept: 1048576,
  // 1 MB
  theme: "dark"
};
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
  QUEUE_REORDER: "queue:reorder",
  QUEUE_SET_PRIORITY: "queue:set-priority",
  DIALOG_SELECT_FOLDER: "dialog:select-folder",
  APP_MINIMIZE_TO_TRAY: "app:minimize-to-tray",
  APP_QUIT: "app:quit",
  SCHEDULE_ADD: "schedule:add",
  SCHEDULE_REMOVE: "schedule:remove",
  SCHEDULE_LIST: "schedule:list"
};
class ProgressTracker {
  engine;
  mainWindow = null;
  intervalId = null;
  updateIntervalMs = 100;
  // 10 updates per second
  constructor(engine2) {
    this.engine = engine2;
  }
  setWindow(window) {
    this.mainWindow = window;
  }
  start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.sendProgressBatch();
    }, this.updateIntervalMs);
    log.info("[ProgressTracker] Started progress tracking");
  }
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  sendProgressBatch() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    const updates = this.engine.getProgressUpdates();
    if (updates.length === 0) return;
    try {
      this.mainWindow.webContents.send(IPC.DOWNLOAD_PROGRESS_BATCH, updates);
    } catch (error) {
    }
  }
}
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var eventemitter3 = { exports: {} };
(function(module) {
  var has = Object.prototype.hasOwnProperty, prefix = "~";
  function Events() {
  }
  if (Object.create) {
    Events.prototype = /* @__PURE__ */ Object.create(null);
    if (!new Events().__proto__) prefix = false;
  }
  function EE(fn, context, once) {
    this.fn = fn;
    this.context = context;
    this.once = once || false;
  }
  function addListener(emitter, event, fn, context, once) {
    if (typeof fn !== "function") {
      throw new TypeError("The listener must be a function");
    }
    var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
    if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
    else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
    else emitter._events[evt] = [emitter._events[evt], listener];
    return emitter;
  }
  function clearEvent(emitter, evt) {
    if (--emitter._eventsCount === 0) emitter._events = new Events();
    else delete emitter._events[evt];
  }
  function EventEmitter2() {
    this._events = new Events();
    this._eventsCount = 0;
  }
  EventEmitter2.prototype.eventNames = function eventNames() {
    var names = [], events2, name;
    if (this._eventsCount === 0) return names;
    for (name in events2 = this._events) {
      if (has.call(events2, name)) names.push(prefix ? name.slice(1) : name);
    }
    if (Object.getOwnPropertySymbols) {
      return names.concat(Object.getOwnPropertySymbols(events2));
    }
    return names;
  };
  EventEmitter2.prototype.listeners = function listeners(event) {
    var evt = prefix ? prefix + event : event, handlers = this._events[evt];
    if (!handlers) return [];
    if (handlers.fn) return [handlers.fn];
    for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
      ee[i] = handlers[i].fn;
    }
    return ee;
  };
  EventEmitter2.prototype.listenerCount = function listenerCount(event) {
    var evt = prefix ? prefix + event : event, listeners = this._events[evt];
    if (!listeners) return 0;
    if (listeners.fn) return 1;
    return listeners.length;
  };
  EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
    var evt = prefix ? prefix + event : event;
    if (!this._events[evt]) return false;
    var listeners = this._events[evt], len = arguments.length, args, i;
    if (listeners.fn) {
      if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
      switch (len) {
        case 1:
          return listeners.fn.call(listeners.context), true;
        case 2:
          return listeners.fn.call(listeners.context, a1), true;
        case 3:
          return listeners.fn.call(listeners.context, a1, a2), true;
        case 4:
          return listeners.fn.call(listeners.context, a1, a2, a3), true;
        case 5:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
        case 6:
          return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
      }
      for (i = 1, args = new Array(len - 1); i < len; i++) {
        args[i - 1] = arguments[i];
      }
      listeners.fn.apply(listeners.context, args);
    } else {
      var length = listeners.length, j;
      for (i = 0; i < length; i++) {
        if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
        switch (len) {
          case 1:
            listeners[i].fn.call(listeners[i].context);
            break;
          case 2:
            listeners[i].fn.call(listeners[i].context, a1);
            break;
          case 3:
            listeners[i].fn.call(listeners[i].context, a1, a2);
            break;
          case 4:
            listeners[i].fn.call(listeners[i].context, a1, a2, a3);
            break;
          default:
            if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) {
              args[j - 1] = arguments[j];
            }
            listeners[i].fn.apply(listeners[i].context, args);
        }
      }
    }
    return true;
  };
  EventEmitter2.prototype.on = function on(event, fn, context) {
    return addListener(this, event, fn, context, false);
  };
  EventEmitter2.prototype.once = function once(event, fn, context) {
    return addListener(this, event, fn, context, true);
  };
  EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
    var evt = prefix ? prefix + event : event;
    if (!this._events[evt]) return this;
    if (!fn) {
      clearEvent(this, evt);
      return this;
    }
    var listeners = this._events[evt];
    if (listeners.fn) {
      if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
        clearEvent(this, evt);
      }
    } else {
      for (var i = 0, events2 = [], length = listeners.length; i < length; i++) {
        if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
          events2.push(listeners[i]);
        }
      }
      if (events2.length) this._events[evt] = events2.length === 1 ? events2[0] : events2;
      else clearEvent(this, evt);
    }
    return this;
  };
  EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
    var evt;
    if (event) {
      evt = prefix ? prefix + event : event;
      if (this._events[evt]) clearEvent(this, evt);
    } else {
      this._events = new Events();
      this._eventsCount = 0;
    }
    return this;
  };
  EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
  EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
  EventEmitter2.prefixed = prefix;
  EventEmitter2.EventEmitter = EventEmitter2;
  {
    module.exports = EventEmitter2;
  }
})(eventemitter3);
var eventemitter3Exports = eventemitter3.exports;
const EventEmitter = /* @__PURE__ */ getDefaultExportFromCjs(eventemitter3Exports);
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}
class AbortError extends Error {
  constructor(message) {
    super();
    this.name = "AbortError";
    this.message = message;
  }
}
const getDOMException = (errorMessage) => globalThis.DOMException === void 0 ? new AbortError(errorMessage) : new DOMException(errorMessage);
const getAbortedReason = (signal) => {
  const reason = signal.reason === void 0 ? getDOMException("This operation was aborted.") : signal.reason;
  return reason instanceof Error ? reason : getDOMException(reason);
};
function pTimeout(promise, options) {
  const {
    milliseconds,
    fallback,
    message,
    customTimers = { setTimeout, clearTimeout }
  } = options;
  let timer;
  let abortHandler;
  const wrappedPromise = new Promise((resolve, reject) => {
    if (typeof milliseconds !== "number" || Math.sign(milliseconds) !== 1) {
      throw new TypeError(`Expected \`milliseconds\` to be a positive number, got \`${milliseconds}\``);
    }
    if (options.signal) {
      const { signal } = options;
      if (signal.aborted) {
        reject(getAbortedReason(signal));
      }
      abortHandler = () => {
        reject(getAbortedReason(signal));
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    if (milliseconds === Number.POSITIVE_INFINITY) {
      promise.then(resolve, reject);
      return;
    }
    const timeoutError = new TimeoutError();
    timer = customTimers.setTimeout.call(void 0, () => {
      if (fallback) {
        try {
          resolve(fallback());
        } catch (error) {
          reject(error);
        }
        return;
      }
      if (typeof promise.cancel === "function") {
        promise.cancel();
      }
      if (message === false) {
        resolve();
      } else if (message instanceof Error) {
        reject(message);
      } else {
        timeoutError.message = message ?? `Promise timed out after ${milliseconds} milliseconds`;
        reject(timeoutError);
      }
    }, milliseconds);
    (async () => {
      try {
        resolve(await promise);
      } catch (error) {
        reject(error);
      }
    })();
  });
  const cancelablePromise = wrappedPromise.finally(() => {
    cancelablePromise.clear();
    if (abortHandler && options.signal) {
      options.signal.removeEventListener("abort", abortHandler);
    }
  });
  cancelablePromise.clear = () => {
    customTimers.clearTimeout.call(void 0, timer);
    timer = void 0;
  };
  return cancelablePromise;
}
function lowerBound(array, value, comparator) {
  let first = 0;
  let count = array.length;
  while (count > 0) {
    const step = Math.trunc(count / 2);
    let it = first + step;
    if (comparator(array[it], value) <= 0) {
      first = ++it;
      count -= step + 1;
    } else {
      count = step;
    }
  }
  return first;
}
class PriorityQueue {
  #queue = [];
  enqueue(run, options) {
    options = {
      priority: 0,
      ...options
    };
    const element = {
      priority: options.priority,
      id: options.id,
      run
    };
    if (this.size === 0 || this.#queue[this.size - 1].priority >= options.priority) {
      this.#queue.push(element);
      return;
    }
    const index = lowerBound(this.#queue, element, (a, b) => b.priority - a.priority);
    this.#queue.splice(index, 0, element);
  }
  setPriority(id, priority) {
    const index = this.#queue.findIndex((element) => element.id === id);
    if (index === -1) {
      throw new ReferenceError(`No promise function with the id "${id}" exists in the queue.`);
    }
    const [item] = this.#queue.splice(index, 1);
    this.enqueue(item.run, { priority, id });
  }
  dequeue() {
    const item = this.#queue.shift();
    return item?.run;
  }
  filter(options) {
    return this.#queue.filter((element) => element.priority === options.priority).map((element) => element.run);
  }
  get size() {
    return this.#queue.length;
  }
}
class PQueue extends EventEmitter {
  #carryoverConcurrencyCount;
  #isIntervalIgnored;
  #intervalCount = 0;
  #intervalCap;
  #interval;
  #intervalEnd = 0;
  #intervalId;
  #timeoutId;
  #queue;
  #queueClass;
  #pending = 0;
  // The `!` is needed because of https://github.com/microsoft/TypeScript/issues/32194
  #concurrency;
  #isPaused;
  #throwOnTimeout;
  // Use to assign a unique identifier to a promise function, if not explicitly specified
  #idAssigner = 1n;
  /**
      Per-operation timeout in milliseconds. Operations fulfill once `timeout` elapses if they haven't already.
  
      Applies to each future operation.
      */
  timeout;
  // TODO: The `throwOnTimeout` option should affect the return types of `add()` and `addAll()`
  constructor(options) {
    super();
    options = {
      carryoverConcurrencyCount: false,
      intervalCap: Number.POSITIVE_INFINITY,
      interval: 0,
      concurrency: Number.POSITIVE_INFINITY,
      autoStart: true,
      queueClass: PriorityQueue,
      ...options
    };
    if (!(typeof options.intervalCap === "number" && options.intervalCap >= 1)) {
      throw new TypeError(`Expected \`intervalCap\` to be a number from 1 and up, got \`${options.intervalCap?.toString() ?? ""}\` (${typeof options.intervalCap})`);
    }
    if (options.interval === void 0 || !(Number.isFinite(options.interval) && options.interval >= 0)) {
      throw new TypeError(`Expected \`interval\` to be a finite number >= 0, got \`${options.interval?.toString() ?? ""}\` (${typeof options.interval})`);
    }
    this.#carryoverConcurrencyCount = options.carryoverConcurrencyCount;
    this.#isIntervalIgnored = options.intervalCap === Number.POSITIVE_INFINITY || options.interval === 0;
    this.#intervalCap = options.intervalCap;
    this.#interval = options.interval;
    this.#queue = new options.queueClass();
    this.#queueClass = options.queueClass;
    this.concurrency = options.concurrency;
    this.timeout = options.timeout;
    this.#throwOnTimeout = options.throwOnTimeout === true;
    this.#isPaused = options.autoStart === false;
  }
  get #doesIntervalAllowAnother() {
    return this.#isIntervalIgnored || this.#intervalCount < this.#intervalCap;
  }
  get #doesConcurrentAllowAnother() {
    return this.#pending < this.#concurrency;
  }
  #next() {
    this.#pending--;
    this.#tryToStartAnother();
    this.emit("next");
  }
  #onResumeInterval() {
    this.#onInterval();
    this.#initializeIntervalIfNeeded();
    this.#timeoutId = void 0;
  }
  get #isIntervalPaused() {
    const now = Date.now();
    if (this.#intervalId === void 0) {
      const delay = this.#intervalEnd - now;
      if (delay < 0) {
        this.#intervalCount = this.#carryoverConcurrencyCount ? this.#pending : 0;
      } else {
        if (this.#timeoutId === void 0) {
          this.#timeoutId = setTimeout(() => {
            this.#onResumeInterval();
          }, delay);
        }
        return true;
      }
    }
    return false;
  }
  #tryToStartAnother() {
    if (this.#queue.size === 0) {
      if (this.#intervalId) {
        clearInterval(this.#intervalId);
      }
      this.#intervalId = void 0;
      this.emit("empty");
      if (this.#pending === 0) {
        this.emit("idle");
      }
      return false;
    }
    if (!this.#isPaused) {
      const canInitializeInterval = !this.#isIntervalPaused;
      if (this.#doesIntervalAllowAnother && this.#doesConcurrentAllowAnother) {
        const job = this.#queue.dequeue();
        if (!job) {
          return false;
        }
        this.emit("active");
        job();
        if (canInitializeInterval) {
          this.#initializeIntervalIfNeeded();
        }
        return true;
      }
    }
    return false;
  }
  #initializeIntervalIfNeeded() {
    if (this.#isIntervalIgnored || this.#intervalId !== void 0) {
      return;
    }
    this.#intervalId = setInterval(() => {
      this.#onInterval();
    }, this.#interval);
    this.#intervalEnd = Date.now() + this.#interval;
  }
  #onInterval() {
    if (this.#intervalCount === 0 && this.#pending === 0 && this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = void 0;
    }
    this.#intervalCount = this.#carryoverConcurrencyCount ? this.#pending : 0;
    this.#processQueue();
  }
  /**
  Executes all queued functions until it reaches the limit.
  */
  #processQueue() {
    while (this.#tryToStartAnother()) {
    }
  }
  get concurrency() {
    return this.#concurrency;
  }
  set concurrency(newConcurrency) {
    if (!(typeof newConcurrency === "number" && newConcurrency >= 1)) {
      throw new TypeError(`Expected \`concurrency\` to be a number from 1 and up, got \`${newConcurrency}\` (${typeof newConcurrency})`);
    }
    this.#concurrency = newConcurrency;
    this.#processQueue();
  }
  async #throwOnAbort(signal) {
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        reject(signal.reason);
      }, { once: true });
    });
  }
  /**
      Updates the priority of a promise function by its id, affecting its execution order. Requires a defined concurrency limit to take effect.
  
      For example, this can be used to prioritize a promise function to run earlier.
  
      ```js
      import PQueue from 'p-queue';
  
      const queue = new PQueue({concurrency: 1});
  
      queue.add(async () => '🦄', {priority: 1});
      queue.add(async () => '🦀', {priority: 0, id: '🦀'});
      queue.add(async () => '🦄', {priority: 1});
      queue.add(async () => '🦄', {priority: 1});
  
      queue.setPriority('🦀', 2);
      ```
  
      In this case, the promise function with `id: '🦀'` runs second.
  
      You can also deprioritize a promise function to delay its execution:
  
      ```js
      import PQueue from 'p-queue';
  
      const queue = new PQueue({concurrency: 1});
  
      queue.add(async () => '🦄', {priority: 1});
      queue.add(async () => '🦀', {priority: 1, id: '🦀'});
      queue.add(async () => '🦄');
      queue.add(async () => '🦄', {priority: 0});
  
      queue.setPriority('🦀', -1);
      ```
      Here, the promise function with `id: '🦀'` executes last.
      */
  setPriority(id, priority) {
    this.#queue.setPriority(id, priority);
  }
  async add(function_, options = {}) {
    options.id ??= (this.#idAssigner++).toString();
    options = {
      timeout: this.timeout,
      throwOnTimeout: this.#throwOnTimeout,
      ...options
    };
    return new Promise((resolve, reject) => {
      this.#queue.enqueue(async () => {
        this.#pending++;
        try {
          options.signal?.throwIfAborted();
          this.#intervalCount++;
          let operation = function_({ signal: options.signal });
          if (options.timeout) {
            operation = pTimeout(Promise.resolve(operation), { milliseconds: options.timeout });
          }
          if (options.signal) {
            operation = Promise.race([operation, this.#throwOnAbort(options.signal)]);
          }
          const result = await operation;
          resolve(result);
          this.emit("completed", result);
        } catch (error) {
          if (error instanceof TimeoutError && !options.throwOnTimeout) {
            resolve();
            return;
          }
          reject(error);
          this.emit("error", error);
        } finally {
          this.#next();
        }
      }, options);
      this.emit("add");
      this.#tryToStartAnother();
    });
  }
  async addAll(functions, options) {
    return Promise.all(functions.map(async (function_) => this.add(function_, options)));
  }
  /**
  Start (or resume) executing enqueued tasks within concurrency limit. No need to call this if queue is not paused (via `options.autoStart = false` or by `.pause()` method.)
  */
  start() {
    if (!this.#isPaused) {
      return this;
    }
    this.#isPaused = false;
    this.#processQueue();
    return this;
  }
  /**
  Put queue execution on hold.
  */
  pause() {
    this.#isPaused = true;
  }
  /**
  Clear the queue.
  */
  clear() {
    this.#queue = new this.#queueClass();
  }
  /**
      Can be called multiple times. Useful if you for example add additional items at a later time.
  
      @returns A promise that settles when the queue becomes empty.
      */
  async onEmpty() {
    if (this.#queue.size === 0) {
      return;
    }
    await this.#onEvent("empty");
  }
  /**
      @returns A promise that settles when the queue size is less than the given limit: `queue.size < limit`.
  
      If you want to avoid having the queue grow beyond a certain size you can `await queue.onSizeLessThan()` before adding a new item.
  
      Note that this only limits the number of items waiting to start. There could still be up to `concurrency` jobs already running that this call does not include in its calculation.
      */
  async onSizeLessThan(limit) {
    if (this.#queue.size < limit) {
      return;
    }
    await this.#onEvent("next", () => this.#queue.size < limit);
  }
  /**
      The difference with `.onEmpty` is that `.onIdle` guarantees that all work from the queue has finished. `.onEmpty` merely signals that the queue is empty, but it could mean that some promises haven't completed yet.
  
      @returns A promise that settles when the queue becomes empty, and all promises have completed; `queue.size === 0 && queue.pending === 0`.
      */
  async onIdle() {
    if (this.#pending === 0 && this.#queue.size === 0) {
      return;
    }
    await this.#onEvent("idle");
  }
  async #onEvent(event, filter) {
    return new Promise((resolve) => {
      const listener = () => {
        if (filter && !filter()) {
          return;
        }
        this.off(event, listener);
        resolve();
      };
      this.on(event, listener);
    });
  }
  /**
  Size of the queue, the number of queued items waiting to run.
  */
  get size() {
    return this.#queue.size;
  }
  /**
      Size of the queue, filtered by the given options.
  
      For example, this can be used to find the number of items remaining in the queue with a specific priority level.
      */
  sizeBy(options) {
    return this.#queue.filter(options).length;
  }
  /**
  Number of running items (no longer in the queue).
  */
  get pending() {
    return this.#pending;
  }
  /**
  Whether the queue is currently paused.
  */
  get isPaused() {
    return this.#isPaused;
  }
}
class QueueManager {
  engine;
  queue;
  pendingItems = /* @__PURE__ */ new Map();
  constructor(engine2, maxConcurrent = 3) {
    this.engine = engine2;
    this.queue = new PQueue({
      concurrency: maxConcurrent,
      autoStart: true
    });
    this.engine.on("download-complete", (item) => {
      log.info(`[QueueManager] Download complete: ${item.filename}. Queue: ${this.queue.size} pending, ${this.queue.pending} active`);
      this.pendingItems.delete(item.id);
    });
    this.engine.on("download-error", (id) => {
      this.pendingItems.delete(id);
    });
    this.engine.on("download-cancelled", (id) => {
      this.pendingItems.delete(id);
    });
  }
  /**
   * Set the maximum number of concurrent downloads.
   */
  setConcurrency(maxConcurrent) {
    this.queue.concurrency = maxConcurrent;
    log.info(`[QueueManager] Concurrency set to ${maxConcurrent}`);
  }
  /**
   * Enqueue a download. It will start when a slot is available.
   */
  async enqueue(id, priority = "normal") {
    const priorityValue = this.priorityToNumber(priority);
    this.pendingItems.set(id, { priority: priorityValue, addedAt: Date.now() });
    const item = getDownload(id);
    if (item && item.status === "pending") {
      updateDownload(id, { status: "queued" });
      this.engine.emit("status-changed", id, "queued");
    }
    await this.queue.add(
      async () => {
        const current = getDownload(id);
        if (!current || current.status === "completed" || current.status === "error") {
          return;
        }
        try {
          await this.engine.startDownload(id);
        } catch (error) {
          log.error(`[QueueManager] Failed to start download ${id}:`, error.message);
        }
      },
      { priority: priorityValue }
    );
  }
  /**
   * Update the priority of a queued download.
   */
  setPriority(id, priority) {
    updateDownload(id, { priority });
    const pending = this.pendingItems.get(id);
    if (pending) {
      pending.priority = this.priorityToNumber(priority);
    }
  }
  /**
   * Pause all active downloads.
   */
  async pauseAll() {
    this.queue.pause();
    const activeIds = this.engine.getActiveDownloadIds();
    for (const id of activeIds) {
      await this.engine.pauseDownload(id);
    }
    log.info("[QueueManager] All downloads paused");
  }
  /**
   * Resume all paused downloads.
   */
  async resumeAll() {
    this.queue.start();
    const pausedDownloads = getDownloadsByStatus("paused");
    for (const item of pausedDownloads) {
      await this.enqueue(item.id, item.priority);
    }
    log.info("[QueueManager] All downloads resumed");
  }
  /**
   * Get queue statistics.
   */
  getStats() {
    return {
      pending: this.queue.size,
      active: this.queue.pending,
      size: this.queue.size + this.queue.pending
    };
  }
  /**
   * Clear all pending items from the queue.
   */
  clear() {
    this.queue.clear();
    this.pendingItems.clear();
  }
  priorityToNumber(priority) {
    switch (priority) {
      case "high":
        return 2;
      case "normal":
        return 1;
      case "low":
        return 0;
      default:
        return 1;
    }
  }
}
class Scheduler {
  engine;
  queueManager;
  timers = /* @__PURE__ */ new Map();
  shutdownTimer = null;
  constructor(engine2, queueManager2) {
    this.engine = engine2;
    this.queueManager = queueManager2;
  }
  /**
   * Load all saved schedules from the database and set timers.
   */
  initialize() {
    const schedules = getSchedules();
    for (const schedule of schedules) {
      this.setTimer(schedule);
    }
    log.info(`[Scheduler] Initialized with ${schedules.length} scheduled downloads`);
  }
  /**
   * Add a new scheduled download.
   */
  addSchedule(schedule) {
    const id = insertSchedule(schedule);
    const fullSchedule = { ...schedule, id };
    this.setTimer(fullSchedule);
    log.info(`[Scheduler] Added schedule #${id} for download ${schedule.downloadId} at ${new Date(schedule.scheduledTime).toISOString()}`);
    return id;
  }
  /**
   * Remove a scheduled download.
   */
  removeSchedule(id) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    deleteSchedule(id);
    log.info(`[Scheduler] Removed schedule #${id}`);
  }
  /**
   * Get all active schedules.
   */
  getSchedules() {
    return getSchedules();
  }
  /**
   * Stop all scheduled timers.
   */
  destroy() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
    }
  }
  setTimer(schedule) {
    const now = Date.now();
    let delay = schedule.scheduledTime - now;
    if (delay <= 0) {
      if (Math.abs(delay) < 5 * 60 * 1e3) {
        delay = 0;
      } else if (schedule.repeat === "none") {
        log.info(`[Scheduler] Skipping past schedule #${schedule.id}`);
        return;
      } else {
        delay = this.getNextOccurrenceDelay(schedule);
      }
    }
    const timer = setTimeout(async () => {
      this.timers.delete(schedule.id);
      try {
        log.info(`[Scheduler] Triggering scheduled download ${schedule.downloadId}`);
        await this.queueManager.enqueue(schedule.downloadId);
        if (schedule.autoShutdown) {
          this.setupAutoShutdown(schedule.downloadId);
        }
        if (schedule.repeat !== "none") {
          const nextDelay = this.getNextOccurrenceDelay(schedule);
          const nextTime = Date.now() + nextDelay;
          const nextSchedule = { ...schedule, scheduledTime: nextTime };
          this.setTimer(nextSchedule);
        }
      } catch (error) {
        log.error(`[Scheduler] Failed to trigger schedule #${schedule.id}:`, error.message);
      }
    }, delay);
    this.timers.set(schedule.id, timer);
  }
  getNextOccurrenceDelay(schedule) {
    const now = Date.now();
    let nextTime = schedule.scheduledTime;
    const dayMs = 24 * 60 * 60 * 1e3;
    const weekMs = 7 * dayMs;
    const interval = schedule.repeat === "daily" ? dayMs : weekMs;
    while (nextTime <= now) {
      nextTime += interval;
    }
    return nextTime - now;
  }
  setupAutoShutdown(downloadId) {
    const checkInterval = setInterval(() => {
      const item = getDownload(downloadId);
      if (!item) {
        clearInterval(checkInterval);
        return;
      }
      if (item.status === "completed") {
        clearInterval(checkInterval);
        log.info("[Scheduler] All scheduled downloads complete. Auto-shutdown in 60 seconds.");
        this.shutdownTimer = setTimeout(() => {
          const { exec } = require("child_process");
          exec("shutdown /s /t 0", (error) => {
            if (error) {
              log.error("[Scheduler] Failed to initiate shutdown:", error.message);
            }
          });
        }, 6e4);
      } else if (item.status === "error") {
        clearInterval(checkInterval);
        log.info("[Scheduler] Download failed — auto-shutdown cancelled");
      }
    }, 5e3);
  }
  cancelShutdown() {
    if (this.shutdownTimer) {
      clearTimeout(this.shutdownTimer);
      this.shutdownTimer = null;
      log.info("[Scheduler] Auto-shutdown cancelled");
      const { exec } = require("child_process");
      exec("shutdown /a", () => {
      });
    }
  }
}
function registerDownloadHandlers(engine2, queueManager2) {
  electron.ipcMain.handle(IPC.DOWNLOAD_ADD, async (_event, request) => {
    try {
      const item = await engine2.addDownload(request);
      await queueManager2.enqueue(item.id, request.priority || "normal");
      return { success: true, item };
    } catch (error) {
      log.error("[IPC] download:add failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_PAUSE, async (_event, id) => {
    try {
      await engine2.pauseDownload(id);
      return { success: true };
    } catch (error) {
      log.error("[IPC] download:pause failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_RESUME, async (_event, id) => {
    try {
      await queueManager2.enqueue(id, getDownload(id)?.priority || "normal");
      return { success: true };
    } catch (error) {
      log.error("[IPC] download:resume failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_CANCEL, async (_event, id) => {
    try {
      await engine2.cancelDownload(id);
      return { success: true };
    } catch (error) {
      log.error("[IPC] download:cancel failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_RETRY, async (_event, id) => {
    try {
      await engine2.retryDownload(id);
      await queueManager2.enqueue(id);
      return { success: true };
    } catch (error) {
      log.error("[IPC] download:retry failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_REMOVE, async (_event, id) => {
    try {
      engine2.removeDownload(id);
      return { success: true };
    } catch (error) {
      log.error("[IPC] download:remove failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_LIST, async () => {
    try {
      const downloads = getAllDownloads();
      return { success: true, downloads };
    } catch (error) {
      log.error("[IPC] download:list failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_OPEN_FILE, async (_event, id) => {
    try {
      const item = getDownload(id);
      if (item) {
        await electron.shell.openPath(item.savePath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DOWNLOAD_OPEN_FOLDER, async (_event, id) => {
    try {
      const item = getDownload(id);
      if (item) {
        electron.shell.showItemInFolder(item.savePath);
      }
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.DIALOG_SELECT_FOLDER, async () => {
    const result = await electron.dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"]
    });
    return result.filePaths[0] || null;
  });
  electron.ipcMain.handle(IPC.QUEUE_SET_PRIORITY, async (_event, id, priority) => {
    try {
      queueManager2.setPriority(id, priority);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  log.info("[IPC] Download handlers registered");
}
const store = new Store({
  defaults: {
    settings: {
      ...DEFAULT_SETTINGS,
      downloadFolder: path.join(electron.app.getPath("downloads"), "IDM Clone")
    }
  }
});
function getSettings() {
  return store.get("settings");
}
function registerSettingsHandlers() {
  electron.ipcMain.handle(IPC.SETTINGS_GET, async () => {
    try {
      return { success: true, settings: getSettings() };
    } catch (error) {
      log.error("[IPC] settings:get failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.SETTINGS_UPDATE, async (_event, updates) => {
    try {
      const current = getSettings();
      const updated = { ...current, ...updates };
      store.set("settings", updated);
      if (updates.autoStartOnBoot !== void 0) {
        electron.app.setLoginItemSettings({
          openAtLogin: updates.autoStartOnBoot,
          path: electron.app.getPath("exe")
        });
      }
      log.info("[IPC] Settings updated:", Object.keys(updates).join(", "));
      return { success: true, settings: updated };
    } catch (error) {
      log.error("[IPC] settings:update failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  log.info("[IPC] Settings handlers registered");
}
function registerScheduleHandlers(scheduler2) {
  electron.ipcMain.handle(IPC.SCHEDULE_ADD, async (_event, schedule) => {
    try {
      const id = scheduler2.addSchedule(schedule);
      return { success: true, id };
    } catch (error) {
      log.error("[IPC] schedule:add failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.SCHEDULE_REMOVE, async (_event, id) => {
    try {
      scheduler2.removeSchedule(id);
      return { success: true };
    } catch (error) {
      log.error("[IPC] schedule:remove failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  electron.ipcMain.handle(IPC.SCHEDULE_LIST, async () => {
    try {
      const schedules = scheduler2.getSchedules();
      return { success: true, schedules };
    } catch (error) {
      log.error("[IPC] schedule:list failed:", error.message);
      return { success: false, error: error.message };
    }
  });
  log.info("[IPC] Schedule handlers registered");
}
let tray = null;
function createTray(mainWindow2, queueManager2) {
  const iconPath = path.join(__dirname, "../../resources/icon.png");
  let trayIcon;
  try {
    trayIcon = electron.nativeImage.createFromPath(iconPath);
  } catch {
    trayIcon = electron.nativeImage.createEmpty();
  }
  tray = new electron.Tray(trayIcon);
  tray.setToolTip("IDM Clone - Download Manager");
  const contextMenu = electron.Menu.buildFromTemplate([
    {
      label: "Show IDM Clone",
      click: () => {
        mainWindow2.show();
        mainWindow2.focus();
      }
    },
    { type: "separator" },
    {
      label: "Pause All Downloads",
      click: async () => {
        await queueManager2.pauseAll();
      }
    },
    {
      label: "Resume All Downloads",
      click: async () => {
        await queueManager2.resumeAll();
      }
    },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        electron.app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow2.show();
    mainWindow2.focus();
  });
  log.info("[Tray] System tray created");
  return tray;
}
function destroyTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
const PIPE_NAME = "\\\\.\\pipe\\idm-clone";
class PipeServer {
  server = null;
  engine;
  queueManager;
  constructor(engine2, queueManager2) {
    this.engine = engine2;
    this.queueManager = queueManager2;
  }
  start() {
    if (this.server) return;
    this.server = net.createServer((socket) => {
      log.info("[PipeServer] Client connected");
      let buffer = "";
      socket.on("data", (data) => {
        buffer += data.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            this.handleMessage(line.trim(), socket);
          }
        }
      });
      socket.on("end", () => {
        if (buffer.trim()) {
          this.handleMessage(buffer.trim(), socket);
        }
        log.info("[PipeServer] Client disconnected");
      });
      socket.on("error", (err) => {
        log.error("[PipeServer] Socket error:", err.message);
      });
    });
    this.server.listen(PIPE_NAME, () => {
      log.info(`[PipeServer] Listening on ${PIPE_NAME}`);
    });
    this.server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log.warn("[PipeServer] Pipe already in use, attempting cleanup...");
        const client = net.connect(PIPE_NAME, () => {
          client.end();
          log.error("[PipeServer] Another instance is already running");
        });
        client.on("error", () => {
          this.server?.close();
          setTimeout(() => this.start(), 1e3);
        });
      } else {
        log.error("[PipeServer] Server error:", err.message);
      }
    });
  }
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
      log.info("[PipeServer] Stopped");
    }
  }
  async handleMessage(raw, socket) {
    try {
      const message = JSON.parse(raw);
      log.info(`[PipeServer] Received download request: ${message.url}`);
      const item = await this.engine.addDownload({
        url: message.url,
        filename: message.filename,
        referrer: message.referrer
      });
      await this.queueManager.enqueue(item.id);
      const ack = JSON.stringify({ success: true, id: item.id, filename: item.filename });
      socket.write(ack + "\n");
    } catch (error) {
      log.error("[PipeServer] Failed to handle message:", error.message);
      try {
        socket.write(JSON.stringify({ success: false, error: error.message }) + "\n");
      } catch {
      }
    }
  }
}
let mainWindow = null;
let engine;
let progressTracker;
let queueManager;
let scheduler;
let pipeServer;
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#000000",
      symbolColor: "#e2e8f0",
      height: 36
    },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    },
    backgroundColor: "#000000",
    icon: path.join(__dirname, "../../resources/favicon.ico")
  });
  mainWindow.on("ready-to-show", () => {
    mainWindow?.show();
  });
  mainWindow.on("close", (event) => {
    const settings = getSettings();
    if (settings.minimizeToTray && !electron.app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.webContents.setWindowOpenHandler((details) => {
    electron.shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (utils.is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
async function initializeApp() {
  initDatabase();
  const settings = getSettings();
  if (!fs.existsSync(settings.downloadFolder)) {
    fs.mkdirSync(settings.downloadFolder, { recursive: true });
  }
  engine = new DownloadEngine(settings);
  queueManager = new QueueManager(engine, settings.maxConcurrentDownloads);
  progressTracker = new ProgressTracker(engine);
  scheduler = new Scheduler(engine, queueManager);
  scheduler.initialize();
  pipeServer = new PipeServer(engine, queueManager);
  pipeServer.start();
  registerDownloadHandlers(engine, queueManager);
  registerSettingsHandlers();
  registerScheduleHandlers(scheduler);
  engine.on("download-added", (item) => {
    mainWindow?.webContents.send(IPC.DOWNLOAD_ADDED, item);
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  engine.on("status-changed", (id, status) => {
    mainWindow?.webContents.send(IPC.DOWNLOAD_STATUS_CHANGED, id, status);
  });
  engine.on("download-complete", (item) => {
    const settings2 = getSettings();
    if (settings2.showNotifications) {
      const { Notification } = require("electron");
      new Notification({
        title: "Download Complete",
        body: `${item.filename} has been downloaded successfully.`
      }).show();
    }
  });
  electron.ipcMain.on(IPC.APP_MINIMIZE_TO_TRAY, () => {
    mainWindow?.hide();
  });
  electron.ipcMain.on(IPC.APP_QUIT, () => {
    electron.app.quit();
  });
  log.info("[Main] Application initialized");
}
electron.app.isQuitting = false;
electron.app.whenReady().then(async () => {
  utils.electronApp.setAppUserModelId("com.idm.clone");
  electron.app.on("browser-window-created", (_, window2) => {
    utils.optimizer.watchWindowShortcuts(window2);
  });
  await initializeApp();
  const window = createWindow();
  progressTracker.setWindow(window);
  progressTracker.start();
  createTray(window, queueManager);
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("before-quit", () => {
  electron.app.isQuitting = true;
});
electron.app.on("window-all-closed", () => {
  const settings = getSettings();
  if (!settings.minimizeToTray) {
    electron.app.quit();
  }
});
electron.app.on("will-quit", () => {
  log.info("[Main] Application shutting down");
  progressTracker?.stop();
  pipeServer?.stop();
  scheduler?.destroy();
  destroyTray();
  closeDatabase();
});
const gotLock = electron.app.requestSingleInstanceLock();
if (!gotLock) {
  electron.app.quit();
} else {
  electron.app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
      }
      mainWindow.focus();
    }
  });
}
