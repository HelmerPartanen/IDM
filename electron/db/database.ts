import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import log from 'electron-log';

let db: Database.Database | null = null;

export function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  return path.join(userDataPath, 'idm-clone.db');
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  log.info(`Initializing database at: ${dbPath}`);

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent access performance
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  // Increase page cache for faster reads (8 MB)
  db.pragma('cache_size = -8000');
  // Memory-map up to 64 MB for faster I/O
  db.pragma('mmap_size = 67108864');
  // Keep temp tables in memory
  db.pragma('temp_store = MEMORY');

  runMigrations(db);

  log.info('Database initialized successfully');
  return db;
}

function runMigrations(database: Database.Database): void {
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

export function closeDatabase(): void {
  if (db) {
    // Invalidate prepared statement cache before closing
    try {
      const { clearStmtCache } = require('./models');
      clearStmtCache();
    } catch { /* models may not be loaded */ }
    db.close();
    db = null;
    log.info('Database closed');
  }
}
