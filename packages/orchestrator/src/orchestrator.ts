import express, { type Express } from 'express';
import cors from 'cors';
import type { Server } from 'http';
import type { StorageBackendConfig } from '@pipeweave/shared';
import { createDatabase, testConnection, closeDatabase, type Database, type DatabaseConfig } from './db/index.js';
import {
  getOrchestratorState,
  getMaintenanceStatus,
  requestMaintenance,
  enterMaintenance,
  exitMaintenance,
  canAcceptTasks,
  type MaintenanceStatus,
} from './maintenance.js';
import { registerRoutes } from './routes/index.js';
import { TaskPoller } from './core/poller.js';
import logger from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface OrchestratorConfig {
  /** PostgreSQL connection URL */
  databaseUrl?: string;
  /** Database configuration (alternative to databaseUrl) */
  databaseConfig?: DatabaseConfig;
  /** Storage backend configurations (supports multiple) */
  storageBackends: StorageBackendConfig[];
  /** Default storage backend ID (optional, uses first if not specified) */
  defaultStorageBackendId?: string;
  /** Shared secret key for JWT encryption */
  secretKey: string;
  /** Execution mode */
  mode?: 'standalone' | 'serverless';
  /** Maximum concurrent task executions */
  maxConcurrency?: number;
  /** Polling interval in ms (standalone mode) */
  pollIntervalMs?: number;
  /** DLQ retention in days */
  dlqRetentionDays?: number;
  /** Default idempotency TTL in seconds */
  idempotencyTTLSeconds?: number;
  /** Default max retry delay in ms */
  maxRetryDelayMs?: number;
  /** Logging level: 'minimal' (important only), 'normal' (default), 'detailed' (verbose) */
  logLevel?: 'minimal' | 'normal' | 'detailed';
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class Orchestrator {
  private config: Required<Omit<OrchestratorConfig, 'defaultStorageBackendId' | 'databaseUrl' | 'databaseConfig' | 'logLevel'>> & {
    defaultStorageBackendId: string;
    databaseUrl?: string;
    databaseConfig?: DatabaseConfig;
    logLevel: 'minimal' | 'normal' | 'detailed';
  };
  private storageBackends: Map<string, StorageBackendConfig>;
  private defaultStorageBackend: StorageBackendConfig;
  private db: Database | null = null;
  private app: Express;
  private server: Server | null = null;
  private poller: TaskPoller | null = null;

  constructor(config: OrchestratorConfig) {
    if (!config.databaseUrl && !config.databaseConfig) {
      throw new Error('Either databaseUrl or databaseConfig must be provided');
    }

    if (!config.storageBackends || config.storageBackends.length === 0) {
      throw new Error('At least one storage backend must be configured');
    }

    // Build storage backends map
    this.storageBackends = new Map();
    for (const backend of config.storageBackends) {
      if (this.storageBackends.has(backend.id)) {
        throw new Error(`Duplicate storage backend ID: ${backend.id}`);
      }
      this.storageBackends.set(backend.id, backend);
    }

    // Determine default storage backend
    let defaultBackendId = config.defaultStorageBackendId;
    if (!defaultBackendId) {
      // Use first backend marked as default, or just the first one
      const defaultBackend = config.storageBackends.find((b) => b.isDefault);
      defaultBackendId = defaultBackend?.id ?? config.storageBackends[0]?.id;
      if (!defaultBackendId) {
        throw new Error('No storage backends configured');
      }
    }

    const defaultBackend = this.storageBackends.get(defaultBackendId);
    if (!defaultBackend) {
      throw new Error(`Default storage backend '${defaultBackendId}' not found`);
    }
    this.defaultStorageBackend = defaultBackend;

    this.config = {
      databaseUrl: config.databaseUrl,
      databaseConfig: config.databaseConfig,
      storageBackends: config.storageBackends,
      defaultStorageBackendId: defaultBackendId,
      secretKey: config.secretKey,
      mode: config.mode ?? 'standalone',
      maxConcurrency: config.maxConcurrency ?? 10,
      pollIntervalMs: config.pollIntervalMs ?? 1000,
      dlqRetentionDays: config.dlqRetentionDays ?? 30,
      idempotencyTTLSeconds: config.idempotencyTTLSeconds ?? 86400,
      maxRetryDelayMs: config.maxRetryDelayMs ?? 86400000,
      logLevel: config.logLevel ?? 'normal',
    };

    // Create Express app
    this.app = express();

    // Middleware
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging (only in detailed mode)
    if (this.config.logLevel === 'detailed' && !process.env.GCP_PROJECT_ID) {
      this.app.use((req, _res, next) => {
        logger.info(`[orchestrator] ${req.method} ${req.path}`);
        next();
      });
    }

    // Register all routes
    registerRoutes(this.app, this);
  }

  /**
   * Get a storage backend by ID
   */
  getStorageBackend(id?: string): StorageBackendConfig {
    if (!id) {
      return this.defaultStorageBackend;
    }

    const backend = this.storageBackends.get(id);
    if (!backend) {
      throw new Error(`Storage backend '${id}' not found`);
    }

    return backend;
  }

  /**
   * Get default storage backend
   */
  getDefaultStorageBackend(): StorageBackendConfig {
    return this.defaultStorageBackend;
  }

  /**
   * List all storage backend IDs
   */
  listStorageBackendIds(): string[] {
    return Array.from(this.storageBackends.keys());
  }

  /**
   * Get database instance (throws if not initialized)
   */
  getDatabase(): Database {
    if (!this.db) {
      throw new Error('Database not initialized. Call start() first.');
    }
    return this.db;
  }

  /**
   * Get current log level
   */
  getLogLevel(): 'minimal' | 'normal' | 'detailed' {
    return this.config.logLevel;
  }

  /**
   * Get current maintenance status
   */
  async getMaintenanceStatus(): Promise<MaintenanceStatus> {
    return await getMaintenanceStatus(this.getDatabase());
  }

  /**
   * Request maintenance mode
   * Transitions to 'waiting_for_maintenance' and stops accepting new tasks
   */
  async requestMaintenance(): Promise<MaintenanceStatus> {
    return await requestMaintenance(this.getDatabase());
  }

  /**
   * Enter maintenance mode (only if no tasks are running)
   */
  async enterMaintenance(): Promise<MaintenanceStatus> {
    return await enterMaintenance(this.getDatabase());
  }

  /**
   * Exit maintenance mode and resume normal operation
   */
  async exitMaintenance(): Promise<void> {
    await exitMaintenance(this.getDatabase());
  }

  /**
   * Check if orchestrator can accept new tasks
   */
  async canAcceptTasks(): Promise<boolean> {
    return await canAcceptTasks(this.getDatabase());
  }

  async start(): Promise<void> {
    logger.info(`[orchestrator] Orchestrator starting in ${this.config.mode} mode (log level: ${this.config.logLevel})...`);

    // Initialize database connection
    if (this.config.logLevel !== 'minimal') {
      logger.info('[orchestrator] Connecting to database...');
    }
    try {
      if (this.config.databaseUrl) {
        this.db = createDatabase({ connectionString: this.config.databaseUrl });
      } else if (this.config.databaseConfig) {
        this.db = createDatabase(this.config.databaseConfig);
      }

      // Test connection
      const connected = await testConnection(this.db!);
      if (!connected) {
        throw new Error('Database connection test failed');
      }
      if (this.config.logLevel !== 'minimal') {
        logger.info('[orchestrator] Database connected successfully');
      }

      // Check maintenance mode status
      const state = await getOrchestratorState(this.db!);
      if (this.config.logLevel === 'detailed') {
        logger.info(`[orchestrator] Orchestrator mode: ${state.mode}`);
      }

      // Initialize poller (for both standalone and serverless modes)
      this.poller = new TaskPoller(
        this.db!,
        this,
        this.config.secretKey,
        this.config.maxConcurrency,
        this.config.pollIntervalMs,
        'storage'
      );

      // Start poller loop only in standalone mode
      if (this.config.mode === 'standalone') {
        this.poller.start();
        logger.info('[orchestrator] Task poller started');
      }
    } catch (error) {
      logger.error('[orchestrator] Database initialization failed', { error });
      throw error;
    }

    // Display storage configuration
    if (this.config.logLevel === 'detailed') {
      logger.info('[orchestrator] Configured storage backends:');
      for (const backend of this.config.storageBackends) {
        const isDefault = backend.id === this.config.defaultStorageBackendId;
        logger.info(`[orchestrator]   • ${backend.id} (${backend.provider})${isDefault ? ' [default]' : ''}`);
        logger.info(`[orchestrator]     Endpoint: ${backend.endpoint}`);
        logger.info(`[orchestrator]     Bucket: ${backend.bucket}`);
      }
    } else if (this.config.logLevel === 'normal') {
      const backendCount = this.config.storageBackends.length;
      const defaultBackend = this.config.storageBackends.find(b => b.id === this.config.defaultStorageBackendId);
      logger.info(`[orchestrator] Storage backends configured: ${backendCount} (default: ${defaultBackend?.id})`);
    }

    logger.info('[orchestrator] Orchestrator initialization complete');
    if (this.config.logLevel !== 'minimal') {
      logger.info('[orchestrator] Ready to accept requests');
    }
  }


  /**
   * Create HTTP server interface
   * Returns an object with listen() and stop() methods for controlling the HTTP server
   */
  createServer() {
    const orchestrator = this;

    // Graceful shutdown handlers
    const shutdown = async (signal: string) => {
      logger.info(`[orchestrator] Received ${signal}, shutting down gracefully...`);
      await orchestrator.stop();
      process.exit(0);
    };

    return {
      /**
       * Start HTTP server on specified port
       */
      listen: (port: number, callback?: () => void): Promise<void> => {
        return new Promise((resolve, reject) => {
          try {
            orchestrator.server = orchestrator.app.listen(port, () => {
              logger.info(`[orchestrator] HTTP server listening on port ${port}`);
              logger.info('[orchestrator] Orchestrator ready');
              if (callback) callback();
              resolve();
            });

            orchestrator.server.on('error', (error) => {
              logger.error('[orchestrator] Server error', { error });
              reject(error);
            });

            // Setup graceful shutdown handlers
            process.on('SIGTERM', () => shutdown('SIGTERM'));
            process.on('SIGINT', () => shutdown('SIGINT'));
          } catch (error) {
            reject(error);
          }
        });
      },

      /**
       * Stop HTTP server
       */
      stop: async (): Promise<void> => {
        await orchestrator.stop();
      },
    };
  }

  async stop(): Promise<void> {
    logger.info('[orchestrator] Orchestrator stopping...');

    // Stop poller
    if (this.poller) {
      this.poller.stop();
      this.poller = null;
      if (this.config.logLevel !== 'minimal') {
        logger.info('[orchestrator] Task poller stopped');
      }
    }

    // Close HTTP server
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => {
          if (this.config.logLevel !== 'minimal') {
            logger.info('[orchestrator] HTTP server closed');
          }
          resolve();
        });
      });
      this.server = null;
    }

    // Close database connection
    if (this.db) {
      if (this.config.logLevel !== 'minimal') {
        logger.info('[orchestrator] Closing database connection...');
      }
      closeDatabase(this.db);
      this.db = null;
    }

    logger.info('[orchestrator] Orchestrator stopped');
  }

  /**
   * Get poller instance (for serverless mode manual polling)
   */
  getPoller(): TaskPoller | null {
    return this.poller;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createOrchestrator(config: OrchestratorConfig): Orchestrator {
  return new Orchestrator(config);
}

