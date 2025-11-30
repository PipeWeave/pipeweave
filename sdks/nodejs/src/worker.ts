import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { type TaskOptions, type TaskContext, type TaskResult, DEFAULTS, generateCodeHash } from '@pipeweave/shared';
import { TaskError } from './error.js';
import { createTaskContext } from './context.js';
import { decryptStorageToken, type StorageCredentials } from './crypto.js';
import { HydrationManager } from './hydration.js';

// ============================================================================
// Types
// ============================================================================

export interface WorkerConfig {
  /** Orchestrator URL */
  orchestratorUrl: string;
  /** Unique service identifier */
  serviceId: string;
  /** Service version (semver) */
  version?: string;
  /** Shared secret key for JWT decryption */
  secretKey: string;
  /** Base directory for temp files */
  tempDir?: string;
  /** Clean temp files on failure (default: true) */
  tempCleanupOnFailure?: boolean;
}

export type TaskHandler<TInput = unknown, TOutput = unknown> = (
  ctx: TaskContext<TInput>
) => Promise<TOutput | TaskResult<TOutput>>;

interface RegisteredTask<TInput = unknown, TOutput = unknown> {
  id: string;
  options: Required<Omit<TaskOptions, 'idempotencyKey' | 'description'>> & {
    idempotencyKey?: (input: unknown, codeVersion: number) => string;
    description?: string;
  };
  handler: TaskHandler<TInput, TOutput>;
  codeHash: string;
}

// ============================================================================
// Worker Class
// ============================================================================

export class Worker {
  private config: Required<WorkerConfig>;
  private tasks: Map<string, RegisteredTask> = new Map();
  private server?: ReturnType<typeof createServer>;

  constructor(config: WorkerConfig) {
    this.config = {
      orchestratorUrl: config.orchestratorUrl,
      serviceId: config.serviceId,
      version: config.version ?? '0.1.0',
      secretKey: config.secretKey,
      tempDir: config.tempDir ?? '/tmp/pipeweave',
      tempCleanupOnFailure: config.tempCleanupOnFailure ?? true,
    };
  }

  /**
   * Register a task handler
   */
  register<TInput = unknown, TOutput = unknown>(
    id: string,
    handler: TaskHandler<TInput, TOutput>
  ): void;
  register<TInput = unknown, TOutput = unknown>(
    id: string,
    options: TaskOptions,
    handler: TaskHandler<TInput, TOutput>
  ): void;
  register<TInput = unknown, TOutput = unknown>(
    id: string,
    optionsOrHandler: TaskOptions | TaskHandler<TInput, TOutput>,
    maybeHandler?: TaskHandler<TInput, TOutput>
  ): void {
    const options: TaskOptions = typeof optionsOrHandler === 'function' ? {} : optionsOrHandler;
    const handler: TaskHandler<TInput, TOutput> =
      typeof optionsOrHandler === 'function' ? optionsOrHandler : maybeHandler!;

    const codeHash = generateCodeHash(handler);

    const normalizedOptions = {
      allowedNext: options.allowedNext ?? [],
      timeout: options.timeout ?? DEFAULTS.TASK_TIMEOUT,
      retries: options.retries ?? DEFAULTS.TASK_RETRIES,
      retryBackoff: options.retryBackoff ?? 'exponential',
      retryDelayMs: options.retryDelayMs ?? DEFAULTS.TASK_RETRY_DELAY_MS,
      maxRetryDelayMs: options.maxRetryDelayMs ?? DEFAULTS.TASK_MAX_RETRY_DELAY_MS,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? DEFAULTS.TASK_HEARTBEAT_INTERVAL_MS,
      concurrency: options.concurrency ?? 0,
      priority: options.priority ?? DEFAULTS.TASK_PRIORITY,
      idempotencyKey: options.idempotencyKey as
        | ((input: unknown, codeVersion: number) => string)
        | undefined,
      idempotencyTTL: options.idempotencyTTL ?? DEFAULTS.IDEMPOTENCY_TTL,
      description: options.description,
      inputSchema: options.inputSchema, // Pass through input schema
    };

    this.tasks.set(id, {
      id,
      options: normalizedOptions as RegisteredTask['options'],
      handler: handler as TaskHandler,
      codeHash,
    });
  }

