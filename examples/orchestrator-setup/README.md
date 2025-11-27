# Orchestrator Setup Example

This example demonstrates how to set up and configure the PipeWeave orchestrator in different modes and environments.

## Overview

The orchestrator is the core execution engine that manages pipelines, queues tasks, and coordinates workers. This example shows:

- Basic orchestrator setup with code configuration
- Multiple storage backend configurations
- Standalone vs. serverless modes

## Prerequisites

1. **PostgreSQL database**

   ```bash
   # Using Docker
   docker run --name pipeweave-postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16

   # Or use your existing PostgreSQL instance
   ```

2. **Database initialization**

   ```bash
   # Initialize the database schema
   npx pipeweave db init --url postgresql://localhost:5432/pipeweave
   ```

3. **Generate secret key**

   ```bash
   # Generate a secure 32-byte secret key
   openssl rand -hex 32
   ```

## Examples

### 1. Basic Setup (Code Configuration)

The simplest way to configure the orchestrator with code:

```typescript
import { createOrchestrator } from "@pipeweave/orchestrator";

const orchestrator = createOrchestrator({
  databaseUrl: "postgresql://localhost:5432/pipeweave",
  storageBackends: [
    {
      id: "local-dev",
      provider: "local",
      endpoint: "file://",
      bucket: "data",
      credentials: { basePath: "./storage" },
      isDefault: true,
    },
  ],
  secretKey: "your-secret-key",
  mode: "standalone",
  maxConcurrency: 10,
  port: 3000,
});

// Initialize database connection and storage
await orchestrator.start();

// Create HTTP server and start listening
const server = orchestrator.createServer();
await server.listen(3000, () => {
  console.log('Orchestrator ready!');
});
```

**Run:**

```bash
npm start
```

### 2. Maintenance Mode

Demonstrates how to use maintenance mode for database migrations:

```typescript
// Request maintenance mode
await orchestrator.requestMaintenance();
// Stops accepting new tasks, waits for running tasks to complete

// Enter maintenance mode (when all tasks are done)
await orchestrator.enterMaintenance();
// Safe to perform migrations

// Exit maintenance mode
await orchestrator.exitMaintenance();
// Resume normal operation
```

**Run:**

```bash
tsx src/maintenance-example.ts
```

## Configuration Options

### Database Configuration

**Method 1: Connection String**

```typescript
databaseUrl: "postgresql://user:password@localhost:5432/database";
```

**Method 2: Individual Credentials**

```typescript
databaseConfig: {
  host: 'localhost',
  port: 5432,
  database: 'pipeweave',
  user: 'postgres',
  password: 'postgres',
  ssl: false,
  max: 10,
  allowExitOnIdle: false,
}
```

### Storage Backend Types

#### Local Filesystem (Development)

```typescript
{
  id: 'local-dev',
  provider: 'local',
  endpoint: 'file://',
  bucket: 'data',
  credentials: {
    basePath: './storage',
  },
  isDefault: true,
}
```

#### AWS S3 (Production)

```typescript
{
  id: 'primary-s3',
  provider: 'aws-s3',
  endpoint: 'https://s3.amazonaws.com',
  bucket: 'pipeweave-prod',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  isDefault: true,
}
```

#### Google Cloud Storage

```typescript
{
  id: 'gcs-backup',
  provider: 'gcs',
  endpoint: 'https://storage.googleapis.com',
  bucket: 'pipeweave-backup',
  credentials: {
    projectId: 'my-project',
    clientEmail: 'service-account@my-project.iam.gserviceaccount.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n',
  },
}
```

#### MinIO (Self-Hosted S3-Compatible)

```typescript
{
  id: 'local-minio',
  provider: 'minio',
  endpoint: 'http://localhost:9000',
  bucket: 'pipeweave-dev',
  credentials: {
    accessKey: 'minioadmin',
    secretKey: 'minioadmin',
  },
}
```

### Multiple Storage Backends

You can configure multiple storage backends simultaneously:

```typescript
storageBackends: [
  { id: 'local-dev', provider: 'local', /* ... */, isDefault: true },
  { id: 'primary-s3', provider: 'aws-s3', /* ... */ },
  { id: 'gcs-backup', provider: 'gcs', /* ... */ },
]
```

Workers will automatically use the appropriate storage backend based on the JWT token provided by the orchestrator.

## Deployment Modes

### Standalone Mode (Default)

Best for dedicated servers, VMs, or containers:

```typescript
mode: 'standalone',
pollIntervalMs: 1000,
```

The orchestrator runs a background poller that continuously processes pending tasks.

### Serverless Mode

Best for Cloud Run, Lambda, or serverless platforms:

```typescript
mode: 'serverless',
```

No background polling. Instead, external schedulers trigger task processing:

```bash
# Cloud Scheduler calls this endpoint every minute
POST http://your-orchestrator/api/tick
```

**Run in serverless mode:**

```bash
npm run start:serverless
```

## API Endpoints

Once the orchestrator is running, the following endpoints are available:

### Health & Info

- `GET /health` — Health check + maintenance status
- `GET /api/info` — Orchestrator version and uptime

### Service Management

- `POST /api/register` — Worker registration
- `GET /api/services` — List registered services
- `GET /api/services/:id` — Get service details

