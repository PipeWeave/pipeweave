import { customAlphabet } from 'nanoid';
import type { Database } from '../db/index.js';
import type { QueueStatusResponse } from '@pipeweave/shared';
import { IdempotencyManager } from './idempotency.js';
import { onTaskStatusChange } from '../maintenance.js';
import logger from '../logger.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

// ============================================================================
// Types
// ============================================================================

export interface QueueTaskOptions {
  taskId: string;
  input: unknown;
  priority?: number;
  pipelineRunId?: string;
  upstreamRefs?: Record<string, any>;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  scheduledFor?: Date;
}

export interface QueuedTask {
  runId: string;
  taskId: string;
  status: string;
  inputPath: string;
}

export interface PendingTask {
  runId: string;
  taskId: string;
  pipelineRunId?: string;
  codeVersion: number;
  codeHash: string;
  attempt: number;
  maxRetries: number;
  priority: number;
  inputPath: string;
  upstreamRefs: Record<string, any>;
  previousAttempts: Array<{
    attempt: number;
    error: string;
    errorCode?: string;
    timestamp: Date;
  }>;
  idempotencyKey?: string;
}

// ============================================================================
// Queue Manager
// ============================================================================

export class QueueManager {
  private idempotencyManager: IdempotencyManager;

  constructor(private db: Database, private storageBasePath: string) {
    this.idempotencyManager = new IdempotencyManager(db);
  }

  /**
   * Queue a single task
   */
  async enqueue(options: QueueTaskOptions): Promise<QueuedTask> {
    const {
      taskId,
      input,
      priority,
      pipelineRunId,
      upstreamRefs,
      metadata,
      idempotencyKey,
      scheduledFor,
    } = options;

    // Get task definition
    const task = await this.db.oneOrNone<{
      code_version: number;
      code_hash: string;
      retries: number;
      priority: number;
      idempotency_ttl_seconds: number | null;
    }>(
      'SELECT code_version, code_hash, retries, priority, idempotency_ttl_seconds FROM tasks WHERE id = $1',
      [taskId]
    );

    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }

    // Check idempotency
    if (idempotencyKey) {
      const cached = await this.idempotencyManager.checkIdempotency(idempotencyKey);
      if (cached) {
        logger.info(`[queue] Idempotency hit for key: ${idempotencyKey}, returning cached result`);
        return {
          runId: cached.taskRunId,
          taskId,
          status: 'completed',
          inputPath: cached.outputPath,
        };
      }
    }

    const runId = `trun_${nanoid()}`;
    const inputPath = pipelineRunId
      ? `runs/${pipelineRunId}/tasks/${runId}/input.json`
      : `standalone/${runId}/input.json`;

    // Store input in database metadata for now (TODO: upload to storage)
    const taskPriority = priority ?? task.priority;

    await this.db.none(
      `INSERT INTO task_runs (
         id, task_id, pipeline_run_id, status, code_version, code_hash,
         attempt, max_retries, priority, input_path, upstream_refs,
         idempotency_key, scheduled_for, created_at, metadata, previous_attempts
       )
       VALUES ($1, $2, $3, 'pending', $4, $5, 1, $6, $7, $8, $9, $10, $11, NOW(), $12, '[]'::jsonb)`,
      [
        runId,
        taskId,
        pipelineRunId ?? null,
        task.code_version,
        task.code_hash,
        task.retries,
        taskPriority,
        inputPath,
        upstreamRefs ? JSON.stringify(upstreamRefs) : '{}',
        idempotencyKey ?? null,
        scheduledFor ?? null,
        metadata ? JSON.stringify(metadata) : '{}',
      ]
    );

    logger.info(`[queue] Task queued: ${taskId} (runId: ${runId}, priority: ${taskPriority})`);

