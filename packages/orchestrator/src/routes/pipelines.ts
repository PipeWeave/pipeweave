import type { Application, Request, Response } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';
import { PipelineExecutor } from '../pipeline/executor.js';
import {
  TriggerPipelineRequestSchema,
  DryRunRequestSchema,
  validateInput,
  type TaskInputSchema,
  type ValidationError,
} from '@pipeweave/shared';
import logger from '../logger.js';

// ============================================================================
// Pipeline Management Routes
// ============================================================================

export function registerPipelineRoutes(app: Application): void {
  /**
   * GET /api/pipelines
   * List all pipelines
   */
  app.get('/api/pipelines', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();
      const executor = new PipelineExecutor(db, orchestrator, 'storage');

      const pipelines = await executor.listPipelines();

      return res.json({ pipelines });
    } catch (error) {
      logger.error('[pipelines] Failed to list pipelines', { error });
      return res.status(500).json({
        error: 'Failed to list pipelines',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/pipelines/:id
   * Get pipeline details
   */
  app.get('/api/pipelines/:id', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Pipeline ID is required' });
      }
      const orchestrator = orchestratorReq.orchestrator;
      const db = orchestrator.getDatabase();
      const executor = new PipelineExecutor(db, orchestrator, 'storage');

      const pipeline = await executor.getPipeline(id);

      if (!pipeline) {
        return res.status(404).json({
          error: 'Pipeline not found',
          pipelineId: id,
        });
      }

      return res.json({ pipeline });
    } catch (error) {
      logger.error('[pipelines] Failed to get pipeline', { error });
      return res.status(500).json({
        error: 'Failed to get pipeline',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/pipelines/:id/trigger
   * Trigger a pipeline
   */
  app.post('/api/pipelines/:id/trigger', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Pipeline ID is required' });
      }
      const orchestrator = orchestratorReq.orchestrator;

      // Check maintenance mode
      const canAccept = await orchestrator.canAcceptTasks();
      if (!canAccept) {
        return res.status(503).json({
          error: 'Orchestrator is in maintenance mode',
        });
      }

      // Validate request body
      const parseResult = TriggerPipelineRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.format(),
        });
      }

      const { input, failureMode, priority, metadata } = parseResult.data;

      const db = orchestrator.getDatabase();

      // Get validation mode from request (default: 'warn')
      const validationMode = (req.body.validationMode as 'strict' | 'warn' | 'none') || 'warn';

      // Validate input against entry task schemas
      const validationErrors: Record<string, ValidationError[]> = {};

      if (validationMode !== 'none') {
        // Get pipeline to find entry tasks
        const pipeline = await db.oneOrNone<{ entry_tasks: string[] }>(
          'SELECT entry_tasks FROM pipelines WHERE id = $1',
          [id]
        );

        if (pipeline && pipeline.entry_tasks.length > 0) {
          // Validate against each entry task schema
          for (const taskId of pipeline.entry_tasks) {
            const task = await db.oneOrNone<{ input_schema: TaskInputSchema | null }>(
              'SELECT input_schema FROM tasks WHERE id = $1',
              [taskId]
            );

            if (task?.input_schema) {
              const result = validateInput(input, task.input_schema);
              if (!result.valid) {
                validationErrors[taskId] = result.errors;
              }
            }
          }
        }
      }

      // Strict mode: fail on validation errors
      if (validationMode === 'strict' && Object.keys(validationErrors).length > 0) {
        return res.status(400).json({
          error: 'Input validation failed',
          validationErrors,
        });
      }

      // Warn mode: log warnings but continue
      if (validationMode === 'warn' && Object.keys(validationErrors).length > 0) {
        logger.warn('[pipelines] Input validation warnings', {
          pipelineId: id,
          validationErrors,
        });
      }

      const executor = new PipelineExecutor(db, orchestrator, 'storage');

      const result = await executor.triggerPipeline({
        pipelineId: id,
        input,
        failureMode,
        priority,
        metadata,
      });

      return res.json({
        pipelineRunId: result.pipelineRunId,
        status: result.status,
        inputPath: result.inputPath,
        entryTasks: result.entryTaskIds,
        queuedTasks: result.queuedTasks,
        validationWarnings:
          validationMode === 'warn' && Object.keys(validationErrors).length > 0
            ? validationErrors
            : undefined,
      });
    } catch (error) {
      logger.error('[pipelines] Failed to trigger pipeline', { error });
      return res.status(500).json({
        error: 'Failed to trigger pipeline',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/pipelines/:id/dry-run
   * Validate pipeline without executing
   */
  app.post('/api/pipelines/:id/dry-run', async (req: Request, res: Response) => {
    const orchestratorReq = req as OrchestratorRequest;
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json({ error: 'Pipeline ID is required' });
      }
      const orchestrator = orchestratorReq.orchestrator;

      // Validate request body
      const parseResult = DryRunRequestSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: 'Invalid request',
          details: parseResult.error.format(),
        });
      }

      const db = orchestrator.getDatabase();
      const executor = new PipelineExecutor(db, orchestrator, 'storage');

      const result = await executor.dryRun(id);

      return res.json(result);
    } catch (error) {
      logger.error('[pipelines] Failed to validate pipeline', { error });
      return res.status(500).json({
        error: 'Failed to validate pipeline',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
