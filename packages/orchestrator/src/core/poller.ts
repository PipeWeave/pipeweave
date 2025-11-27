import type { Database } from "../db/index.js";
import logger from "../logger.js";
import type { Orchestrator } from "../orchestrator.js";
import { DLQManager } from "./dlq-manager.js";
import { TaskExecutor } from "./executor.js";
import { HeartbeatMonitor } from "./heartbeat-monitor.js";
import { IdempotencyManager } from "./idempotency.js";
import { QueueManager } from "./queue-manager.js";
import { ServiceRegistry } from "./registry.js";
import { RetryManager } from "./retry-manager.js";

// ============================================================================
// Task Poller
// ============================================================================

export class TaskPoller {
  private intervalHandle?: NodeJS.Timeout;
  private isRunning = false;
  private queueManager: QueueManager;
  private executor: TaskExecutor;
  private heartbeatMonitor: HeartbeatMonitor;
  private retryManager: RetryManager;
  private dlqManager: DLQManager;
  private idempotencyManager: IdempotencyManager;
  private registry: ServiceRegistry;

  constructor(
    private db: Database,
    private orchestrator: Orchestrator,
    private secretKey: string,
    private maxConcurrency: number,
    private pollIntervalMs: number,
    private storageBasePath: string
  ) {
    // Initialize all managers
    this.queueManager = new QueueManager(db, storageBasePath);
    this.executor = new TaskExecutor(db, orchestrator, secretKey);
    this.heartbeatMonitor = new HeartbeatMonitor(db);
    this.retryManager = new RetryManager(db);
    this.dlqManager = new DLQManager(db);
    this.idempotencyManager = new IdempotencyManager(db);
    this.registry = new ServiceRegistry(db);
  }

  /**
   * Start polling loop
   */
  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;

    this.intervalHandle = setInterval(async () => {
      await this.poll();
    }, this.pollIntervalMs);

    logger.info(
      `[poller] Started (interval: ${this.pollIntervalMs}ms, max concurrency: ${this.maxConcurrency})`
    );
  }

  /**
   * Stop polling loop
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }

    this.isRunning = false;
    this.heartbeatMonitor.cleanup();

    logger.info("[poller] Stopped");
  }

  /**
   * Process pending tasks (single poll cycle)
   */
  async poll(): Promise<number> {
    const logLevel = this.orchestrator.getLogLevel();
    const startTime = Date.now();

    try {
      // Check if orchestrator can accept tasks (maintenance mode)
      const canAccept = await this.orchestrator.canAcceptTasks();
      if (!canAccept) {
        if (logLevel !== "normal") {
          logger.info(
            "[poller] Skipping tick - orchestrator in maintenance mode"
          );
        }
        return 0;
      }

      // Get pending tasks
      const tasks = await this.queueManager.getNext(this.maxConcurrency);

      if (tasks.length === 0) {
        // Only log in detailed mode when no tasks
        if (logLevel === "detailed") {
          logger.info("[poller] Tick completed - no tasks to process");
        }
        return 0;
      }

      if (logLevel === "detailed") {
        logger.info(`[poller] Dispatching ${tasks.length} tasks`);
      }

      // Dispatch in parallel
      const results = await Promise.allSettled(
        tasks.map(async (task) => {
          try {
            // Mark as running first
            await this.queueManager.markRunning(task.runId);

            // Dispatch to worker
            await this.executor.dispatch(task);

            // Start heartbeat monitoring
            const taskDef = await this.registry.getTask(task.taskId);
            if (taskDef) {
              this.heartbeatMonitor.startTracking(
                task.runId,
                task.taskId,
                taskDef.heartbeatIntervalMs
              );
            }
          } catch (error) {
            logger.error("[poller] Dispatch failed", {
              error,
              runId: task.runId,
              taskId: task.taskId,
            });

            // Handle dispatch failure - schedule retry or move to DLQ
            const taskDef = await this.registry.getTask(task.taskId);
            if (taskDef && task.attempt < task.maxRetries) {
              await this.retryManager.scheduleRetry({
                runId: task.runId,
                taskId: task.taskId,
                attempt: task.attempt,
                maxRetries: task.maxRetries,
                retryBackoff: taskDef.retryBackoff,
                retryDelayMs: taskDef.retryDelayMs,
                maxRetryDelayMs: taskDef.maxRetryDelayMs,
                error: error instanceof Error ? error.message : "Unknown error",
                errorCode: "DISPATCH_FAILED",
              });
            } else {
              await this.dlqManager.add(
                task,
                error instanceof Error ? error.message : "Unknown error"
              );
              await this.queueManager.markFailed(
                task.runId,
                error instanceof Error ? error.message : "Unknown error",
                "DISPATCH_FAILED"
              );
            }
          }
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      const duration = Date.now() - startTime;

      // Log tick completion based on log level
      if (logLevel === "detailed") {
        logger.info(
          `[poller] Tick completed - processed: ${tasks.length} tasks (${succeeded} dispatched, ${failed} failed) in ${duration}ms`
        );
      } else if (logLevel === "normal") {
        logger.info(
          `[poller] Tick completed - processed: ${tasks.length} tasks in ${duration}ms`
        );
      }

      return tasks.length;
    } catch (error) {
      logger.error("[poller] Poll error", { error });
      return 0;
    }
  }

  /**
   * Get poller statistics
   */
  getStats(): {
    isRunning: boolean;
    maxConcurrency: number;
    pollIntervalMs: number;
    heartbeats: ReturnType<HeartbeatMonitor["getStats"]>;
  } {
    return {
      isRunning: this.isRunning,
      maxConcurrency: this.maxConcurrency,
      pollIntervalMs: this.pollIntervalMs,
      heartbeats: this.heartbeatMonitor.getStats(),
    };
  }

  /**
   * Manual poll trigger (for serverless mode)
   */
  async manualPoll(): Promise<number> {
    return await this.poll();
  }
}
