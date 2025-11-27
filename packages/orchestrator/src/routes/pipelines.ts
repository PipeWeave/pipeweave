import type { Application, Request, Response } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';
import { PipelineExecutor } from '../pipeline/executor.js';
import { TriggerPipelineRequestSchema, DryRunRequestSchema } from '@pipeweave/shared';
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
