import type { Database } from '../db/index.js';
import type { Orchestrator } from '../orchestrator.js';
import type { PendingTask } from './queue-manager.js';
import type { RegisteredTask } from './registry.js';
import { ServiceRegistry } from './registry.js';
import { encryptStorageToken } from '../storage/jwt.js';
import { extractTempUploadIds, type TaskDispatchPayload } from '@pipeweave/shared';
import logger from '../logger.js';

// ============================================================================
// Task Executor
// ============================================================================

export class TaskExecutor {
  private registry: ServiceRegistry;

  constructor(
    private db: Database,
    private orchestrator: Orchestrator,
    private secretKey: string
  ) {
    this.registry = new ServiceRegistry(db);
  }

  /**
   * Dispatch a task to a worker
   */
  async dispatch(queueItem: PendingTask): Promise<void> {
    const { runId, taskId } = queueItem;

    try {
      // Get task definition and service
      const task = await this.registry.getTask(taskId);
      if (!task) {
        throw new Error(`Task '${taskId}' not found`);
      }

      const service = await this.registry.getService(task.serviceId);
      if (!service) {
        throw new Error(`Service '${task.serviceId}' not found`);
      }

      // Build dispatch payload
      const payload = await this.buildDispatchPayload(queueItem, task);

      // POST to worker
      const url = `${service.baseUrl}/tasks/${taskId}`;
      logger.info(`[executor] Dispatching task ${taskId} to ${url} (runId: ${runId})`);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000), // 5s timeout for dispatch
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `Worker returned ${response.status}: ${text || response.statusText}`
        );
      }

      // Mark as dispatched/running
      await this.db.none(
        `UPDATE task_runs
         SET status = 'running', started_at = NOW()
         WHERE id = $1`,
        [runId]
      );

      // Claim any temporary uploads referenced in the input
      await this.claimTempUploads(runId, queueItem.inputPath);

      logger.info(`[executor] Task ${taskId} dispatched successfully (runId: ${runId})`);
    } catch (error) {
      logger.error('[executor] Dispatch failed', {
        error,
        runId,
        taskId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });

      // Mark as failed
      await this.db.none(
        `UPDATE task_runs
         SET status = 'failed',
             error = $2,
             error_code = 'DISPATCH_FAILED',
             completed_at = NOW()
         WHERE id = $1`,
        [runId, error instanceof Error ? error.message : 'Unknown error']
      );

      throw error;
    }
  }

  /**
   * Build task dispatch payload
   */
  private async buildDispatchPayload(
    queueItem: PendingTask,
    task: RegisteredTask
  ): Promise<TaskDispatchPayload> {
    // Generate storage JWT
    const storageBackend = this.orchestrator.getDefaultStorageBackend();
    const storageToken = encryptStorageToken(
      storageBackend,
      this.secretKey,
      3600 // 1 hour expiration
    );

    // Load upstream outputs (if pipeline task)
    const upstreamRefs = await this.loadUpstreamRefs(queueItem);

    return {
      runId: queueItem.runId,
      taskId: queueItem.taskId,
      pipelineRunId: queueItem.pipelineRunId,
      attempt: queueItem.attempt,
      codeVersion: queueItem.codeVersion,
      codeHash: queueItem.codeHash,
      storageToken,
      inputPath: queueItem.inputPath,
      upstreamRefs,
      previousAttempts: queueItem.previousAttempts,
      heartbeatIntervalMs: task.heartbeatIntervalMs,
    };
  }

  /**
   * Load upstream task outputs
   */
  private async loadUpstreamRefs(
    queueItem: PendingTask
  ): Promise<Record<string, any>> {
    if (!queueItem.pipelineRunId || !queueItem.upstreamRefs) {
      return {};
    }

    // upstreamRefs already contains the necessary info from queueing
    return queueItem.upstreamRefs;
  }

  /**
   * Claim temporary uploads referenced in task input
   * This prevents them from being auto-deleted
   */
  private async claimTempUploads(runId: string, inputPath: string): Promise<void> {
    try {
      // Get input data from storage
      const storage = this.orchestrator.getDefaultStorageBackend();
      const { createStorageProvider } = await import('@pipeweave/shared');
      const provider = createStorageProvider(storage);

      const inputData = await provider.download(inputPath);

      // Extract temp upload IDs from input
      const uploadIds = extractTempUploadIds(inputData);

      if (uploadIds.length > 0) {
        // Claim all uploads by setting claimed_by_run_id
        await this.db.none(
          `UPDATE temp_uploads
           SET claimed_by_run_id = $1
           WHERE id = ANY($2) AND claimed_by_run_id IS NULL`,
          [runId, uploadIds]
        );

        logger.info(`[executor] Claimed ${uploadIds.length} temp uploads for run ${runId}`);
      }
    } catch (error) {
      // Don't fail task execution if claiming fails
      logger.warn('[executor] Failed to claim temp uploads', {
        error,
        runId,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
