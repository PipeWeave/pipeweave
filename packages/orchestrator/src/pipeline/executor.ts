import { customAlphabet } from 'nanoid';
import type { Database } from '../db/index.js';
import type { Orchestrator } from '../orchestrator.js';
import { QueueManager } from '../core/queue-manager.js';
import { PipelineValidator } from './validator.js';
import { PipelineGraph } from './graph.js';
import type { FailureMode, PipelineStatus } from '@pipeweave/shared';
import logger from '../logger.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 16);

// ============================================================================
// Types
// ============================================================================

export interface TriggerPipelineOptions {
  pipelineId: string;
  input: unknown;
  failureMode?: FailureMode;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface PipelineRunInfo {
  pipelineRunId: string;
  pipelineId: string;
  status: PipelineStatus;
  inputPath: string;
  entryTaskIds: string[];
  queuedTasks: string[];
}

export interface DownstreamTaskInfo {
  taskId: string;
  predecessors: string[];
  isReady: boolean;
}

// ============================================================================
// Pipeline Executor
// ============================================================================

export class PipelineExecutor {
  private validator: PipelineValidator;
  private queueManager: QueueManager;

  constructor(
    private db: Database,
    private orchestrator: Orchestrator,
    storageBasePath: string
  ) {
    this.validator = new PipelineValidator(db);
    this.queueManager = new QueueManager(db, storageBasePath);
  }

  /**
   * Trigger a pipeline run
   */
  async triggerPipeline(options: TriggerPipelineOptions): Promise<PipelineRunInfo> {
    const { pipelineId, input, failureMode = 'fail-fast', priority, metadata } = options;

    // Load pipeline definition
    const pipeline = await this.db.oneOrNone<{
      id: string;
      name: string;
      entry_tasks: string[];
      structure: Record<string, { allowedNext: string[] }>;
      version: string;
      failure_mode: FailureMode;
    }>('SELECT * FROM pipelines WHERE id = $1', [pipelineId]);

    if (!pipeline) {
      throw new Error(`Pipeline '${pipelineId}' not found`);
    }

    // Validate pipeline structure
    const validation = await this.validator.validatePipeline(pipeline.entry_tasks);
    if (!validation.valid) {
      throw new Error(`Pipeline validation failed: ${validation.errors.join(', ')}`);
    }

    const pipelineRunId = `prun_${nanoid()}`;
    const inputPath = `runs/${pipelineRunId}/input.json`;

    // TODO: Upload input to storage (for now, store in metadata)
    // const storageBackend = this.orchestrator.getDefaultStorageBackend();
    // await uploadToStorage(storageBackend, inputPath, input);

    // Use transaction to ensure atomicity
    const result = await this.db.tx(async (t) => {
      // Create pipeline run
      await t.none(
        `INSERT INTO pipeline_runs (
          id, pipeline_id, pipeline_version, structure_snapshot,
          status, input_path, failure_mode, created_at, metadata
        )
        VALUES ($1, $2, $3, $4, 'running', $5, $6, NOW(), $7)`,
        [
          pipelineRunId,
          pipelineId,
          pipeline.version,
          JSON.stringify(pipeline.structure),
          inputPath,
          failureMode ?? pipeline.failure_mode,
          metadata ? JSON.stringify(metadata) : '{}',
        ]
      );

      // Queue entry tasks
      const queuedTasks: string[] = [];
      for (const taskId of pipeline.entry_tasks) {
        const queued = await this.queueManager.enqueue({
          taskId,
          input,
          pipelineRunId,
          priority,
          metadata,
        });
        queuedTasks.push(queued.runId);
      }

      logger.info(
        `[pipeline] Pipeline triggered: ${pipelineId} (runId: ${pipelineRunId}, entry tasks: ${pipeline.entry_tasks.length})`
      );

      return {
        pipelineRunId,
        pipelineId,
        status: 'running' as PipelineStatus,
        inputPath,
        entryTaskIds: pipeline.entry_tasks,
        queuedTasks,
      };
    });

    return result;
  }

