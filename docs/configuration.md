# Configuration Guide

This document covers all configuration options for PipeWeave components.

## Environment Variables

### Orchestrator Configuration

#### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/pipeweave` |
| `PIPEWEAVE_SECRET_KEY` | 32-byte hex key for encryption (must match across all components) | `openssl rand -hex 32` |
| `STORAGE_BACKENDS` | JSON array of storage backend configurations | See [Storage Configuration](#storage-configuration) |

#### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `MODE` | `standalone` | Deployment mode: `standalone` or `serverless` |
| `PORT` | `3000` | HTTP server port |
| `MAX_CONCURRENCY` | `10` | Maximum concurrent task dispatches per poll |
| `POLL_INTERVAL_MS` | `1000` | Polling interval in standalone mode (milliseconds) |
| `LOG_LEVEL` | `normal` | Logging verbosity: `minimal`, `normal`, or `detailed` |
| `DLQ_RETENTION_DAYS` | `30` | Days to retain dead letter queue entries |
| `IDEMPOTENCY_TTL_SECONDS` | `86400` | Seconds to cache idempotent task results (24 hours) |
| `MAX_RETRY_DELAY_MS` | `86400000` | Maximum retry delay in milliseconds (24 hours) |

#### Legacy Database Configuration

Alternatively, you can use individual database connection variables:

| Variable | Description |
|----------|-------------|
| `DB_HOST` | Database host |
| `DB_PORT` | Database port (default: 5432) |
| `DB_NAME` | Database name |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `DB_SSL` | Enable SSL (default: false) |

### Worker (SDK) Configuration

Workers typically configure via the SDK constructor:

```typescript
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: process.env.PIPEWEAVE_ORCHESTRATOR_URL,
  serviceId: "my-service",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY,
  version: "1.0.0", // optional
  heartbeatIntervalMs: 60000, // optional, default: 60s
});
```

| Option | Required | Description |
|--------|----------|-------------|
| `orchestratorUrl` | Yes | Orchestrator HTTP endpoint |
| `serviceId` | Yes | Unique service identifier |
| `secretKey` | Yes | Must match orchestrator's `PIPEWEAVE_SECRET_KEY` |
| `version` | No | Service version (default: package.json version) |
| `heartbeatIntervalMs` | No | Heartbeat interval (default: 60000ms) |

### CLI Configuration

The CLI reads configuration from:
1. Command line flags (highest priority)
2. Environment variables
3. `.env` file in current directory

```bash
# Using environment variables
export PIPEWEAVE_ORCHESTRATOR_URL=http://localhost:3000
export PIPEWEAVE_SECRET_KEY=your-secret-key

# Using command flags
npx @pipeweave/cli trigger my-pipeline \
  --url http://localhost:3000 \
  --secret your-secret-key \
  -i '{"key": "value"}'
```

## Storage Configuration

### Multi-Backend Configuration

PipeWeave supports multiple storage backends running simultaneously. Configure via the `STORAGE_BACKENDS` environment variable:

```bash
STORAGE_BACKENDS='[
  {
    "id": "primary-s3",
    "provider": "aws-s3",
    "endpoint": "https://s3.amazonaws.com",
    "bucket": "pipeweave-prod",
    "region": "us-east-1",
    "credentials": {
      "accessKeyId": "AKIA...",
      "secretAccessKey": "..."
    },
    "isDefault": true
  },
  {
    "id": "backup-gcs",
    "provider": "gcs",
    "endpoint": "https://storage.googleapis.com",
    "bucket": "pipeweave-backup",
    "credentials": {
      "projectId": "my-project",
      "clientEmail": "service@project.iam.gserviceaccount.com",
      "privateKey": "-----BEGIN PRIVATE KEY-----\n..."
    }
  }
]'

# Optionally specify default backend ID
DEFAULT_STORAGE_BACKEND_ID=primary-s3
```

### Provider-Specific Configuration

#### Local Filesystem

Best for: Development, testing

```json
{
  "id": "local-dev",
  "provider": "local",
  "endpoint": "file://",
  "bucket": "data",
  "credentials": {
    "basePath": "./storage"
  },
  "isDefault": true
}
```

**Notes:**
- `basePath` must exist and have write permissions
- Files stored at `{basePath}/{bucket}/{path}`
- Not suitable for production (no redundancy, no scaling)

#### AWS S3

Best for: Production, AWS deployments

```json
{
  "id": "primary-s3",
  "provider": "aws-s3",
  "endpoint": "https://s3.amazonaws.com",
  "bucket": "pipeweave-prod",
  "region": "us-east-1",
  "credentials": {
    "accessKeyId": "AKIA...",
    "secretAccessKey": "..."
  },
  "isDefault": true
}
```

**IAM Policy (minimum required):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::pipeweave-prod",
        "arn:aws:s3:::pipeweave-prod/*"
      ]
    }
  ]
}
```

**Bucket Configuration:**
- Versioning: Recommended
- Encryption: AES-256 or KMS
- Lifecycle policies: Optional (e.g., delete old task data after 90 days)

#### Google Cloud Storage

Best for: Production, GCP deployments

```json
{
  "id": "primary-gcs",
  "provider": "gcs",
  "endpoint": "https://storage.googleapis.com",
  "bucket": "pipeweave-prod",
  "credentials": {
    "projectId": "my-project-123",
    "clientEmail": "pipeweave@my-project.iam.gserviceaccount.com",
    "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
  },
  "isDefault": true
}
```

**Service Account Roles (minimum required):**
- `roles/storage.objectAdmin` on the bucket

**Creating a Service Account:**

```bash
# Create service account
gcloud iam service-accounts create pipeweave \
  --display-name "PipeWeave Storage Access"

