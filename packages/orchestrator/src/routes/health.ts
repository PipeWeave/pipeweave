import type { Application } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';

// ============================================================================
// Health & Info Routes
// ============================================================================

export function registerHealthRoutes(app: Application): void {
  /**
   * GET /health
   * Health check + maintenance status
   */
  app.get('/health', async (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;
      const db = orchestrator.getDatabase();

      // Test database connection
      const isConnected = await db.one('SELECT 1 as connected');

      // Get maintenance status
      const maintenanceStatus = await orchestrator.getMaintenanceStatus();

      res.json({
        status: 'ok',
        database: isConnected ? 'connected' : 'disconnected',
        maintenance: maintenanceStatus,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/info
   * Orchestrator information
   */
  app.get('/api/info', async (req, res) => {
    const orchestrator = (req as OrchestratorRequest).orchestrator;
    const config = (orchestrator as any).config;

    res.json({
      version: process.env.npm_package_version || '0.1.0',
      mode: config.mode,
      maxConcurrency: config.maxConcurrency,
      pollIntervalMs: config.pollIntervalMs,
      storageBackends: orchestrator.listStorageBackendIds(),
      defaultStorageBackend: (orchestrator as any).defaultStorageBackend.id,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });
}
