import type { Application } from 'express';
import type { OrchestratorRequest } from '../types/internal.js';
import { createStorageProvider } from '@pipeweave/shared';

// ============================================================================
// Storage Routes
// ============================================================================

export function registerStorageRoutes(app: Application): void {
  /**
   * GET /api/storage/backends
   * List all configured storage backends
   */
  app.get('/api/storage/backends', (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;
      const backendIds = orchestrator.listStorageBackendIds();
      const defaultBackend = (orchestrator as any).defaultStorageBackend;

      const backends = backendIds.map((id) => {
        const backend = orchestrator.getStorageBackend(id);
        return {
          id: backend.id,
          provider: backend.provider,
          endpoint: backend.endpoint,
          bucket: backend.bucket,
          region: backend.region,
          isDefault: backend.id === defaultBackend.id,
        };
      });

      res.json({
        backends,
        default: defaultBackend.id,
      });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to list storage backends',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/storage/*
   * Retrieve content from storage (proxy)
   *
   * Example: GET /api/storage/runs/prun_xxx/outputs/trun_yyy.json
   */
  app.get('/api/storage/*', async (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;
      const path = (req as any).params[0];

      if (!path) {
        return res.status(400).json({ error: 'Missing storage path' });
      }

      // Use default storage backend
      const backend = orchestrator.getDefaultStorageBackend();
      const storageProvider = createStorageProvider(backend);

      // Fetch content
      const content = await storageProvider.download(path);

      // Try to parse as JSON if possible
      let parsed: any;
      try {
        parsed = JSON.parse(content.toString('utf8'));
      } catch {
        // Not JSON, return as text
        return res.type('text/plain').send(content.toString('utf8'));
      }

      return res.json({
        path,
        content: parsed,
      });
    } catch (error) {
      if ((error as any).code === 'NoSuchKey' || (error as any).code === 'NotFound') {
        return res.status(404).json({
          error: 'File not found',
          path: (req as any).params[0],
        });
      }

      return res.status(500).json({
        error: 'Failed to retrieve storage content',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