  /**
   * Queue downstream tasks after a task completes
   * This is called from the callback handler
   */
  async queueDownstreamTasks(
    completedTaskRunId: string,
    selectedNext?: string[]
  ): Promise<string[]> {
    // Get task run info
    const taskRun = await this.db.oneOrNone<{
      id: string;
      task_id: string;
      pipeline_run_id: string | null;
      output_path: string;
      output_size: number;
      assets: Record<string, any>;
      priority: number;
    }>(
      `SELECT id, task_id, pipeline_run_id, output_path, output_size, assets, priority
       FROM task_runs
       WHERE id = $1`,
      [completedTaskRunId]
    );

    if (!taskRun) {
      throw new Error(`Task run '${completedTaskRunId}' not found`);
    }

    // If not part of a pipeline, skip downstream queueing
    if (!taskRun.pipeline_run_id) {
      return [];
    }

    // Get task definition
    const task = await this.db.oneOrNone<{
      id: string;
      allowed_next: string[];
      priority: number;
    }>('SELECT id, allowed_next, priority FROM tasks WHERE id = $1', [taskRun.task_id]);

    if (!task) {
      throw new Error(`Task '${taskRun.task_id}' not found`);
    }

    // Determine which tasks to queue
    let nextTaskIds = task.allowed_next;
    if (selectedNext && selectedNext.length > 0) {
      // Validate programmatic selection
      const invalidSelections = selectedNext.filter((id) => !task.allowed_next.includes(id));
      if (invalidSelections.length > 0) {
        logger.warn(
          `[pipeline] Invalid programmatic next selection for task ${taskRun.task_id}: ` +
            `${invalidSelections.join(', ')} not in allowedNext`
        );
      }
      nextTaskIds = selectedNext.filter((id) => task.allowed_next.includes(id));
    }

    if (nextTaskIds.length === 0) {
      // End of pipeline branch
      await this.checkPipelineCompletion(taskRun.pipeline_run_id);
      return [];
    }

    // Use transaction for atomicity
    const queuedTaskRunIds = await this.db.tx(async (t) => {
      const queued: string[] = [];

      for (const nextTaskId of nextTaskIds) {
        // Check if this is a join task
        const isReady = await this.isJoinTaskReady(
          t,
          nextTaskId,
          taskRun.pipeline_run_id!
        );

        if (!isReady) {
          logger.info(
            `[pipeline] Join task ${nextTaskId} not ready yet (waiting for other predecessors)`
          );
          continue;
        }

        // Build upstream refs for the next task
        const upstreamRefs = await this.buildUpstreamRefs(
          t,
          nextTaskId,
          taskRun.pipeline_run_id!
        );

        // Queue the next task
        const queuedTask = await this.queueManager.enqueue({
          taskId: nextTaskId,
          input: {}, // Input comes from upstream refs
          pipelineRunId: taskRun.pipeline_run_id!,
          upstreamRefs,
          priority: taskRun.priority, // Inherit priority
        });

        queued.push(queuedTask.runId);
        logger.info(`[pipeline] Queued downstream task: ${nextTaskId} (runId: ${queuedTask.runId})`);
      }

      return queued;
    });

    return queuedTaskRunIds;
  }

  /**
   * Check if a join task is ready to run (all predecessors completed)
   */
  private async isJoinTaskReady(
    t: any,
    taskId: string,
    pipelineRunId: string
  ): Promise<boolean> {
    // Get all tasks in this pipeline that can lead to this task
    const pipelineRun = await (t.oneOrNone as any)(
      'SELECT structure_snapshot FROM pipeline_runs WHERE id = $1',
      [pipelineRunId]
    ) as { structure_snapshot: Record<string, { allowedNext: string[] }> } | null;

    if (!pipelineRun) {
      return false;
    }

    // Find all predecessors of this task
    const predecessors: string[] = [];
    for (const [predTaskId, predTaskValue] of Object.entries(pipelineRun.structure_snapshot)) {
      const predTask = predTaskValue as { allowedNext: string[] };
      if (predTask.allowedNext.includes(taskId)) {
        predecessors.push(predTaskId);
      }
    }

    // If no predecessors, it's ready (shouldn't happen in normal flow)
    if (predecessors.length === 0) {
      return true;
    }

    // If only one predecessor, it's ready (not a join)
    if (predecessors.length === 1) {
      return true;
    }

    // Check if all predecessors have completed task runs
    const completedCount = await (t.one as any)(
      `SELECT COUNT(*) as count
       FROM task_runs
       WHERE pipeline_run_id = $1
         AND task_id = ANY($2)
         AND status = 'completed'`,
      [pipelineRunId, predecessors]
    ) as { count: string | number };

    const count = typeof completedCount.count === 'string'
      ? parseInt(completedCount.count, 10)
      : completedCount.count;
    return count === predecessors.length;
  }

