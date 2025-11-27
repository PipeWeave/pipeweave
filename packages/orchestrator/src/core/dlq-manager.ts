import { customAlphabet } from 'nanoid';
import type { Database } from '../db/index.js';
import type { PendingTask } from './queue-manager.js';
import logger from '../logger.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

// ============================================================================
// Types
// ============================================================================

export interface DLQEntry {
  id: string;
  taskRunId: string;
  taskId: string;
  pipelineRunId?: string;
  codeVersion: number;
  codeHash: string;
  error: string;
  attempts: number;
  failedAt: Date;
  inputPath: string;
  upstreamRefs: Record<string, any>;
  previousAttempts: Array<{
    attempt: number;
    error: string;
    errorCode?: string;
    timestamp: Date;
  }>;
}

// ============================================================================
// DLQ Manager
// ============================================================================

export class DLQManager {
  constructor(private db: Database) {}

  /**
   * Add a failed task to the DLQ
   */
  async add(taskRun: PendingTask, error: string): Promise<string> {
    const dlqId = `dlq_${nanoid()}`;

    await this.db.none(
      `INSERT INTO dlq (
         id, task_run_id, task_id, pipeline_run_id,
         code_version, code_hash, error, attempts,
         input_path, upstream_refs, previous_attempts, failed_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())`,
      [
        dlqId,
        taskRun.runId,
        taskRun.taskId,
        taskRun.pipelineRunId ?? null,
        taskRun.codeVersion,
        taskRun.codeHash,
        error,
        taskRun.attempt,
        taskRun.inputPath,
        JSON.stringify(taskRun.upstreamRefs),
        JSON.stringify(taskRun.previousAttempts),
      ]
    );

    logger.info(`[dlq] Added task to DLQ: ${taskRun.taskId} (runId: ${taskRun.runId}, dlqId: ${dlqId})`);

    return dlqId;
  }

  /**
   * Get DLQ entry by ID
   */
  async get(dlqId: string): Promise<DLQEntry | null> {
    const row = await this.db.oneOrNone<any>(
      'SELECT * FROM dlq WHERE id = $1',
      [dlqId]
    );

    if (!row) {
      return null;
    }

    return this.mapDLQEntry(row);
  }

  /**
   * List all DLQ entries
   */
  async list(limit: number = 100, offset: number = 0): Promise<DLQEntry[]> {
    const rows = await this.db.manyOrNone<any>(
      `SELECT * FROM dlq
       WHERE retried_at IS NULL
       ORDER BY failed_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return rows.map((row) => this.mapDLQEntry(row));
  }

  /**
   * Mark DLQ entry as retried
   */
  async markRetried(dlqId: string, newRunId: string): Promise<void> {
    await this.db.none(
      `UPDATE dlq
       SET retried_at = NOW(), retry_run_id = $2
       WHERE id = $1`,
      [dlqId, newRunId]
    );
  }

  /**
   * Purge old DLQ entries
   */
  async purge(retentionDays: number): Promise<number> {
    const result = await this.db.result(
      `DELETE FROM dlq
       WHERE failed_at < NOW() - INTERVAL '${retentionDays} days'`,
    );

    logger.info(`[dlq] Purged ${result.rowCount} entries older than ${retentionDays} days`);

    return result.rowCount;
  }

  /**
   * Map database row to DLQ entry
   */
  private mapDLQEntry(row: any): DLQEntry {
    return {
      id: row.id,
      taskRunId: row.task_run_id,
      taskId: row.task_id,
      pipelineRunId: row.pipeline_run_id ?? undefined,
      codeVersion: row.code_version,
      codeHash: row.code_hash,
      error: row.error,
      attempts: row.attempts,
      failedAt: row.failed_at,
      inputPath: row.input_path,
      upstreamRefs: row.upstream_refs ?? {},
      previousAttempts: row.previous_attempts ?? [],
    };
  }
}
