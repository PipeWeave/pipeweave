import crypto from 'crypto';
import type { Database } from '../db/index.js';
import type {
  RegisterServiceRequest,
  RegisterServiceResponse,
} from '@pipeweave/shared';
import logger from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export interface RegisteredService {
  id: string;
  version: string;
  baseUrl: string;
  registeredAt: Date;
  lastHeartbeat: Date | null;
  status: 'active' | 'inactive' | 'disconnected';
}

export interface RegisteredTask {
  id: string;
  serviceId: string;
  codeHash: string;
  codeVersion: number;
  allowedNext: string[];
  timeout: number;
  retries: number;
  retryBackoff: 'fixed' | 'exponential';
  retryDelayMs: number;
  maxRetryDelayMs: number;
  heartbeatIntervalMs: number;
  concurrency: number;
  priority: number;
  idempotencyTTL?: number;
  description?: string;
  registeredAt: Date;
  updatedAt: Date;
}

export interface CodeChange {
  taskId: string;
  oldHash: string;
  newHash: string;
  oldVersion: number;
  newVersion: number;
}

// ============================================================================
// Service Registry
// ============================================================================

export class ServiceRegistry {
  constructor(private db: Database) {}

  /**
   * Register or update a service and its tasks
   */
  async registerService(
    request: RegisterServiceRequest
  ): Promise<RegisterServiceResponse> {
    const { serviceId, version, baseUrl, tasks } = request;

    const codeChanges: CodeChange[] = [];
    const orphanedTasks: string[] = [];

    try {
      // Get existing service
      const existingService = await this.db.oneOrNone<{
        version: string;
      }>(
        'SELECT version FROM services WHERE id = $1',
        [serviceId]
      );

      const versionChanged = existingService && existingService.version !== version;

      // Upsert service
      await this.db.none(
        `INSERT INTO services (id, version, base_url, registered_at, last_heartbeat, status)
         VALUES ($1, $2, $3, NOW(), NOW(), 'active')
         ON CONFLICT (id)
         DO UPDATE SET
           version = EXCLUDED.version,
           base_url = EXCLUDED.base_url,
           last_heartbeat = NOW(),
           status = 'active'`,
        [serviceId, version, baseUrl]
      );

      // If version changed, find orphaned tasks
      if (versionChanged) {
        const newTaskIds = tasks.map((t) => t.id);
        const existingTasks = await this.db.manyOrNone<{ id: string }>(
          'SELECT id FROM tasks WHERE service_id = $1',
          [serviceId]
        );

        for (const existing of existingTasks) {
          if (!newTaskIds.includes(existing.id)) {
            orphanedTasks.push(existing.id);

            // Cancel pending task runs for this orphaned task
            await this.db.none(
              `UPDATE task_runs
               SET status = 'cancelled',
                   error = $1,
                   completed_at = NOW()
               WHERE task_id = $2
                 AND status = 'pending'`,
              [`Task type removed in version ${version}`, existing.id]
            );
          }
        }

        if (orphanedTasks.length > 0) {
          logger.info(`[registry] Orphaned ${orphanedTasks.length} tasks for service ${serviceId} v${version}`);
        }
      }

      // Upsert each task
      for (const task of tasks) {
        const codeHash = this.calculateCodeHash(JSON.stringify(task));

        // Get existing task
        const existingTask = await this.db.oneOrNone<{
          code_hash: string;
          code_version: number;
        }>(
          'SELECT code_hash, code_version FROM tasks WHERE id = $1',
          [task.id]
        );

        const hashChanged = existingTask && existingTask.code_hash !== codeHash;
        const newVersion = hashChanged
          ? existingTask.code_version + 1
          : existingTask?.code_version ?? 1;

        // Upsert task
        await this.db.none(
          `INSERT INTO tasks (
             id, service_id, code_hash, code_version,
             allowed_next, timeout_seconds, retries, retry_backoff,
             retry_delay_ms, max_retry_delay_ms, heartbeat_interval_ms,
             concurrency, priority, idempotency_ttl_seconds, description,
             registered_at, updated_at
           )
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()
           )
           ON CONFLICT (id)
           DO UPDATE SET
             service_id = EXCLUDED.service_id,
             code_hash = EXCLUDED.code_hash,
             code_version = EXCLUDED.code_version,
             allowed_next = EXCLUDED.allowed_next,
             timeout_seconds = EXCLUDED.timeout_seconds,
             retries = EXCLUDED.retries,
             retry_backoff = EXCLUDED.retry_backoff,
             retry_delay_ms = EXCLUDED.retry_delay_ms,
             max_retry_delay_ms = EXCLUDED.max_retry_delay_ms,
             heartbeat_interval_ms = EXCLUDED.heartbeat_interval_ms,
             concurrency = EXCLUDED.concurrency,
             priority = EXCLUDED.priority,
             idempotency_ttl_seconds = EXCLUDED.idempotency_ttl_seconds,
             description = EXCLUDED.description,
             updated_at = NOW()`,
          [
            task.id,
            serviceId,
            codeHash,
            newVersion,
            task.allowedNext ?? [],
            task.timeout ?? 300,
            task.retries ?? 3,
            task.retryBackoff ?? 'exponential',
            task.retryDelayMs ?? 1000,
            task.maxRetryDelayMs ?? 86400000,
            task.heartbeatIntervalMs ?? 60000,
            task.concurrency ?? 0,
            task.priority ?? 100,
            task.idempotencyTTL,
            task.description,
          ]
        );

        // Record code history if changed
        if (hashChanged) {
          await this.db.none(
            `INSERT INTO task_code_history (task_id, code_version, code_hash, service_version, recorded_at)
             SELECT $1, $2, $3, $4, NOW()
             WHERE NOT EXISTS (
               SELECT 1 FROM task_code_history
               WHERE task_id = $1 AND code_hash = $3
             )`,
            [task.id, newVersion, codeHash, version]
          );

          codeChanges.push({
            taskId: task.id,
            oldHash: existingTask!.code_hash,
            newHash: codeHash,
            oldVersion: existingTask!.code_version,
            newVersion,
          });
        }
      }

      if (codeChanges.length > 0) {
        logger.info(
          `[registry] Service ${serviceId} v${version} registered with ${codeChanges.length} code changes`
        );
      } else {
        logger.info(
          `[registry] Service ${serviceId} v${version} registered (no code changes)`
        );
      }

      return {
        success: true,
        codeChanges: codeChanges.map((c) => ({
          taskId: c.taskId,
          oldHash: c.oldHash,
          newHash: c.newHash,
          oldVersion: c.oldVersion,
          newVersion: c.newVersion,
        })),
        orphanedTasks: orphanedTasks.length > 0 ? orphanedTasks : undefined,
      };
    } catch (error) {
      logger.error('[registry] Service registration failed', { error, serviceId, version });
      throw error;
    }
  }

