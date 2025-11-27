import type { Express } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';

// ============================================================================
// Queue Management Routes
// ============================================================================

export function registerQueueRoutes(app: Express): void {
  /**
   * POST /api/queue/task
   * Queue a standalone task
   */
  app.post('/api/queue/task', async (req, res) => {
    try {
      // TODO: Implement task queueing
      res.status(501).json({ error: 'Not implemented yet' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to queue task',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/queue/batch
   * Queue multiple tasks
   */
  app.post('/api/queue/batch', async (req, res) => {
    try {
      // TODO: Implement batch queueing
      res.status(501).json({ error: 'Not implemented yet' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to queue batch',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/queue/status
   * Get queue statistics
   */
  app.get('/api/queue/status', async (req, res) => {
    try {
      // TODO: Implement queue status
      res.status(501).json({ error: 'Not implemented yet' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get queue status',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/queue/items
   * List queue items (with filters)
   */
  app.get('/api/queue/items', async (req, res) => {
    try {
      // TODO: Implement queue items listing
      res.status(501).json({ error: 'Not implemented yet' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list queue items',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * POST /api/tick
   * Process pending tasks (serverless mode trigger)
   *
   * This endpoint is called by external schedulers (Cloud Scheduler, cron, etc.)
   * to trigger task processing in serverless mode.
   */
  app.post('/api/tick', async (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;

      // Get poller instance
      const poller = orchestrator.getPoller();
      if (!poller) {
        return res.status(503).json({
          error: 'Poller not available',
          processed: 0,
        });
      }

      // Trigger manual poll
      const processed = await poller.manualPoll();

      return res.json({
        status: 'ok',
        processed,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to process tick',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
