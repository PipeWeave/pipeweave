import type { Express, Request, Response } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';
import { RetryManager } from '../core/retry-manager.js';
import { DLQManager } from '../core/dlq-manager.js';
import { IdempotencyManager } from '../core/idempotency.js';
import { PipelineExecutor } from '../pipeline/executor.js';
import { HeartbeatRequestSchema, TaskCallbackPayloadSchema } from '@pipeweave/shared';
import logger from '../logger.js';

// ============================================================================
// Task Execution Routes
// ============================================================================

export function registerTaskRoutes(app: Express): void {
  /**
   * POST /api/heartbeat
   * Worker heartbeat
   */
  app.post('/api/heartbeat', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();

      // Validate request
      const parseResult = HeartbeatRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.format(),
        });
      }

      const { runId, progress, message } = parseResult.data;

      // Update heartbeat in database
      await db.none(
        `UPDATE task_runs
         SET heartbeat_at = NOW(),
             metadata = CASE
               WHEN $2::INTEGER IS NOT NULL THEN jsonb_set(metadata, '{progress}', to_jsonb($2))
               ELSE metadata
             END
         WHERE id = $1 AND status = 'running'`,
        [runId, progress ?? null]
      );

      return res.json({
        acknowledged: true,
        shouldCancel: false,
      });
    } catch (error) {
      logger.error('[tasks] Failed to process heartbeat', { error });
      return res.status(500).json({
        error: 'Failed to process heartbeat',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/progress
   * Task progress update (alias for heartbeat)
   */
  app.post('/api/progress', async (req: Request, res: Response) => {
    // Just call heartbeat endpoint logic directly
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();

      const parseResult = HeartbeatRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.format(),
        });
      }

      const { runId, progress, message } = parseResult.data;

      await db.none(
        `UPDATE task_runs
         SET heartbeat_at = NOW(),
             metadata = CASE
               WHEN $2::INTEGER IS NOT NULL THEN jsonb_set(metadata, '{progress}', to_jsonb($2))
               ELSE metadata
             END
         WHERE id = $1 AND status = 'running'`,
        [runId, progress ?? null]
      );

      return res.json({
        acknowledged: true,
        shouldCancel: false,
      });
    } catch (error) {
      logger.error('[tasks] Failed to process progress', { error });
      return res.status(500).json({
        error: 'Failed to update progress',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/callback/:runId
   * Task completion callback
   */
  app.post('/api/callback/:runId', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const { runId } = req.params;
      if (!runId) {
        return res.status(400).json({ error: 'Run ID is required' });
      }
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();

      // Validate request
      const parseResult = TaskCallbackPayloadSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.format(),
        });
      }

      const payload = parseResult.data;

      // Handle success or failure
      if (payload.status === 'success') {
        // Update task run
        await db.none(
          `UPDATE task_runs
           SET status = 'completed',
               output_path = $2,
               output_size = $3,
               assets = $4,
               logs_path = $5,
               selected_next = $6,
               completed_at = NOW()
           WHERE id = $1`,
          [
            runId,
            payload.outputPath ?? null,
            payload.outputSize ?? null,
            payload.assets ? JSON.stringify(payload.assets) : null,
            payload.logsPath ?? null,
            payload.selectedNext ?? [],
          ]
        );

        logger.info(`[tasks] Task completed: ${runId}`);

        // Queue downstream tasks (pipeline integration)
        const pipelineExecutor = new PipelineExecutor(db, orchestrator, 'storage');
        const queuedTasks = await pipelineExecutor.queueDownstreamTasks(
          runId,
          payload.selectedNext
        );

        if (queuedTasks.length > 0) {
          logger.info(`[tasks] Queued ${queuedTasks.length} downstream tasks`);
        }

        // Cache idempotency result if applicable
        const taskRun = await db.oneOrNone<{
          idempotency_key: string | null;
          task_id: string;
          code_version: number;
        }>(
          'SELECT idempotency_key, task_id, code_version FROM task_runs WHERE id = $1',
          [runId]
        );

        if (taskRun?.idempotency_key && payload.outputPath) {
          // Get task definition to get TTL
          const task = await db.oneOrNone<{ idempotency_ttl_seconds: number | null }>(
            'SELECT idempotency_ttl_seconds FROM tasks WHERE id = $1',
            [taskRun.task_id]
          );

          const ttl = task?.idempotency_ttl_seconds ?? 86400; // Default 24 hours

          const idempotencyManager = new IdempotencyManager(db);
          await idempotencyManager.cacheResult(
            taskRun.idempotency_key,
            taskRun.task_id,
            runId,
            taskRun.code_version,
            payload.outputPath,
            ttl,
            payload.outputSize ?? undefined,
            payload.assets ?? undefined
          );
        }

        return res.json({
          acknowledged: true,
          queuedDownstream: queuedTasks.length,
        });
      } else {
        // Handle failure
        await db.none(
          `UPDATE task_runs
           SET status = 'failed',
               error = $2,
               error_code = $3,
               logs_path = $4,
               completed_at = NOW()
           WHERE id = $1`,
          [runId, payload.error ?? 'Unknown error', payload.errorCode ?? null, payload.logsPath ?? null]
        );

        logger.warn(`[tasks] Task failed: ${runId} - ${payload.error}`);

        // Check if we should retry
        const taskRun = await db.oneOrNone<{
          attempt: number;
          max_retries: number;
          task_id: string;
        }>(
          'SELECT attempt, max_retries, task_id FROM task_runs WHERE id = $1',
          [runId]
        );

        if (taskRun) {
          if (taskRun.attempt < taskRun.max_retries) {
            // Get task definition for retry settings
            const task = await db.oneOrNone<{
              retry_backoff: 'fixed' | 'exponential';
              retry_delay_ms: number;
              max_retry_delay_ms: number;
            }>(
              'SELECT retry_backoff, retry_delay_ms, max_retry_delay_ms FROM tasks WHERE id = $1',
              [taskRun.task_id]
            );

            // Schedule retry
            const retryManager = new RetryManager(db);
            await retryManager.scheduleRetry({
              runId,
              taskId: taskRun.task_id,
              attempt: taskRun.attempt,
              maxRetries: taskRun.max_retries,
              retryBackoff: task?.retry_backoff ?? 'exponential',
              retryDelayMs: task?.retry_delay_ms ?? 1000,
              maxRetryDelayMs: task?.max_retry_delay_ms ?? 86400000,
              error: payload.error ?? 'Unknown error',
              errorCode: payload.errorCode,
            });
            logger.info(`[tasks] Scheduled retry for task run: ${runId}`);
          } else {
            // Get full task run data for DLQ
            const fullTaskRun = await db.oneOrNone(
              'SELECT * FROM task_runs WHERE id = $1',
              [runId]
            );

            if (fullTaskRun) {
              // Move to DLQ
              const dlqManager = new DLQManager(db);
              await dlqManager.add(fullTaskRun, payload.error ?? 'Unknown error');
              logger.info(`[tasks] Moved to DLQ: ${runId}`);

              // Handle pipeline failure
              const pipelineExecutor = new PipelineExecutor(db, orchestrator, 'storage');
              await pipelineExecutor.handleTaskFailure(runId);
            }
          }
        }

        return res.json({
          acknowledged: true,
          retrying: taskRun ? taskRun.attempt < taskRun.max_retries : false,
        });
      }
    } catch (error) {
      logger.error('[tasks] Failed to process callback', { error });
      return res.status(500).json({
        error: 'Failed to process callback',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/tasks/:id/history
   * Task code change history
   */
  app.get('/api/tasks/:id/history', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Task ID is required' });
      }
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();

      const history = await db.manyOrNone(
        `SELECT code_version, code_hash, service_version, recorded_at
         FROM task_code_history
         WHERE task_id = $1
         ORDER BY code_version DESC`,
        [id]
      );

      return res.json({ history });
    } catch (error) {
      logger.error('[tasks] Failed to get task history', { error });
      return res.status(500).json({
        error: 'Failed to get task history',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
