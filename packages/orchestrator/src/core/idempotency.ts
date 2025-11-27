import type { Database } from '../db/index.js';

// ============================================================================
// Types
// ============================================================================

export interface CachedResult {
  taskRunId: string;
  outputPath: string;
  outputSize?: number;
  assets?: Record<string, any>;
}

// ============================================================================
// Idempotency Manager
// ============================================================================

export class IdempotencyManager {
  constructor(private db: Database) {}

  /**
   * Check if an idempotency key has a cached result
   */
  async checkIdempotency(
    idempotencyKey: string
  ): Promise<CachedResult | null> {
    const cached = await this.db.oneOrNone<{
      task_run_id: string;
      output_path: string;
      output_size: number | null;
      assets: any;
    }>(
      `SELECT task_run_id, output_path, output_size, assets
       FROM idempotency_cache
       WHERE idempotency_key = $1
         AND expires_at > NOW()`,
      [idempotencyKey]
    );

    if (!cached) {
      return null;
    }

    return {
      taskRunId: cached.task_run_id,
      outputPath: cached.output_path,
      outputSize: cached.output_size ?? undefined,
      assets: cached.assets ?? undefined,
    };
  }

  /**
   * Store a result in the idempotency cache
   */
  async cacheResult(
    idempotencyKey: string,
    taskId: string,
    taskRunId: string,
    codeVersion: number,
    outputPath: string,
    ttlSeconds: number,
    outputSize?: number,
    assets?: Record<string, any>
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.db.none(
      `INSERT INTO idempotency_cache (
         idempotency_key, task_id, task_run_id, code_version,
         output_path, output_size, assets, cached_at, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       ON CONFLICT (idempotency_key)
       DO UPDATE SET
         task_run_id = EXCLUDED.task_run_id,
         output_path = EXCLUDED.output_path,
         output_size = EXCLUDED.output_size,
         assets = EXCLUDED.assets,
         cached_at = NOW(),
         expires_at = EXCLUDED.expires_at`,
      [
        idempotencyKey,
        taskId,
        taskRunId,
        codeVersion,
        outputPath,
        outputSize ?? null,
        assets ? JSON.stringify(assets) : null,
        expiresAt,
      ]
    );
  }

  /**
   * Clean up expired cache entries
   */
  async cleanupExpired(): Promise<number> {
    const result = await this.db.result(
      'DELETE FROM idempotency_cache WHERE expires_at < NOW()'
    );
    return result.rowCount;
  }
}
