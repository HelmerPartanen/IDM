import type { RetryConfig } from '../../shared/types';
import log from 'electron-log';

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 5,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  jitter: true
};

/**
 * Calculate delay for a given retry attempt using exponential backoff with optional jitter.
 */
export function calculateRetryDelay(attempt: number, config: RetryConfig = DEFAULT_RETRY_CONFIG): number {
  const baseDelay = Math.min(
    config.initialDelay * Math.pow(config.backoffFactor, attempt),
    config.maxDelay
  );

  if (config.jitter) {
    // Add ±25% jitter to avoid thundering herd
    const jitterFactor = 0.75 + Math.random() * 0.5;
    return Math.floor(baseDelay * jitterFactor);
  }

  return Math.floor(baseDelay);
}

/**
 * Determine if an error is retryable.
 * - Retry on network errors, timeouts, and 5xx responses
 * - Do NOT retry on 4xx (except 429 Too Many Requests)
 */
export function isRetryableError(error: any): boolean {
  // Network-level errors — always retryable
  const retryableCodes = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED',
    'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
    'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
    'EPROTO', 'ERR_SOCKET_TIMEOUT', 'HPE_HEADER_OVERFLOW'
  ]);
  if (error.code && retryableCodes.has(error.code)) {
    return true;
  }

  // HTTP status codes
  const statusCode = error.statusCode || error.response?.statusCode;
  if (statusCode) {
    // 429 Too Many Requests - retryable
    if (statusCode === 429) return true;
    // 408 Request Timeout - retryable
    if (statusCode === 408) return true;
    // 503 Service Unavailable - retryable
    if (statusCode === 503) return true;
    // 5xx Server errors - retryable
    if (statusCode >= 500 && statusCode < 600) return true;
    // 4xx Client errors - NOT retryable (except above)
    if (statusCode >= 400 && statusCode < 500) return false;
  }

  // Timeout errors
  if (error.name === 'TimeoutError' || error.message?.includes('timeout') || error.message?.includes('Stall')) {
    return true;
  }

  // Default: retry on unknown errors
  return true;
}

/**
 * Extract Retry-After header value (in ms) if present.
 */
export function getRetryAfterMs(error: any): number | null {
  const retryAfter = error.response?.headers?.['retry-after'];
  if (!retryAfter) return null;

  const seconds = parseInt(retryAfter, 10);
  if (!isNaN(seconds)) {
    return seconds * 1000;
  }

  // Could be a date string
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - Date.now());
  }

  return null;
}

/**
 * Execute a function with retry logic.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  label: string = 'operation'
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (attempt >= config.maxRetries) {
        log.error(`[Retry] ${label}: All ${config.maxRetries} retries exhausted`, error.message);
        throw error;
      }

      if (!isRetryableError(error)) {
        log.error(`[Retry] ${label}: Non-retryable error`, error.message);
        throw error;
      }

      // Use Retry-After header if available, otherwise calculate backoff
      const retryAfter = getRetryAfterMs(error);
      const delay = retryAfter ?? calculateRetryDelay(attempt, config);

      log.warn(`[Retry] ${label}: Attempt ${attempt + 1}/${config.maxRetries} failed. Retrying in ${delay}ms...`, error.message);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