  /**
   * Get service by ID
   */
  async getService(serviceId: string): Promise<RegisteredService | null> {
    return await this.db.oneOrNone<RegisteredService>(
      'SELECT * FROM services WHERE id = $1',
      [serviceId]
    );
  }

  /**
   * List all services
   */
  async listServices(): Promise<RegisteredService[]> {
    return await this.db.manyOrNone<RegisteredService>(
      'SELECT * FROM services ORDER BY registered_at DESC'
    );
  }

  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<RegisteredTask | null> {
    const task = await this.db.oneOrNone<any>(
      'SELECT * FROM tasks WHERE id = $1',
      [taskId]
    );

    if (!task) {
      return null;
    }

    return {
      id: task.id,
      serviceId: task.service_id,
      codeHash: task.code_hash,
      codeVersion: task.code_version,
      allowedNext: task.allowed_next ?? [],
      timeout: task.timeout_seconds,
      retries: task.retries,
      retryBackoff: task.retry_backoff,
      retryDelayMs: task.retry_delay_ms,
      maxRetryDelayMs: task.max_retry_delay_ms,
      heartbeatIntervalMs: task.heartbeat_interval_ms,
      concurrency: task.concurrency,
      priority: task.priority,
      idempotencyTTL: task.idempotency_ttl_seconds,
      description: task.description,
      registeredAt: task.registered_at,
      updatedAt: task.updated_at,
    };
  }

  /**
   * List tasks for a service
   */
  async listTasksForService(serviceId: string): Promise<RegisteredTask[]> {
    const tasks = await this.db.manyOrNone<any>(
      'SELECT * FROM tasks WHERE service_id = $1 ORDER BY id',
      [serviceId]
    );

    return tasks.map((task) => ({
      id: task.id,
      serviceId: task.service_id,
      codeHash: task.code_hash,
      codeVersion: task.code_version,
      allowedNext: task.allowed_next ?? [],
      timeout: task.timeout_seconds,
      retries: task.retries,
      retryBackoff: task.retry_backoff,
      retryDelayMs: task.retry_delay_ms,
      maxRetryDelayMs: task.max_retry_delay_ms,
      heartbeatIntervalMs: task.heartbeat_interval_ms,
      concurrency: task.concurrency,
      priority: task.priority,
      idempotencyTTL: task.idempotency_ttl_seconds,
      description: task.description,
      registeredAt: task.registered_at,
      updatedAt: task.updated_at,
    }));
  }

  /**
   * Get task code history
   */
  async getTaskCodeHistory(taskId: string): Promise<Array<{
    codeVersion: number;
    codeHash: string;
    serviceVersion: string;
    recordedAt: Date;
  }>> {
    return await this.db.manyOrNone(
      `SELECT code_version, code_hash, service_version, recorded_at
       FROM task_code_history
       WHERE task_id = $1
       ORDER BY code_version DESC`,
      [taskId]
    );
  }

  /**
   * Calculate SHA-256 hash (16 chars)
   */
  private calculateCodeHash(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content)
      .digest('hex')
      .substring(0, 16);
  }
}