# Grant storage permissions
gcloud projects add-iam-policy-binding my-project-123 \
  --member "serviceAccount:pipeweave@my-project.iam.gserviceaccount.com" \
  --role "roles/storage.objectAdmin" \
  --condition "resource.name.startsWith('projects/_/buckets/pipeweave-prod')"

# Generate key
gcloud iam service-accounts keys create pipeweave-key.json \
  --iam-account pipeweave@my-project.iam.gserviceaccount.com
```

#### MinIO

Best for: Self-hosted production, air-gapped environments

```json
{
  "id": "local-minio",
  "provider": "minio",
  "endpoint": "http://localhost:9000",
  "bucket": "pipeweave-dev",
  "credentials": {
    "accessKey": "minioadmin",
    "secretKey": "minioadmin"
  },
  "isDefault": true
}
```

**Production MinIO Setup:**

```bash
# Docker Compose example
version: '3'
services:
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: admin
      MINIO_ROOT_PASSWORD: strongpassword123
    volumes:
      - minio-data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    restart: unless-stopped

volumes:
  minio-data:
```

### Legacy Single-Backend Configuration

For backwards compatibility, you can configure a single storage backend using these variables:

```bash
# Single backend configuration
STORAGE_PROVIDER=aws-s3  # or 'local', 'gcs', 'minio'
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=pipeweave-prod
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...

# For GCS
GCP_PROJECT_ID=my-project
GCP_CLIENT_EMAIL=service@project.iam.gserviceaccount.com
GCP_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

# For MinIO
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# For local filesystem
LOCAL_STORAGE_BASE_PATH=./storage
```

## Task Configuration

Tasks are configured when registering with the SDK:

```typescript
worker.register(
  "task-id",
  {
    // Execution settings
    timeoutMs: 300000,              // 5 minutes (default: 5 min)
    heartbeatIntervalMs: 30000,     // 30 seconds (default: 60s)
    concurrency: 5,                 // Max parallel executions (default: unlimited)

    // Retry settings
    retries: 3,                     // Number of retry attempts (default: 0)
    retryBackoff: "exponential",    // 'fixed' or 'exponential' (default: fixed)
    retryDelayMs: 1000,             // Initial retry delay (default: 1000ms)
    maxRetryDelayMs: 60000,         // Max exponential backoff (default: 1 hour)

    // Idempotency
    idempotencyKey: (input, codeVersion) => {
      return `v${codeVersion}-${input.orderId}`;
    },

    // Pipeline routing
    allowedNext: ["next-task-1", "next-task-2"],
  },
  async (ctx) => {
    // Task implementation
  }
);
```

### Task Option Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeoutMs` | `number` | `300000` | Maximum execution time in milliseconds |
| `heartbeatIntervalMs` | `number` | `60000` | How often to send heartbeats |
| `concurrency` | `number` | `0` (unlimited) | Maximum concurrent executions of this task |
| `retries` | `number` | `0` | Number of retry attempts on failure |
| `retryBackoff` | `"fixed" \| "exponential"` | `"fixed"` | Retry delay strategy |
| `retryDelayMs` | `number` | `1000` | Initial delay before retry |
| `maxRetryDelayMs` | `number` | `86400000` | Maximum exponential backoff delay (24h) |
| `idempotencyKey` | `function` | `undefined` | Function to generate idempotency keys |
| `allowedNext` | `string[]` | `[]` | Array of task IDs that can run after this task |

