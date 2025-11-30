import type { Express } from 'express';
import type { Orchestrator } from '../orchestrator.js';
import { registerHealthRoutes } from './health.js';
import { registerServiceRoutes } from './services.js';
import { registerPipelineRoutes } from './pipelines.js';
import { registerQueueRoutes } from './queue.js';
import { registerTaskRoutes } from './tasks.js';
import { registerRunRoutes } from './runs.js';
import { registerDLQRoutes } from './dlq.js';
import { registerStorageRoutes } from './storage.js';
import { registerUploadRoutes } from './upload.js';
import logger from '../logger.js';

// ============================================================================
// Route Registration
// ============================================================================

export function registerRoutes(app: Express, orchestrator: Orchestrator): void {
  // Attach orchestrator to all requests
  app.use((req, _res, next) => {
    (req as any).orchestrator = orchestrator;
    next();
  });

  // Register all route modules
  registerHealthRoutes(app);
  registerServiceRoutes(app);
  registerPipelineRoutes(app);
  registerQueueRoutes(app);
  registerTaskRoutes(app);
  registerRunRoutes(app);
  registerDLQRoutes(app);
  registerStorageRoutes(app);
  registerUploadRoutes(app);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Error handler
  app.use((err: Error, _req: any, res: any, _next: any) => {
    logger.error('[routes] Request error', { error: err });
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });
}