  /**
   * Build upstream refs for a task
   */
  private async buildUpstreamRefs(
    t: any,
    taskId: string,
    pipelineRunId: string
  ): Promise<Record<string, any>> {
    // Get all completed predecessors
    const pipelineRun = await (t.oneOrNone as any)(
      'SELECT structure_snapshot FROM pipeline_runs WHERE id = $1',
      [pipelineRunId]
    ) as { structure_snapshot: Record<string, { allowedNext: string[] }> } | null;

    if (!pipelineRun) {
      return {};
    }

    // Find all predecessors
    const predecessors: string[] = [];
    for (const [predTaskId, predTaskValue] of Object.entries(pipelineRun.structure_snapshot)) {
      const predTask = predTaskValue as { allowedNext: string[] };
      if (predTask.allowedNext.includes(taskId)) {
        predecessors.push(predTaskId);
      }
    }

    if (predecessors.length === 0) {
      return {};
    }

    // Get completed task runs for predecessors
    const upstreamRuns = await (t.manyOrNone as any)(
      `SELECT task_id, output_path, assets
       FROM task_runs
       WHERE pipeline_run_id = $1
         AND task_id = ANY($2)
         AND status = 'completed'
       ORDER BY completed_at DESC`,
      [pipelineRunId, predecessors]
    ) as Array<{
      task_id: string;
      output_path: string | null;
      assets: Record<string, any> | null;
    }>;

    const upstreamRefs: Record<string, any> = {};
    for (const run of upstreamRuns) {
      if (run.output_path) {
        upstreamRefs[run.task_id] = {
          outputPath: run.output_path,
          assets: run.assets ?? {},
        };
      }
    }

    return upstreamRefs;
  }

