import { getDb } from './database';
import type { DownloadItem, SegmentInfo, ScheduleInfo, DownloadStatus, SegmentStatus, Priority } from '../../shared/types';

// ─── Prepared Statement Cache ────────────────────────────────────────────────

/** Cache of prepared statements for hot-path queries (created lazily). */
const stmtCache = new Map<string, ReturnType<ReturnType<typeof getDb>['prepare']>>();

function cachedStmt(key: string, sql: string) {
  let stmt = stmtCache.get(key);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    stmtCache.set(key, stmt);
  }
  return stmt;
}

/** Call when the database is closed / swapped to invalidate cached statements. */
export function clearStmtCache(): void {
  stmtCache.clear();
}

// ─── Download CRUD ───────────────────────────────────────────────────────────

export function insertDownload(item: DownloadItem): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO downloads (id, url, filename, save_path, total_size, downloaded_bytes, status,
      threads, priority, created_at, completed_at, resumable, checksum, checksum_type, error, referrer, mime, speed, eta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    item.id, item.url, item.filename, item.savePath, item.totalSize,
    item.downloadedBytes, item.status, item.threads, item.priority,
    item.createdAt, item.completedAt, item.resumable ? 1 : 0,
    item.checksum, item.checksumType, item.error, item.referrer, item.mime,
    item.speed, item.eta
  );
}

export function updateDownload(id: string, updates: Partial<DownloadItem>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  const columnMap: Record<string, string> = {
    url: 'url', filename: 'filename', savePath: 'save_path', totalSize: 'total_size',
    downloadedBytes: 'downloaded_bytes', status: 'status', threads: 'threads',
    priority: 'priority', completedAt: 'completed_at', resumable: 'resumable',
    checksum: 'checksum', checksumType: 'checksum_type', error: 'error',
    referrer: 'referrer', mime: 'mime', speed: 'speed', eta: 'eta'
  };

  for (const [key, val] of Object.entries(updates)) {
    const col = columnMap[key];
    if (col) {
      fields.push(`${col} = ?`);
      values.push(key === 'resumable' ? (val ? 1 : 0) : val);
    }
  }

  if (fields.length === 0) return;

  values.push(id);
  db.prepare(`UPDATE downloads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getDownload(id: string): DownloadItem | undefined {
  const row = cachedStmt('getDownload', 'SELECT * FROM downloads WHERE id = ?').get(id) as any;
  return row ? mapRowToDownload(row) : undefined;
}

export function getAllDownloads(): DownloadItem[] {
  const rows = cachedStmt('getAllDownloads', 'SELECT * FROM downloads ORDER BY created_at DESC').all([]) as any[];
  return rows.map(mapRowToDownload);
}

export function getDownloadsByStatus(status: DownloadStatus): DownloadItem[] {
  const rows = cachedStmt('getDownloadsByStatus', 'SELECT * FROM downloads WHERE status = ? ORDER BY created_at DESC').all(status) as any[];
  return rows.map(mapRowToDownload);
}

export function deleteDownload(id: string): void {
  cachedStmt('deleteDownload', 'DELETE FROM downloads WHERE id = ?').run(id);
}

export function clearCompletedDownloads(): number {
  const result = cachedStmt('clearCompleted', "DELETE FROM downloads WHERE status = 'completed'").run([]);
  return result.changes;
}

function mapRowToDownload(row: any): DownloadItem {
  return {
    id: row.id,
    url: row.url,
    filename: row.filename,
    savePath: row.save_path,
    totalSize: row.total_size,
    downloadedBytes: row.downloaded_bytes,
    status: row.status as DownloadStatus,
    speed: row.speed || 0,
    eta: row.eta || 0,
    threads: row.threads,
    priority: row.priority as Priority,
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

// ─── Segment CRUD ────────────────────────────────────────────────────────────

export function insertSegments(segments: SegmentInfo[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO segments (download_id, segment_index, start_byte, end_byte, downloaded_bytes, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((segs: SegmentInfo[]) => {
    for (const s of segs) {
      stmt.run(s.downloadId, s.index, s.startByte, s.endByte, s.downloadedBytes, s.status);
    }
  });

  insertMany(segments);
}

export function updateSegment(downloadId: string, index: number, updates: Partial<SegmentInfo>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.downloadedBytes !== undefined) {
    fields.push('downloaded_bytes = ?');
    values.push(updates.downloadedBytes);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }

  if (fields.length === 0) return;

  values.push(downloadId, index);
  db.prepare(`UPDATE segments SET ${fields.join(', ')} WHERE download_id = ? AND segment_index = ?`).run(...values);
}

export function getSegments(downloadId: string): SegmentInfo[] {
  const rows = cachedStmt('getSegments', 'SELECT * FROM segments WHERE download_id = ? ORDER BY segment_index ASC').all(downloadId) as any[];
  return rows.map(mapRowToSegment);
}

export function deleteSegments(downloadId: string): void {
  cachedStmt('deleteSegments', 'DELETE FROM segments WHERE download_id = ?').run(downloadId);
}

export function bulkUpdateSegments(downloadId: string, segments: SegmentInfo[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE segments SET downloaded_bytes = ?, status = ?
    WHERE download_id = ? AND segment_index = ?
  `);
  const updateMany = db.transaction((segs: SegmentInfo[]) => {
    for (const s of segs) {
      stmt.run(s.downloadedBytes, s.status, downloadId, s.index);
    }
  });
  updateMany(segments);
}

function mapRowToSegment(row: any): SegmentInfo {
  return {
    id: row.id,
    downloadId: row.download_id,
    index: row.segment_index,
    startByte: row.start_byte,
    endByte: row.end_byte,
    downloadedBytes: row.downloaded_bytes,
    status: row.status as SegmentStatus
  };
}

// ─── Schedule CRUD ───────────────────────────────────────────────────────────

export function insertSchedule(schedule: Omit<ScheduleInfo, 'id'>): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO schedules (download_id, scheduled_time, repeat, auto_shutdown, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(schedule.downloadId, schedule.scheduledTime, schedule.repeat, schedule.autoShutdown ? 1 : 0, schedule.enabled ? 1 : 0);
  return result.lastInsertRowid as number;
}

export function getSchedules(): ScheduleInfo[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM schedules WHERE enabled = 1 ORDER BY scheduled_time ASC').all() as any[];
  return rows.map(mapRowToSchedule);
}

export function deleteSchedule(id: number): void {
  const db = getDb();
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

function mapRowToSchedule(row: any): ScheduleInfo {
  return {
    id: row.id,
    downloadId: row.download_id,
    scheduledTime: row.scheduled_time,
    repeat: row.repeat,
    autoShutdown: !!row.auto_shutdown,
    enabled: !!row.enabled
  };
}
