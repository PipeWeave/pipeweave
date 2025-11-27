import type { Application } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';

// ============================================================================
// Run Query Routes
// ============================================================================

export function registerRunRoutes(app: Application): void {
  /**
   * GET /api/runs
   * List pipeline runs (paginated, filtered)
   */
  app.get('/api/runs', async (req, res) => {
    try {
      // TODO: Implement run listing
      res.status(501).json({ error: 'Not implemented yet' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list runs',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/runs/:id
   * Get pipeline run details
   */
  app.get('/api/runs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      // TODO: Implement run details
      res.status(501).json({ error: 'Not implemented yet', runId: id });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get run',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/task-runs/:id
   * Get task run details
   */
  app.get('/api/task-runs/:id', async (req, res) => {
    try {
      const { id } = req.params;
      // TODO: Implement task run details
      res.status(501).json({ error: 'Not implemented yet', taskRunId: id });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to get task run',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