    return {
      runId,
      taskId,
      status: 'pending',
      inputPath,
    };
  }

  /**
   * Queue multiple tasks in batch
   */
  async enqueueBatch(tasks: QueueTaskOptions[]): Promise<QueuedTask[]> {
    const results: QueuedTask[] = [];

    for (const task of tasks) {
      try {
        const queued = await this.enqueue(task);
        results.push(queued);
      } catch (error) {
        logger.error('[queue] Failed to queue task in batch', { error, taskId: task.taskId });
        throw error;
      }
    }

    return results;
  }

  /**
   * Get next pending tasks to execute (respects concurrency limits)
   */
  async getNext(limit: number): Promise<PendingTask[]> {
    const rows = await this.db.manyOrNone<any>(
      `WITH running_counts AS (
         SELECT task_id, COUNT(*) as running
         FROM task_runs
         WHERE status = 'running'
         GROUP BY task_id
       )
       SELECT
         tr.id as run_id,
         tr.task_id,
         tr.pipeline_run_id,
         tr.code_version,
         tr.code_hash,
         tr.attempt,
         tr.max_retries,
         tr.priority,
         tr.input_path,
         tr.upstream_refs,
         tr.previous_attempts,
         tr.idempotency_key
       FROM task_runs tr
       LEFT JOIN running_counts rc ON tr.task_id = rc.task_id
       LEFT JOIN tasks t ON tr.task_id = t.id
       WHERE tr.status = 'pending'
         AND (tr.scheduled_for IS NULL OR tr.scheduled_for <= NOW())
         AND (t.concurrency = 0 OR COALESCE(rc.running, 0) < t.concurrency)
       ORDER BY tr.priority ASC, tr.created_at ASC
       LIMIT $1`,
      [limit]
    );

    return rows.map((row) => ({
      runId: row.run_id,
      taskId: row.task_id,
      pipelineRunId: row.pipeline_run_id ?? undefined,
      codeVersion: row.code_version,
      codeHash: row.code_hash,
      attempt: row.attempt,
      maxRetries: row.max_retries,
      priority: row.priority,
      inputPath: row.input_path,
      upstreamRefs: row.upstream_refs ?? {},
      previousAttempts: row.previous_attempts ?? [],
      idempotencyKey: row.idempotency_key ?? undefined,
    }));
  }

  /**
   * Mark task as running
   */
  async markRunning(runId: string): Promise<void> {
    await this.db.none(
      `UPDATE task_runs
       SET status = 'running', started_at = NOW()
       WHERE id = $1`,
      [runId]
    );
  }

  /**
   * Mark task as completed
   */
  async markCompleted(
    runId: string,
    outputPath: string,
    outputSize?: number,
    assets?: Record<string, any>,
    logsPath?: string
  ): Promise<void> {
    await this.db.none(
      `UPDATE task_runs
       SET status = 'completed',
           output_path = $2,
           output_size = $3,
           assets = $4,
           logs_path = $5,
           completed_at = NOW()
       WHERE id = $1`,
      [runId, outputPath, outputSize ?? null, assets ? JSON.stringify(assets) : null, logsPath ?? null]
    );

    // Trigger maintenance transition check (event-driven)
    await onTaskStatusChange(this.db);
  }

  /**
   * Mark task as failed
   */
  async markFailed(
    runId: string,
    error: string,
    errorCode?: string
  ): Promise<void> {
    await this.db.none(
      `UPDATE task_runs
       SET status = 'failed',
           error = $2,
           error_code = $3,
           completed_at = NOW()
       WHERE id = $1`,
      [runId, error, errorCode ?? null]
    );

    // Trigger maintenance transition check (event-driven)
    await onTaskStatusChange(this.db);
  }

  /**
   * Get queue status statistics
   */
  async getStatus(): Promise<QueueStatusResponse> {
    const stats = await this.db.manyOrNone<{
      status: string;
      count: string;
    }>(
      `SELECT status, COUNT(*) as count
       FROM task_runs
       WHERE status IN ('pending', 'running', 'waiting', 'completed', 'failed')
       GROUP BY status`
    );

    const oldestPending = await this.db.oneOrNone<{ created_at: Date }>(
      `SELECT created_at
       FROM task_runs
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 1`
    );

    const dlqCount = await this.db.one<{ count: string }>(
      'SELECT COUNT(*) as count FROM dlq WHERE retried_at IS NULL'
    );

    const statusMap: Record<string, number> = {
      pending: 0,
      running: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
    };

    for (const stat of stats) {
      statusMap[stat.status] = parseInt(stat.count, 10);
    }

    return {
      pending: statusMap.pending ?? 0,
      running: statusMap.running ?? 0,
      waiting: statusMap.waiting ?? 0,
      completed: statusMap.completed ?? 0,
      failed: statusMap.failed ?? 0,
      dlq: parseInt(dlqCount.count, 10),
      oldestPending: oldestPending?.created_at ?? null,
    };
  }

  /**
   * Check if task can run (concurrency not exceeded)
   */
  async canRunTask(taskId: string): Promise<boolean> {
    const result = await this.db.oneOrNone<{
      concurrency: number;
      running: number;
    }>(
      `SELECT
         t.concurrency,
         COALESCE(COUNT(tr.id) FILTER (WHERE tr.status = 'running'), 0)::int as running
       FROM tasks t
       LEFT JOIN task_runs tr ON tr.task_id = t.id AND tr.status = 'running'
       WHERE t.id = $1
       GROUP BY t.concurrency`,
      [taskId]
    );

    if (!result) {
      return false;
    }

    // 0 = unlimited
    if (result.concurrency === 0) {
      return true;
    }

    return result.running < result.concurrency;
  }

  /**
   * Get task run by ID
   */
  async getTaskRun(runId: string): Promise<PendingTask | null> {
    const row = await this.db.oneOrNone<any>(
      `SELECT
         id as run_id,
         task_id,
         pipeline_run_id,
         code_version,
         code_hash,
         attempt,
         max_retries,
         priority,
         input_path,
         upstream_refs,
         previous_attempts,
         idempotency_key
       FROM task_runs
       WHERE id = $1`,
      [runId]
    );

    if (!row) {
      return null;
    }

    return {
      runId: row.run_id,
      taskId: row.task_id,
      pipelineRunId: row.pipeline_run_id ?? undefined,
      codeVersion: row.code_version,
      codeHash: row.code_hash,
      attempt: row.attempt,
      maxRetries: row.max_retries,
      priority: row.priority,
      inputPath: row.input_path,
      upstreamRefs: row.upstream_refs ?? {},
      previousAttempts: row.previous_attempts ?? [],
      idempotencyKey: row.idempotency_key ?? undefined,
    };
  }
}
