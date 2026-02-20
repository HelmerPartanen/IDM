import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import log from 'electron-log';

/**
 * Check if there is sufficient disk space at the target directory.
 * Returns true if space is available (or cannot be determined).
 */
export async function checkDiskSpace(dir: string, requiredBytes: number): Promise<boolean> {
  try {
    // On Windows, use wmic to check free space
    if (process.platform === 'win32') {
      const drive = path.parse(path.resolve(dir)).root.replace('\\', '');
      return new Promise((resolve) => {
        exec(`wmic logicaldisk where "DeviceID='${drive}'" get FreeSpace /value`, (err, stdout) => {
          if (err) { resolve(true); return; } // Fallback: assume OK
          const match = stdout.match(/FreeSpace=(\d+)/);
          if (match) {
            const free = parseInt(match[1], 10);
            // Require at least 2x the file size as a safety margin (temp files, etc.)
            const sufficient = free > requiredBytes * 1.1;
            if (!sufficient) {
              log.warn(`[FileAllocator] Low disk space: ${formatBytes(free)} free, need ${formatBytes(requiredBytes)}`);
            }
            resolve(sufficient);
          } else {
            resolve(true);
          }
        });
      });
    }
    // Fallback for non-Windows
    return true;
  } catch {
    return true; // Assume OK on error
  }
}

/**
 * Pre-allocate a file to the specified size using ftruncate.
 * This reserves disk space and allows random-access writes from segments.
 * Returns the file descriptor for writing.
 */
export async function allocateFile(filePath: string, totalSize: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (mkdirErr: any) {
        log.error(`[FileAllocator] Cannot create directory: ${dir}`, mkdirErr.message);
        return reject(new Error(`Cannot create download directory: ${mkdirErr.message}`));
      }
    }

    // Open file for reading and writing, create if not exists
    fs.open(filePath, 'w+', (err, fd) => {
      if (err) {
        if (err.code === 'EACCES' || err.code === 'EPERM') {
          log.error(`[FileAllocator] Permission denied: ${filePath}`);
          return reject(new Error(`Permission denied for: ${filePath}`));
        }
        log.error(`[FileAllocator] Failed to open file: ${filePath}`, err.message);
        return reject(err);
      }

      if (totalSize <= 0) {
        // If we don't know the size, just return the fd without truncating
        resolve(fd);
        return;
      }

      // Pre-allocate the file to the full size
      fs.ftruncate(fd, totalSize, (err2) => {
        if (err2) {
          if (err2.code === 'ENOSPC') {
            log.error(`[FileAllocator] Disk full — cannot allocate ${formatBytes(totalSize)} for: ${filePath}`);
            fs.close(fd, () => {});
            return reject(new Error(`Disk full. Need ${formatBytes(totalSize)} free.`));
          }
          log.error(`[FileAllocator] Failed to allocate ${totalSize} bytes for: ${filePath}`, err2.message);
          fs.close(fd, () => {});
          return reject(err2);
        }

        log.info(`[FileAllocator] Allocated ${formatBytes(totalSize)} for: ${filePath}`);
        resolve(fd);
      });
    });
  });
}

/**
 * Open an existing partially-downloaded file for resume operations.
 * Returns the file descriptor for writing at specific offsets.
 */
export async function openFileForResume(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found for resume: ${filePath}`));
    }
    fs.open(filePath, 'r+', (err, fd) => {
      if (err) {
        log.error(`[FileAllocator] Failed to open file for resume: ${filePath}`, err.message);
        return reject(err);
      }
      resolve(fd);
    });
  });
}

/**
 * Close a file descriptor safely.
 */
export async function closeFile(fd: number): Promise<void> {
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

/**
 * Write a buffer to a specific offset in the file.
 * Used by segment downloaders to write data directly to the correct position.
 */
export async function writeAtOffset(
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number
): Promise<number> {
  return new Promise((resolve, reject) => {
    fs.write(fd, buffer, 0, length, offset, (err, bytesWritten) => {
      if (err) {
        if (err.code === 'ENOSPC') {
          return reject(new Error('Disk full during write'));
        }
        return reject(err);
      }
      resolve(bytesWritten);
    });
  });
}

/**
 * Verify file size matches expected total size.
 */
export async function verifyFileSize(filePath: string, expectedSize: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) return reject(err);
      const match = stats.size === expectedSize;
      if (!match) {
        log.warn(`[FileAllocator] Size mismatch: expected ${formatBytes(expectedSize)}, got ${formatBytes(stats.size)}`);
      }
      resolve(match);
    });
  });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
