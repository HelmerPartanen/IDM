import crypto from 'crypto';
import fs from 'fs';
import log from 'electron-log';

export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512';

/**
 * Compute the hash of a file using streaming to avoid loading the whole file into memory.
 * Works efficiently for files of any size (including >10 GB).
 */
export function computeFileHash(
  filePath: string,
  algorithm: HashAlgorithm = 'sha256'
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 }); // 1MB chunks

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      const digest = hash.digest('hex');
      log.info(`[Integrity] ${algorithm.toUpperCase()} hash for ${filePath}: ${digest}`);
      resolve(digest);
    });

    stream.on('error', (err) => {
      log.error(`[Integrity] Error computing hash for ${filePath}:`, err.message);
      reject(err);
    });
  });
}

/**
 * Verify a file's hash against an expected value.
 */
export async function verifyFileHash(
  filePath: string,
  expectedHash: string,
  algorithm: HashAlgorithm = 'sha256'
): Promise<boolean> {
  const actualHash = await computeFileHash(filePath, algorithm);
  const match = actualHash.toLowerCase() === expectedHash.toLowerCase();

  if (!match) {
    log.warn(`[Integrity] Hash mismatch for ${filePath}: expected ${expectedHash}, got ${actualHash}`);
  }

  return match;
}

/**
 * Verify that a file's size matches the expected size.
 */
export function verifyFileSize(filePath: string, expectedSize: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    fs.stat(filePath, (err, stats) => {
      if (err) {
        return reject(err);
      }

      const match = stats.size === expectedSize;
      if (!match) {
        log.warn(`[Integrity] Size mismatch for ${filePath}: expected ${expectedSize}, got ${stats.size}`);
      }

      resolve(match);
    });
  });
}
