import fs from 'fs';
import log from 'electron-log';

/**
 * Pre-allocate a file to the specified size using ftruncate.
 * This reserves disk space and allows random-access writes from segments.
 * Returns the file descriptor for writing.
 */
export async function allocateFile(filePath: string, totalSize: number): Promise<number> {
  return new Promise((resolve, reject) => {
    // Open file for reading and writing, create if not exists
    fs.open(filePath, 'w+', (err, fd) => {
      if (err) {
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
      resolve(stats.size === expectedSize);
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
