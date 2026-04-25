/**
 * Utility functions for the backend service
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLogLevel: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLogLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(`[${formatTimestamp()}] [DEBUG] ${message}`, ...args);
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(`[${formatTimestamp()}] [INFO] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.warn(`[${formatTimestamp()}] [WARN] ${message}`, ...args);
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.error(`[${formatTimestamp()}] [ERROR] ${message}`, ...args);
    }
  },
};

/**
 * Simple exponential backoff helper
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxAttempts) {
        break;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      logger.warn(
        `Attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`,
        lastError.message
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely parse JSON with a fallback
 */
export function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Async queue for streaming input to the agent
 *
 * Allows messages to be pushed while the agent is running,
 * enabling interrupts and asides mid-turn.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = [];
  private waiters: Array<() => void> = [];
  private closed = false;

  /**
   * Push a message to the queue
   */
  push(item: T): void {
    if (this.closed) {
      throw new Error('AsyncQueue is closed');
    }
    this.queue.push(item);
    this.wake();
  }

  /**
   * Close the queue and wake all waiters
   */
  close(): void {
    this.closed = true;
    this.wake();
  }

  /**
   * Check if the queue is closed and empty
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Number of items currently buffered (does not include items still in flight).
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Synchronously remove and return all currently-buffered items.
   * Useful for non-blocking polling in the mock agent.
   */
  drainPending(): T[] {
    const items = this.queue;
    this.queue = [];
    return items;
  }

  /**
   * Iterate over messages as they arrive
   */
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (!this.closed || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (!this.closed) {
        // Wait for next message or close
        await new Promise<void>((resolve) => {
          this.waiters.push(resolve);
        });
      }
    }
  }

  private wake(): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter();
    }
  }
}
