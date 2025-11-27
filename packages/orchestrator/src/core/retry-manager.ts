import type { Database } from '../db/index.js';
import logger from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface RetryOptions {
  runId: string;
  taskId: string;
  attempt: number;
  maxRetries: number;
  retryBackoff: 'fixed' | 'exponential';
  retryDelayMs: number;
  maxRetryDelayMs: number;
  error: string;
  errorCode?: string;
}

// ============================================================================
// Retry Manager
// ============================================================================

export class RetryManager {
  constructor(private db: Database) {}

  /**
   * Schedule a retry for a failed task
   */
  async scheduleRetry(options: RetryOptions): Promise<boolean> {
    const { runId, attempt, maxRetries } = options;

    if (attempt >= maxRetries) {
      logger.info(`[retry] Task ${runId} exhausted all retries (${attempt}/${maxRetries})`);
      return false;
    }

    const nextAttempt = attempt + 1;
    const delay = this.calculateDelay(options);
    const scheduledFor = new Date(Date.now() + delay);

    // Update previous attempts history
    const attemptRecord = {
      attempt,
      error: options.error,
      errorCode: options.errorCode,
      timestamp: new Date(),
    };

    await this.db.none(
      `UPDATE task_runs
       SET status = 'pending',
           attempt = $2,
           scheduled_for = $3,
           previous_attempts = previous_attempts || $4::jsonb,
           error = NULL,
           error_code = NULL
       WHERE id = $1`,
      [runId, nextAttempt, scheduledFor, JSON.stringify(attemptRecord)]
    );

    logger.info(
      `[retry] Scheduled retry for task ${runId} (attempt ${nextAttempt}/${maxRetries} in ${delay}ms)`
    );

    return true;
  }

  /**
   * Calculate retry delay based on backoff strategy
   */
  private calculateDelay(options: RetryOptions): number {
    const { retryBackoff, retryDelayMs, maxRetryDelayMs, attempt } = options;

    if (retryBackoff === 'fixed') {
      return retryDelayMs;
    }

    // Exponential: delay = min(base * 2^(attempt-1), max)
    const exponentialDelay = retryDelayMs * Math.pow(2, attempt - 1);
    return Math.min(exponentialDelay, maxRetryDelayMs);
  }
}
