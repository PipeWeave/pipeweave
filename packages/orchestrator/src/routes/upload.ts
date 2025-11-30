import type { Application } from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import type { OrchestratorRequest } from '../types/internal.js';
import logger from '../logger.js';

// ============================================================================
// Multer Configuration
// ============================================================================

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max
    files: 1, // Only one file per request
  },
});

// ============================================================================
// Upload Routes
// ============================================================================

export function registerUploadRoutes(app: Application): void {
  /**
   * POST /api/upload/temp
   * Upload a file to temporary storage.
   *
   * Returns upload ID that can be used in task input.
   * Files expire after 24 hours if not claimed by a task run.
   */
  app.post('/api/upload/temp', upload.single('file'), async (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;

      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      const uploadId = `tmp_${nanoid()}`;
      const filename = req.file.originalname || `upload-${Date.now()}`;
      const storagePath = `temp-uploads/${uploadId}/${filename}`;

      // Upload to default storage backend
      const storage = (orchestrator as any).defaultStorageBackend;

      await storage.putObject(storagePath, req.file.buffer, req.file.mimetype);

      // Record in temp_uploads table
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await orchestrator.getDatabase().none(
        `INSERT INTO temp_uploads
         (id, storage_path, storage_backend_id, uploaded_at, expires_at,
          original_filename, mime_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8)`,
        [
          uploadId,
          storagePath,
          storage.id,
          expiresAt,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          req.headers['x-user-id'] || req.ip || 'anonymous',
        ]
      );

      logger.info('[Upload] Temp file uploaded', {
        uploadId,
        filename: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
      });

      return res.json({
        uploadId,
        storagePath,
        filename: req.file.originalname,
        size: req.file.size,
        mimeType: req.file.mimetype,
        expiresAt: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('[Upload] Upload failed', { error });
      return res.status(500).json({
        error: 'Upload failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/upload/temp/:id
   * Get information about a temporary upload.
   */
  app.get('/api/upload/temp/:id', async (req, res) => {
    try {
      const orchestrator = (req as unknown as OrchestratorRequest).orchestrator;
      const { id } = req.params;

      const upload = await orchestrator.getDatabase().oneOrNone(
        `SELECT id, storage_path, storage_backend_id, uploaded_at, expires_at,
                claimed_by_run_id, deleted_at, original_filename, mime_type, size_bytes
         FROM temp_uploads
         WHERE id = $1`,
        [id]
      );

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      return res.json({
        uploadId: upload.id,
        storagePath: upload.storage_path,
        storageBackendId: upload.storage_backend_id,
        uploadedAt: upload.uploaded_at,
        expiresAt: upload.expires_at,
        claimedByRunId: upload.claimed_by_run_id,
        deletedAt: upload.deleted_at,
        filename: upload.original_filename,
        mimeType: upload.mime_type,
        size: upload.size_bytes,
        expired: new Date(upload.expires_at) < new Date(),
        claimed: !!upload.claimed_by_run_id,
        deleted: !!upload.deleted_at,
      });
    } catch (error) {
      logger.error('[Upload] Failed to get upload info', { error, uploadId: req.params.id });
      return res.status(500).json({
        error: 'Failed to get upload info',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * DELETE /api/upload/temp/:id
   * Manually delete a temporary upload before it expires.
   */
  app.delete('/api/upload/temp/:id', async (req, res) => {
    try {
      const orchestrator = (req as unknown as OrchestratorRequest).orchestrator;
      const { id } = req.params;

      // Get upload info
      const upload = await orchestrator.getDatabase().oneOrNone(
        `SELECT storage_path, storage_backend_id, deleted_at, claimed_by_run_id
         FROM temp_uploads
         WHERE id = $1`,
        [id]
      );

      if (!upload) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      if (upload.deleted_at) {
        return res.status(410).json({ error: 'Upload already deleted' });
      }

      if (upload.claimed_by_run_id) {
        return res.status(409).json({
          error: 'Upload already claimed by task run',
          claimedByRunId: upload.claimed_by_run_id,
        });
      }

      // Delete from storage
      const { createStorageProvider } = await import('@pipeweave/shared');
      const storageBackend = orchestrator.getStorageBackend(upload.storage_backend_id);
      const storage = createStorageProvider(storageBackend);
      await storage.delete(upload.storage_path);

      // Mark as deleted
      await orchestrator.getDatabase().none(`UPDATE temp_uploads SET deleted_at = NOW() WHERE id = $1`, [
        id,
      ]);

      logger.info('[Upload] Temp file deleted manually', { uploadId: id });

      return res.json({ success: true, uploadId: id });
    } catch (error) {
      logger.error('[Upload] Failed to delete upload', { error, uploadId: req.params.id });
      return res.status(500).json({
        error: 'Failed to delete upload',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  /**
   * GET /api/upload/stats
   * Get statistics about temporary uploads.
   */
  app.get('/api/upload/stats', async (req, res) => {
    try {
      const orchestrator = (req as OrchestratorRequest).orchestrator;

      const row = await orchestrator.getDatabase().one<{
        total: string;
        expired: string;
        claimed: string;
        deleted: string;
      }>(
        `SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE expires_at < NOW() AND deleted_at IS NULL) as expired,
          COUNT(*) FILTER (WHERE claimed_by_run_id IS NOT NULL) as claimed,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
         FROM temp_uploads`
      );

      return res.json({
        total: parseInt(row.total, 10),
        expired: parseInt(row.expired, 10),
        claimed: parseInt(row.claimed, 10),
        deleted: parseInt(row.deleted, 10),
      });
    } catch (error) {
      logger.error('[Upload] Failed to get upload stats', { error });
      return res.status(500).json({
        error: 'Failed to get upload stats',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