  /**
   * Check if pipeline is complete and update status
   */
  private async checkPipelineCompletion(pipelineRunId: string): Promise<void> {
    // Get pipeline run info
    const pipelineRun = await this.db.oneOrNone<{
      id: string;
      pipeline_id: string;
      status: PipelineStatus;
      structure_snapshot: Record<string, { allowedNext: string[] }>;
    }>('SELECT * FROM pipeline_runs WHERE id = $1', [pipelineRunId]);

    if (!pipelineRun || pipelineRun.status !== 'running') {
      return;
    }

    // Check if there are any pending/running tasks
    const pendingTasks = await this.db.oneOrNone<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM task_runs
       WHERE pipeline_run_id = $1
         AND status IN ('pending', 'running', 'waiting')`,
      [pipelineRunId]
    );

    if (parseInt(pendingTasks?.count ?? '0', 10) > 0) {
      // Pipeline still has active tasks
      return;
    }

    // Check if any tasks failed
    const failedTasks = await this.db.oneOrNone<{ count: string }>(
      `SELECT COUNT(*) as count
       FROM task_runs
       WHERE pipeline_run_id = $1
         AND status IN ('failed', 'timeout', 'cancelled')`,
      [pipelineRunId]
    );

    const hasFailures = parseInt(failedTasks?.count ?? '0', 10) > 0;

    // Update pipeline status
    await this.db.none(
      `UPDATE pipeline_runs
       SET status = $2, completed_at = NOW()
       WHERE id = $1`,
      [pipelineRunId, hasFailures ? 'failed' : 'completed']
    );

    logger.info(
      `[pipeline] Pipeline ${hasFailures ? 'failed' : 'completed'}: ${pipelineRunId}`
    );
  }

  /**
   * Handle task failure in pipeline context
   */
  async handleTaskFailure(taskRunId: string): Promise<void> {
    const taskRun = await this.db.oneOrNone<{
      pipeline_run_id: string | null;
    }>('SELECT pipeline_run_id FROM task_runs WHERE id = $1', [taskRunId]);

    if (!taskRun?.pipeline_run_id) {
      return;
    }

    // Get pipeline failure mode
    const pipelineRun = await this.db.oneOrNone<{
      failure_mode: FailureMode;
    }>('SELECT failure_mode FROM pipeline_runs WHERE id = $1', [taskRun.pipeline_run_id]);

    if (!pipelineRun) {
      return;
    }

    if (pipelineRun.failure_mode === 'fail-fast') {
      // Cancel all pending tasks in this pipeline
      await this.db.none(
        `UPDATE task_runs
         SET status = 'cancelled',
             error = 'Pipeline failed in fail-fast mode',
             completed_at = NOW()
         WHERE pipeline_run_id = $1
           AND status = 'pending'`,
        [taskRun.pipeline_run_id]
      );

      // Mark pipeline as failed
      await this.db.none(
        `UPDATE pipeline_runs
         SET status = 'failed', completed_at = NOW()
         WHERE id = $1`,
        [taskRun.pipeline_run_id]
      );

      logger.info(`[pipeline] Pipeline failed (fail-fast): ${taskRun.pipeline_run_id}`);
    } else {
      // Continue or partial-merge mode - just check for completion
      await this.checkPipelineCompletion(taskRun.pipeline_run_id);
    }
  }

  /**
   * Get pipeline run details
   */
  async getPipelineRun(pipelineRunId: string) {
    return await this.db.oneOrNone(
      'SELECT * FROM pipeline_runs WHERE id = $1',
      [pipelineRunId]
    );
  }

  /**
   * List pipeline runs
   */
  async listPipelineRuns(
    pipelineId?: string,
    limit: number = 100,
    offset: number = 0
  ) {
    if (pipelineId) {
      return await this.db.manyOrNone(
        `SELECT * FROM pipeline_runs
         WHERE pipeline_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [pipelineId, limit, offset]
      );
    } else {
      return await this.db.manyOrNone(
        `SELECT * FROM pipeline_runs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
    }
  }

  /**
   * List pipelines
   */
  async listPipelines() {
    return await this.db.manyOrNone('SELECT * FROM pipelines ORDER BY name ASC');
  }

  /**
   * Get pipeline details
   */
  async getPipeline(pipelineId: string) {
    return await this.db.oneOrNone('SELECT * FROM pipelines WHERE id = $1', [pipelineId]);
  }

  /**
   * Create or update a pipeline
   */
  async upsertPipeline(
    pipelineId: string,
    name: string,
    entryTaskIds: string[],
    description?: string,
    failureMode: FailureMode = 'fail-fast',
    version: string = '1.0.0'
  ) {
    // Validate pipeline
    const validation = await this.validator.validatePipelineDefinition(
      pipelineId,
      name,
      entryTaskIds
    );

    if (!validation.valid) {
      throw new Error(`Pipeline validation failed: ${validation.errors.join(', ')}`);
    }

    // Build structure snapshot
    const structure: Record<string, { allowedNext: string[] }> = {};
    for (const [taskId, task] of validation.graph.entries()) {
      structure[taskId] = {
        allowedNext: task.allowedNext,
      };
    }

    // Upsert pipeline
    await this.db.none(
      `INSERT INTO pipelines (id, name, description, entry_tasks, structure, version, failure_mode, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         name = EXCLUDED.name,
         description = EXCLUDED.description,
         entry_tasks = EXCLUDED.entry_tasks,
         structure = EXCLUDED.structure,
         version = EXCLUDED.version,
         failure_mode = EXCLUDED.failure_mode,
         updated_at = NOW()`,
      [
        pipelineId,
        name,
        description ?? null,
        entryTaskIds,
        JSON.stringify(structure),
        version,
        failureMode,
      ]
    );

    logger.info(`[pipeline] Pipeline upserted: ${pipelineId} (${name})`);

    return {
      pipelineId,
      name,
      entryTaskIds,
      validation,
    };
  }

  /**
   * Perform dry-run validation
   */
  async dryRun(pipelineId: string) {
    const pipeline = await this.getPipeline(pipelineId);
    if (!pipeline) {
      throw new Error(`Pipeline '${pipelineId}' not found`);
    }

    const validation = await this.validator.validatePipeline(pipeline.entry_tasks);

    if (!validation.valid) {
      return {
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
        executionPlan: [],
      };
    }

    // Generate execution plan
    const graph = new PipelineGraph(validation.graph);
    const plan = graph.topologicalSort(validation.entryTasks);

    return {
      valid: true,
      errors: [],
      warnings: validation.warnings,
      executionPlan: plan.levels.map((level) => ({
        step: level.level,
        tasks: level.tasks,
        type: level.type,
        waitsFor: level.waitsFor,
      })),
    };
  }
}