## Database Configuration

### Connection Pooling

PipeWeave uses `pg-promise` with default connection pooling. You can tune pool settings via `DATABASE_URL` query parameters:

```bash
# Custom pool settings
DATABASE_URL="postgresql://user:pass@localhost:5432/pipeweave?max=20&idle_timeout=30000"
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `max` | `10` | Maximum pool size |
| `idle_timeout` | `30000` | Idle connection timeout (ms) |
| `connection_timeout` | `0` (none) | Connection timeout (ms) |

### Production Recommendations

```bash
# Production database URL with optimized settings
DATABASE_URL="postgresql://pipeweave:password@db-host:5432/pipeweave?max=20&idle_timeout=10000&ssl=true"
```

**Tuning Guidelines:**
- `max`: Set to `2 × number of CPU cores` on orchestrator
- Enable SSL in production
- Use connection pooling proxy (e.g., PgBouncer) for high scale
- Regular vacuum and analyze jobs for performance

### Migrations

Migrations are managed by the CLI:

```bash
# Run all pending migrations
npx @pipeweave/cli db migrate --url $DATABASE_URL

# Check migration status
npx @pipeweave/cli db status --url $DATABASE_URL

# Create new migration
npx @pipeweave/cli db create add_new_feature --url $DATABASE_URL
```

## Security Configuration

### Secret Key Generation

Generate a strong secret key:

```bash
# 32-byte hex key (recommended)
openssl rand -hex 32

# Or 64-byte base64 key
openssl rand -base64 64
```

**Important:**
- Use the same key for orchestrator and all workers
- Rotate keys periodically
- Store in secrets manager (AWS Secrets Manager, GCP Secret Manager, etc.)

### Network Security

**Orchestrator:**
- Expose port 3000 (or custom `PORT`) for worker and CLI access
- Use HTTPS in production (terminate TLS at load balancer)
- Implement rate limiting at the load balancer level
- Restrict access to trusted IPs/networks if possible

**Workers:**
- Expose task execution port (e.g., 8080) only to orchestrator
- Use HTTPS for production deployments
- Implement mutual TLS (mTLS) for enhanced security

**Database:**
- Never expose PostgreSQL port publicly
- Use SSL/TLS for connections
- Rotate database passwords regularly
- Use least-privilege database users

### Storage Security

**S3/GCS:**
- Use IAM roles instead of access keys when possible
- Enable bucket encryption at rest
- Enable access logging
- Use bucket policies to restrict access
- Enable versioning for data recovery

**MinIO:**
- Change default credentials immediately
- Enable TLS/SSL
- Use strong passwords
- Implement bucket policies
- Regular security updates

## Monitoring and Logging

### Log Levels

Set via `LOG_LEVEL` environment variable:

| Level | Output |
|-------|--------|
| `minimal` | Errors and critical events only |
| `normal` | Errors, warnings, and key operations (default) |
| `detailed` | All above plus debug information, request/response logs |

### Health Checks

The orchestrator exposes health endpoints:

```bash
# Basic health check
GET /health
{
  "status": "healthy",
  "canAcceptTasks": true,
  "maintenanceMode": "running"
}

# Detailed info
GET /api/info
{
  "version": "1.0.0",
  "mode": "standalone",
  "storageBackends": [...]
}
```

**Kubernetes Health Probes:**

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 5
  periodSeconds: 5
```

### Metrics

PipeWeave exposes metrics via the API:

