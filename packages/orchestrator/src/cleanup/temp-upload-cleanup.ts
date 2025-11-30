import type { Database } from '../db/index.js';
import type { IStorageProvider } from '@pipeweave/shared';
import type { Logger } from 'winston';

export interface TempUploadCleanupConfig {
  /** How often to run cleanup (milliseconds) */
  intervalMs?: number;
  /** Archive temp_uploads records older than this (days) */
  archiveAfterDays?: number;
}

interface TempUploadRecord {
  id: string;
  storage_path: string;
  storage_backend_id: string;
}

/**
 * Service that automatically cleans up expired temporary file uploads.
 *
 * - Deletes files from storage when they expire and haven't been claimed
 * - Archives old database records after 30 days
 * - Runs periodically in the background
 */
export class TempUploadCleanupService {
  private cleanupInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;
  private intervalMs: number;
  private archiveAfterDays: number;

  constructor(
    private db: Database,
    private getStorageBackend: (id: string) => IStorageProvider,
    private logger: Logger,
    config: TempUploadCleanupConfig = {}
  ) {
    this.intervalMs = config.intervalMs || 60 * 60 * 1000; // Default: 1 hour
    this.archiveAfterDays = config.archiveAfterDays || 30;
  }

  /**
   * Start the cleanup service.
   * Runs cleanup immediately, then on the configured interval.
   */
  start(): void {
    if (this.cleanupInterval) {
      this.logger.warn('[TempUploadCleanup] Service already running');
      return;
    }

    this.logger.info('[TempUploadCleanup] Starting cleanup service', {
      intervalMs: this.intervalMs,
      archiveAfterDays: this.archiveAfterDays,
    });

    // Run immediately on start
    this.cleanup().catch((error) => {
      this.logger.error('[TempUploadCleanup] Initial cleanup failed', { error });
    });

    // Then run periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanup().catch((error) => {
        this.logger.error('[TempUploadCleanup] Scheduled cleanup failed', { error });
      });
    }, this.intervalMs);
  }

  /**
   * Stop the cleanup service.
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      this.logger.info('[TempUploadCleanup] Cleanup service stopped');
    }
  }

  /**
   * Run cleanup manually (also called automatically by interval).
   */
  async cleanup(): Promise<void> {
    if (this.running) {
      this.logger.debug('[TempUploadCleanup] Cleanup already in progress, skipping');
      return;
    }

    this.running = true;

    try {
      const deletedCount = await this.cleanupExpiredUploads();
      const archivedCount = await this.archiveOldRecords();

      if (deletedCount > 0 || archivedCount > 0) {
        this.logger.info('[TempUploadCleanup] Cleanup completed', {
          deletedFiles: deletedCount,
          archivedRecords: archivedCount,
        });
      } else {
        this.logger.debug('[TempUploadCleanup] No cleanup needed');
      }
    } catch (error) {
      this.logger.error('[TempUploadCleanup] Cleanup failed', { error });
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * Delete expired uploads that haven't been claimed.
   */
  private async cleanupExpiredUploads(): Promise<number> {
    // Find expired uploads that need deletion
    const rows = await this.db.any<TempUploadRecord>(
      `SELECT id, storage_path, storage_backend_id
       FROM temp_uploads
       WHERE expires_at < NOW()
         AND claimed_by_run_id IS NULL
         AND deleted_at IS NULL
       ORDER BY expires_at ASC
       LIMIT 100` // Process in batches
    );

    if (rows.length === 0) {
      return 0;
    }

    this.logger.info(
      `[TempUploadCleanup] Found ${rows.length} expired uploads to delete`
    );

    let deletedCount = 0;

    for (const row of rows) {
      try {
        // Delete from storage
        const storage = this.getStorageBackend(row.storage_backend_id);
        await storage.delete(row.storage_path);

        // Mark as deleted in database
        await this.db.none(`UPDATE temp_uploads SET deleted_at = NOW() WHERE id = $1`, [row.id]);

        deletedCount++;

        this.logger.debug('[TempUploadCleanup] Deleted expired upload', {
          uploadId: row.id,
          storagePath: row.storage_path,
        });
      } catch (error) {
        this.logger.error('[TempUploadCleanup] Failed to delete upload', {
          uploadId: row.id,
          storagePath: row.storage_path,
          error,
        });
        // Continue with other uploads even if one fails
      }
    }

    return deletedCount;
  }

  /**
   * Archive old deleted records (remove from database).
   */
  private async archiveOldRecords(): Promise<number> {
    const result = await this.db.result(
      `DELETE FROM temp_uploads
       WHERE deleted_at < NOW() - INTERVAL '${this.archiveAfterDays} days'`
    );

    const archivedCount = result.rowCount;

    if (archivedCount > 0) {
      this.logger.info('[TempUploadCleanup] Archived old records', {
        count: archivedCount,
        olderThanDays: this.archiveAfterDays,
      });
    }

    return archivedCount;
  }

  /**
   * Get statistics about temporary uploads.
   */
  async getStats(): Promise<{
    total: number;
    expired: number;
    claimed: number;
    deleted: number;
  }> {
    const row = await this.db.one<{
      total: string;
      expired: string;
      claimed: string;
      deleted: string;
    }>(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE expires_at < NOW()) as expired,
        COUNT(*) FILTER (WHERE claimed_by_run_id IS NOT NULL) as claimed,
        COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted
       FROM temp_uploads`
    );

    return {
      total: parseInt(row.total, 10),
      expired: parseInt(row.expired, 10),
      claimed: parseInt(row.claimed, 10),
      deleted: parseInt(row.deleted, 10),
    };
  }
}
