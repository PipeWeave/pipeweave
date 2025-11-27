import type { Database } from '../db/index.js';
import logger from '../logger.js';

// ============================================================================
// Types
// ============================================================================

interface HeartbeatTracker {
  runId: string;
  taskId: string;
  startedAt: Date;
  lastHeartbeat: Date;
  timeoutMs: number;
  timeoutHandle: NodeJS.Timeout;
}

// ============================================================================
// Heartbeat Monitor
// ============================================================================

export class HeartbeatMonitor {
  private trackers: Map<string, HeartbeatTracker> = new Map();

  constructor(private db: Database) {}

  /**
   * Start tracking heartbeats for a task
   */
  startTracking(runId: string, taskId: string, heartbeatIntervalMs: number): void {
    // Timeout is 2x the heartbeat interval
    const timeoutMs = heartbeatIntervalMs * 2;

    const tracker: HeartbeatTracker = {
      runId,
      taskId,
      startedAt: new Date(),
      lastHeartbeat: new Date(),
      timeoutMs,
      timeoutHandle: setTimeout(() => {
        this.handleTimeout(runId).catch((error) => {
          logger.error('[heartbeat] Error handling timeout', { error, runId });
        });
      }, timeoutMs),
    };

    this.trackers.set(runId, tracker);

    logger.info(`[heartbeat] Started tracking ${runId} (timeout: ${timeoutMs}ms)`);
  }

  /**
   * Record a heartbeat from a worker
   */
  async recordHeartbeat(
    runId: string,
    progress?: number,
    message?: string
  ): Promise<void> {
    const tracker = this.trackers.get(runId);
    if (!tracker) {
      // Task already completed or not being tracked
      return;
    }

    // Update database
    await this.db.none(
      `UPDATE task_runs
       SET heartbeat_at = NOW(),
           metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{progress}',
             $2::jsonb
           )
       WHERE id = $1`,
      [runId, JSON.stringify({ percent: progress, message })]
    );

    // Reset timeout
    if (tracker.timeoutHandle) {
      clearTimeout(tracker.timeoutHandle);
    }

    tracker.lastHeartbeat = new Date();
    tracker.timeoutHandle = setTimeout(() => {
      this.handleTimeout(runId).catch((error) => {
        logger.error('[heartbeat] Error handling timeout', { error, runId });
      });
    }, tracker.timeoutMs);
  }

  /**
   * Cancel tracking (called on task completion)
   */
  cancelTracking(runId: string): void {
    const tracker = this.trackers.get(runId);
    if (tracker?.timeoutHandle) {
      clearTimeout(tracker.timeoutHandle);
    }
    this.trackers.delete(runId);
  }

  /**
   * Handle heartbeat timeout
   */
  private async handleTimeout(runId: string): Promise<void> {
    const tracker = this.trackers.get(runId);
    if (!tracker) {
      return;
    }

    logger.warn(`[heartbeat] Timeout for task ${tracker.taskId} (runId: ${runId})`);

    // Mark as timeout in database
    await this.db.none(
      `UPDATE task_runs
       SET status = 'timeout',
           error = 'Task heartbeat timeout',
           error_code = 'TIMEOUT',
           completed_at = NOW()
       WHERE id = $1 AND status = 'running'`,
      [runId]
    );

    this.trackers.delete(runId);

    // Note: Retry scheduling will be handled by the callback handler
  }

  /**
   * Get tracking statistics
   */
  getStats(): { active: number; trackers: Array<{ runId: string; taskId: string; lastHeartbeat: Date }> } {
    const trackers = Array.from(this.trackers.values()).map((t) => ({
      runId: t.runId,
      taskId: t.taskId,
      lastHeartbeat: t.lastHeartbeat,
    }));

    return {
      active: this.trackers.size,
      trackers,
    };
  }

  /**
   * Cleanup (called on orchestrator shutdown)
   */
  cleanup(): void {
    for (const tracker of this.trackers.values()) {
      if (tracker.timeoutHandle) {
        clearTimeout(tracker.timeoutHandle);
      }
    }
    this.trackers.clear();
  }
}