  /**
   * Get registered task info for logging
   */
  getTaskInfo(): Array<{ id: string; codeHash: string; allowedNext: string[] }> {
    return Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      codeHash: task.codeHash,
      allowedNext: task.options.allowedNext,
    }));
  }

  /**
   * Start the worker HTTP server
   */
  async listen(port: number): Promise<void> {
    this.server = createServer(this.handleRequest.bind(this));

    await new Promise<void>((resolve) => {
      this.server!.listen(port, () => {
        this.logStartup(port);
        resolve();
      });
    });

    // Register with orchestrator
    await this.registerWithOrchestrator();
  }

  /**
   * Stop the worker server
   */
  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  private logStartup(port: number): void {
    console.log(`[PipeWeave] Worker ${this.config.serviceId} v${this.config.version} on port ${port}`);
    console.log('[PipeWeave] Task code hashes:');
    for (const task of this.tasks.values()) {
      const next = task.options.allowedNext.length > 0 
        ? `→ [${task.options.allowedNext.join(', ')}]`
        : '→ (end)';
      console.log(`  • ${task.id} [${task.codeHash}] ${next}`);
    }
    console.log('[PipeWeave] Heartbeat intervals:');
    for (const task of this.tasks.values()) {
      const timeout = task.options.heartbeatIntervalMs * 2;
      console.log(`  • ${task.id}: ${task.options.heartbeatIntervalMs}ms (timeout: ${timeout}ms)`);
    }
  }

  private async registerWithOrchestrator(): Promise<void> {
    const tasks = Array.from(this.tasks.values()).map((task) => ({
      id: task.id,
      codeHash: task.codeHash,
      allowedNext: task.options.allowedNext,
      timeout: task.options.timeout,
      retries: task.options.retries,
      retryBackoff: task.options.retryBackoff,
      retryDelayMs: task.options.retryDelayMs,
      maxRetryDelayMs: task.options.maxRetryDelayMs,
      heartbeatIntervalMs: task.options.heartbeatIntervalMs,
      concurrency: task.options.concurrency,
      priority: task.options.priority,
      idempotencyTTL: task.options.idempotencyTTL,
      description: task.options.description,
      inputSchema: task.options.inputSchema, // Include input schema in registration
    }));

    try {
      const response = await fetch(`${this.config.orchestratorUrl}/api/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: this.config.serviceId,
          version: this.config.version,
          baseUrl: `http://localhost:${(this.server?.address() as any)?.port}`,
          tasks,
        }),
      });

      if (!response.ok) {
        throw new Error(`Registration failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as {
        codeChanges?: Array<{ taskId: string; oldVersion: number; newVersion: number }>;
        orphanedTasks?: string[];
      };

      if (result.codeChanges && result.codeChanges.length > 0) {
        console.log('[PipeWeave] Code changes detected:');
        for (const change of result.codeChanges) {
          console.log(`  • ${change.taskId}: v${change.oldVersion} → v${change.newVersion}`);
        }
      }

      if (result.orphanedTasks && result.orphanedTasks.length > 0) {
        console.log('[PipeWeave] Orphaned tasks cancelled:', result.orphanedTasks.join(', '));
      }

      console.log('[PipeWeave] Registered with orchestrator');
    } catch (error) {
      console.error('[PipeWeave] Failed to register with orchestrator:', error);
      throw error;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', service: this.config.serviceId }));
      return;
    }

    // Task execution endpoint: POST /tasks/:taskId
    const taskMatch = url.pathname.match(/^\/tasks\/([^/]+)$/);
    if (taskMatch && req.method === 'POST') {
      const taskId = taskMatch[1];
      if (taskId) {
        await this.handleTaskExecution(taskId, req, res);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Task ID required' }));
      }
      return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private async handleTaskExecution(
    taskId: string,
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const task = this.tasks.get(taskId);

    if (!task) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Task '${taskId}' not found` }));
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    const payload = JSON.parse(body);
    
    // Acknowledge receipt immediately
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ acknowledged: true, runId: payload.runId }));

    // Execute task asynchronously
    this.executeTask(task, payload).catch((error) => {
      console.error(`[PipeWeave] Task ${taskId} execution error:`, error);
    });
  }

  private async executeTask(task: RegisteredTask, payload: any): Promise<void> {
    const { runId, pipelineRunId, attempt, codeVersion, codeHash, storageToken } = payload;
    
    let credentials: StorageCredentials;
    try {
      credentials = decryptStorageToken(storageToken, this.config.secretKey);
    } catch (error) {
      await this.sendCallback(runId, {
        status: 'failed',
        error: 'Failed to decrypt storage token',
        errorCode: 'INVALID_TOKEN',
      });
      return;
    }

    const hydration = new HydrationManager({
      credentials,
      tempDir: this.config.tempDir,
      runId,
      cleanupOnFailure: this.config.tempCleanupOnFailure,
    });

    // Start heartbeat
    const heartbeatInterval = setInterval(async () => {
      try {
        await this.sendHeartbeat(runId);
      } catch (error) {
        console.error(`[PipeWeave] Heartbeat failed for ${runId}:`, error);
      }
    }, task.options.heartbeatIntervalMs);

    try {
      // Hydrate context
      const input = await hydration.loadInput(payload.inputPath);
      const upstream = await hydration.loadUpstream(payload.upstreamRefs);

      // Create task context
      const ctx = createTaskContext({
        runId,
        pipelineRunId,
        attempt,
        codeVersion,
        codeHash,
        input,
        upstream,
        previousAttempts: payload.previousAttempts ?? [],
        hydration,
        orchestratorUrl: this.config.orchestratorUrl,
      });

      // Execute handler
      const result = await task.handler(ctx);

      // Normalize result
      const normalizedResult: TaskResult =
        result && typeof result === 'object' && 'output' in result
          ? result
          : { output: result };

      // Validate runNext if specified
      if (normalizedResult.runNext) {
        const invalidNext = normalizedResult.runNext.filter(
          (n) => !task.options.allowedNext.includes(n)
        );
        if (invalidNext.length > 0) {
          throw new TaskError(`Invalid next tasks: ${invalidNext.join(', ')}`, {
            code: 'INVALID_NEXT_TASKS',
            retryable: false,
          });
        }
      }

      // Dehydrate (upload to S3)
      const { outputPath, outputSize, assets, logsPath } = await hydration.dehydrate(
        normalizedResult.output
      );

      // Send success callback
      await this.sendCallback(runId, {
        status: 'success',
        outputPath,
        outputSize,
        assets,
        logsPath,
        selectedNext: normalizedResult.runNext,
      });
    } catch (error) {
      const taskError = error instanceof TaskError ? error : new TaskError(String(error));
      
      await hydration.cleanup();
      
      await this.sendCallback(runId, {
        status: 'failed',
        error: taskError.message,
        errorCode: taskError.code,
      });
    } finally {
      clearInterval(heartbeatInterval);
    }
  }

  private async sendHeartbeat(runId: string, progress?: number, message?: string): Promise<void> {
    await fetch(`${this.config.orchestratorUrl}/api/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, progress, message }),
    });
  }

  private async sendCallback(runId: string, payload: any): Promise<void> {
    await fetch(`${this.config.orchestratorUrl}/api/callback/${runId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createWorker(config: WorkerConfig): Worker {
  return new Worker(config);
}