```bash
# Queue status
GET /api/queue/status
{
  "pending": 42,
  "running": 5,
  "completed": 1234,
  "failed": 8
}

# Dead letter queue
GET /api/dlq
[...]
```

For production monitoring, consider:
- Prometheus exporter (community contribution welcome)
- CloudWatch/Stackdriver integration via logs
- Custom metrics via task callbacks

## Performance Tuning

### Orchestrator

```bash
# High-throughput configuration
MAX_CONCURRENCY=50          # More parallel dispatches
POLL_INTERVAL_MS=500        # Faster polling (standalone mode)
IDEMPOTENCY_TTL_SECONDS=3600 # Shorter cache (more memory efficient)
```

### Database

```postgresql
-- Recommended indexes (already in migrations)
CREATE INDEX idx_task_runs_status_priority ON task_runs(status, priority, created_at);
CREATE INDEX idx_task_runs_pipeline_run ON task_runs(pipeline_run_id);

-- Vacuum regularly
VACUUM ANALYZE task_runs;
VACUUM ANALYZE pipeline_runs;
```

### Storage

- Use CDN for frequently accessed assets
- Implement storage lifecycle policies to archive old data
- Consider storage classes (e.g., S3 Infrequent Access for old runs)

## Example Configurations

### Development (Local)

```bash
# .env
DATABASE_URL=postgresql://localhost:5432/pipeweave
PIPEWEAVE_SECRET_KEY=$(openssl rand -hex 32)
STORAGE_BACKENDS='[{"id":"local","provider":"local","endpoint":"file://","bucket":"data","credentials":{"basePath":"./storage"},"isDefault":true}]'
MODE=standalone
PORT=3000
LOG_LEVEL=detailed
```

### Production (AWS)

```bash
# .env
DATABASE_URL=postgresql://pipeweave:${DB_PASSWORD}@db.us-east-1.rds.amazonaws.com:5432/pipeweave?ssl=true&max=20
PIPEWEAVE_SECRET_KEY=${SECRET_KEY_FROM_SECRETS_MANAGER}
STORAGE_BACKENDS='[{"id":"prod-s3","provider":"aws-s3","endpoint":"https://s3.amazonaws.com","bucket":"pipeweave-prod","region":"us-east-1","credentials":{"accessKeyId":"${AWS_ACCESS_KEY_ID}","secretAccessKey":"${AWS_SECRET_ACCESS_KEY}"},"isDefault":true}]'
MODE=standalone
PORT=3000
LOG_LEVEL=normal
MAX_CONCURRENCY=20
POLL_INTERVAL_MS=1000
```

### Production (Serverless)

```bash
# .env
DATABASE_URL=postgresql://pipeweave:${DB_PASSWORD}@db.us-east-1.rds.amazonaws.com:5432/pipeweave?ssl=true&max=5
PIPEWEAVE_SECRET_KEY=${SECRET_KEY_FROM_SECRETS_MANAGER}
STORAGE_BACKENDS='[{"id":"prod-s3","provider":"aws-s3","endpoint":"https://s3.amazonaws.com","bucket":"pipeweave-prod","region":"us-east-1","credentials":{"accessKeyId":"${AWS_ACCESS_KEY_ID}","secretAccessKey":"${AWS_SECRET_ACCESS_KEY}"},"isDefault":true}]'
MODE=serverless
PORT=8080
LOG_LEVEL=normal
MAX_CONCURRENCY=10
```

## Troubleshooting

### Configuration Errors

**Symptom:** Orchestrator fails to start

Check:
1. `DATABASE_URL` is valid and database is accessible
2. `PIPEWEAVE_SECRET_KEY` is exactly 32 or 64 hex characters
3. `STORAGE_BACKENDS` is valid JSON
4. All required storage credentials are present

**Symptom:** Worker can't register

Check:
1. `orchestratorUrl` is accessible from worker
2. `secretKey` matches orchestrator's `PIPEWEAVE_SECRET_KEY`
3. Orchestrator is not in maintenance mode

**Symptom:** Storage errors

Check:
1. Storage credentials are correct
2. Buckets exist and are accessible
3. Network connectivity to storage endpoints
4. IAM permissions are sufficient

For more help, see [Getting Started](./getting-started.md) or [GitHub Issues](https://github.com/pipeweave/pipeweave/issues).