### Pipeline Management

- `GET /api/pipelines` — List all pipelines
- `POST /api/pipelines/:id/trigger` — Trigger a pipeline
- `POST /api/pipelines/:id/dry-run` — Validate pipeline

### Task Queue

- `POST /api/queue/task` — Queue a standalone task
- `POST /api/queue/batch` — Queue multiple tasks
- `GET /api/queue/status` — Get queue statistics
- `POST /api/tick` — Process tasks (serverless mode)

### Dead Letter Queue

- `GET /api/dlq` — List failed tasks
- `POST /api/dlq/:id/retry` — Retry a failed task
- `POST /api/dlq/purge` — Purge old entries

### Storage

- `GET /api/storage/backends` — List configured storage backends
- `GET /api/storage/*` — Retrieve storage content

## Orchestrator Methods

### Starting and Stopping

```typescript
// Initialize database connection and storage
await orchestrator.start();

// Create HTTP server
const server = orchestrator.createServer();

// Start listening on a port
await server.listen(3000);
// With callback:
await server.listen(3000, () => {
  console.log('Server is ready!');
});

// Graceful shutdown (stops HTTP server, closes database)
await server.stop();
```

### Maintenance Mode

```typescript
// Check if we can accept tasks
const canAccept = await orchestrator.canAcceptTasks();

// Get maintenance status
const status = await orchestrator.getMaintenanceStatus();
// Returns: { mode, runningTasks, pendingTasks, lastHeartbeat }

// Request maintenance mode
await orchestrator.requestMaintenance();
// Transitions to 'waiting_for_maintenance'

// Enter maintenance mode (if no tasks running)
await orchestrator.enterMaintenance();
// Transitions to 'maintenance'

// Exit maintenance mode
await orchestrator.exitMaintenance();
// Returns to 'operational'
```

### Storage Backends

```typescript
// List all storage backend IDs
const backendIds = orchestrator.listStorageBackendIds();

// Get default storage backend
const defaultBackend = orchestrator.getDefaultStorageBackend();

// Get specific storage backend
const backend = orchestrator.getStorageBackend("primary-s3");
```

### Database Access

```typescript
// Get database instance (for custom queries)
const db = orchestrator.getDatabase();
```

## Testing the Orchestrator

### 1. Start the orchestrator

```bash
npm start
```

### 2. Check health

```bash
curl http://localhost:3000/health
```

### 3. List storage backends

```bash
curl http://localhost:3000/api/storage/backends
```

### 4. Queue a task (after registering a worker)

```bash
curl -X POST http://localhost:3000/api/queue/task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "download",
    "input": {"pdfUrl": "https://example.com/doc.pdf"},
    "priority": 50
  }'
```

### 5. Get queue status

```bash
curl http://localhost:3000/api/queue/status
```

## Production Deployment

### Security Checklist

- [ ] Use a strong 32-byte secret key (never commit to version control)
- [ ] Use SSL/TLS for database connections in production
- [ ] Store credentials in secrets management (AWS Secrets Manager, Google Secret Manager, etc.)
- [ ] Enable authentication on API endpoints
- [ ] Use IAM roles for cloud storage access (avoid hardcoded credentials)

### Environment Variables for Production

```bash
# Production database
DATABASE_URL=postgresql://user:password@production-host:5432/pipeweave?sslmode=require

# Production storage
STORAGE_BACKENDS='[{"id":"prod-s3","provider":"aws-s3","endpoint":"https://s3.amazonaws.com","bucket":"pipeweave-production","region":"us-east-1","credentials":{"accessKeyId":"${AWS_ACCESS_KEY_ID}","secretAccessKey":"${AWS_SECRET_ACCESS_KEY}"},"isDefault":true}]'

# Security
PIPEWEAVE_SECRET_KEY=${SECRET_KEY_FROM_SECRETS_MANAGER}

# Orchestrator
MODE=standalone
PORT=8080
MAX_CONCURRENCY=50
NODE_ENV=production
```

### Docker Deployment

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 8080
CMD ["node", "src/server-from-env.js"]
```

### Google Cloud Run

```bash
gcloud run deploy pipeweave-orchestrator \
  --source . \
  --region us-central1 \
  --set-env-vars MODE=serverless \
  --set-secrets DATABASE_URL=pipeweave-db-url:latest,PIPEWEAVE_SECRET_KEY=pipeweave-secret:latest
```

### AWS ECS/Fargate

Use task definitions with environment variables from AWS Secrets Manager or Parameter Store.

## Monitoring

### Queue Statistics

```bash
curl http://localhost:3000/api/queue/status
```

Response:

```json
{
  "pending": 15,
  "running": 3,
  "waiting": 0,
  "completed": 142,
  "failed": 2,
  "dlq": 5,
  "oldestPending": "2024-01-15T10:30:00Z"
}
```

### Dead Letter Queue

```bash
curl http://localhost:3000/api/dlq
```

View failed tasks with complete context for debugging.

## Next Steps

- See [pdf-processor example](../pdf-processor/) for worker implementation
- Read the [main specification](../../SPEC.md) for complete documentation
- Check [orchestrator README](../../packages/orchestrator/README.md) for API details

## License

MIT
