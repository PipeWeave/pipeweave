import { createOrchestrator } from "@pipeweave/orchestrator";

// ============================================================================
// Configuration
// ============================================================================

const orchestrator = createOrchestrator({
  // Database connection (choose one method)
  // Method 1: Connection string
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://localhost:5432/pipeweave",

  // Method 2: Individual credentials (alternative to databaseUrl)
  // databaseConfig: {
  //   host: 'localhost',
  //   port: 5432,
  //   database: 'pipeweave',
  //   user: 'postgres',
  //   password: 'postgres',
  //   ssl: false,
  // },

  // Storage backend configurations
  // You can configure multiple storage backends for different environments
  storageBackends: [
    // Local filesystem storage (for development)
    {
      id: "local-dev",
      provider: "local",
      endpoint: "file://",
      bucket: "data",
      credentials: {
        basePath: "./storage",
      },
      isDefault: true, // This will be the default storage backend
    },
    // AWS S3 (for production)
    // {
    //   id: 'primary-s3',
    //   provider: 'aws-s3',
    //   endpoint: 'https://s3.amazonaws.com',
    //   bucket: 'pipeweave-prod',
    //   region: 'us-east-1',
    //   credentials: {
    //     accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    //     secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    //   },
    // },
    // Google Cloud Storage (for backups)
    // {
    //   id: 'gcs-backup',
    //   provider: 'gcs',
    //   endpoint: 'https://storage.googleapis.com',
    //   bucket: 'pipeweave-backup',
    //   credentials: {
    //     projectId: process.env.GCP_PROJECT_ID!,
    //     clientEmail: process.env.GCP_CLIENT_EMAIL!,
    //     privateKey: process.env.GCP_PRIVATE_KEY!,
    //   },
    // },
    // MinIO (self-hosted S3-compatible)
    // {
    //   id: 'local-minio',
    //   provider: 'minio',
    //   endpoint: 'http://localhost:9000',
    //   bucket: 'pipeweave-dev',
    //   credentials: {
    //     accessKey: 'minioadmin',
    //     secretKey: 'minioadmin',
    //   },
    // },
  ],

  // Shared secret key for JWT encryption (REQUIRED)
  // Generate with: openssl rand -hex 32
  secretKey:
    process.env.PIPEWEAVE_SECRET_KEY ?? "dev-secret-key-change-in-production",

  // Execution mode
  mode: "standalone", // or 'serverless' for Cloud Run, Lambda, etc.

  // Maximum concurrent task executions
  maxConcurrency: 10,

  // Polling interval in ms (standalone mode only)
  pollIntervalMs: 5000,

  // Dead Letter Queue retention in days
  dlqRetentionDays: 30,

  // Default idempotency TTL in seconds
  idempotencyTTLSeconds: 86400, // 24 hours

  // Default max retry delay in ms
  maxRetryDelayMs: 86400000, // 24 hours

  // logging level
  logLevel: "detailed",
});

// ============================================================================
// Start Orchestrator
// ============================================================================

async function main() {
  try {
    // Initialize orchestrator (connects to database, validates storage, etc.)
    await orchestrator.start();

    // Check if we can accept tasks (not in maintenance mode)
    const canAccept = await orchestrator.canAcceptTasks();
    console.log(`[Example] Can accept tasks: ${canAccept}`);

    // Get maintenance status
    const maintenanceStatus = await orchestrator.getMaintenanceStatus();
    console.log("[Example] Maintenance status:", maintenanceStatus);

    // List available storage backends
    const storageBackendIds = orchestrator.listStorageBackendIds();
    console.log("[Example] Available storage backends:", storageBackendIds);

    // Get default storage backend
    const defaultBackend = orchestrator.getDefaultStorageBackend();
    console.log(
      `[Example] Default storage backend: ${defaultBackend.id} (${defaultBackend.provider})`
    );

    // Create HTTP server
    const server = orchestrator.createServer();

    // Start listening on port 3000
    await server.listen(3000, () => {
      console.log("[Example] Orchestrator HTTP server listening on port 3000");
      console.log("[Example] API endpoints available:");
      console.log("  - GET  /health                          - Health check");
      console.log(
        "  - POST /api/register                    - Worker registration"
      );
      console.log(
        "  - GET  /api/services                    - List registered services"
      );
      console.log(
        "  - POST /api/pipelines/:id/trigger       - Trigger a pipeline"
      );
      console.log(
        "  - POST /api/queue/task                  - Queue a standalone task"
      );
      console.log(
        "  - GET  /api/queue/status                - Get queue statistics"
      );
      console.log(
        "  - POST /api/tick                        - Process tasks (serverless mode)"
      );
      console.log(
        "  - GET  /api/dlq                         - List dead letter queue"
      );
      console.log(
        "  - GET  /api/storage/backends            - List storage backends"
      );
    });
  } catch (error) {
    console.error("[Example] Failed to start orchestrator:", error);
    process.exit(1);
  }
}

// ============================================================================
// Run
// ============================================================================

main();
