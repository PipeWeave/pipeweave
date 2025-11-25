# @pipeweave/orchestrator

The PipeWeave orchestrator — the core execution engine that manages pipelines, queues tasks, and coordinates workers.

## Features

- **Pipeline execution** — Orchestrate complex DAG workflows
- **Task queue management** — Priority-based task scheduling
- **Worker registration** — Auto-discovery and health monitoring
- **Heartbeat monitoring** — Detect and recover from stalled tasks
- **Retry handling** — Automatic retries with configurable backoff
- **Idempotency** — Prevent duplicate task executions
- **Dead Letter Queue** — Capture and retry failed tasks
- **Code versioning** — Track task code changes across deployments
- **Multi-mode deployment** — Standalone or serverless execution

## Installation

```bash
npm install @pipeweave/orchestrator
```

## Quick Start

### Standalone Mode

```typescript
import { createOrchestrator } from "@pipeweave/orchestrator";

const orchestrator = createOrchestrator({
  databaseUrl: process.env.DATABASE_URL,
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    bucket: process.env.S3_BUCKET,
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
  },
  secretKey: process.env.PIPEWEAVE_SECRET_KEY,
  mode: "standalone",
  maxConcurrency: 10,
  pollIntervalMs: 1000,
});

await orchestrator.start();
```

### Serverless Mode

```typescript
const orchestrator = createOrchestrator({
  // ... same config ...
  mode: "serverless",
});

// Expose process endpoint for Cloud Scheduler
app.post("/api/process", (req, res) => {
  orchestrator.processPending();
  res.json({ status: "ok" });
});
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `S3_ENDPOINT` | Yes | — | S3/MinIO endpoint |
| `S3_BUCKET` | Yes | — | Bucket name |
| `S3_ACCESS_KEY` | Yes | — | S3 access key |
| `S3_SECRET_KEY` | Yes | — | S3 secret key |
| `PIPEWEAVE_SECRET_KEY` | Yes | — | Shared JWT encryption key |
| `MODE` | No | `standalone` | Execution mode (`standalone` or `serverless`) |
| `MAX_CONCURRENCY` | No | `10` | Maximum parallel tasks |
| `POLL_INTERVAL_MS` | No | `1000` | Task polling interval (standalone mode) |
| `DLQ_RETENTION_DAYS` | No | `30` | How long to keep DLQ entries |
| `IDEMPOTENCY_TTL_SECONDS` | No | `86400` | Default idempotency cache TTL |
| `MAX_RETRY_DELAY_MS` | No | `86400000` | Default max retry delay (24h) |

## API Endpoints

### Health & Info

- `GET /health` — Health check
- `GET /api/services` — List registered services
- `GET /api/services/:id/tasks` — List tasks for a service

### Pipeline Management

- `GET /api/pipelines` — List all pipelines
- `POST /api/pipelines/:id/trigger` — Trigger a pipeline
- `POST /api/pipelines/:id/dry-run` — Validate pipeline without executing
- `GET /api/runs` — List pipeline runs
- `GET /api/runs/:id` — Get run details

### Task Queue

- `POST /api/queue/task` — Queue a standalone task
- `POST /api/queue/batch` — Queue multiple tasks
- `GET /api/queue/status` — Get queue statistics
- `GET /api/queue/items` — List queue items

### Task Execution

- `GET /api/task-runs/:id` — Get task run details
- `POST /api/heartbeat` — Worker heartbeat
- `POST /api/progress` — Task progress update
- `POST /api/callback/:runId` — Task completion callback

### Dead Letter Queue

- `GET /api/dlq` — List failed tasks
- `POST /api/dlq/:id/retry` — Retry a failed task

### Storage

- `GET /api/storage/*` — Retrieve S3 content via orchestrator

### Code History

- `GET /api/tasks/:id/history` — View task code change history

## Architecture

### Worker-Side Hydration

The orchestrator generates JWT tokens containing encrypted S3 credentials. Workers decrypt these tokens and load data directly from S3, minimizing data transfer through the orchestrator.

```
Orchestrator                     Worker
     |                              |
     |--- JWT + metadata ---------->|
     |                              |
     |                         Decrypt JWT
     |                              |
     |                         Load from S3
     |                              |
     |                         Execute task
     |                              |
     |<--- Callback (metadata) -----|
```

### Heartbeat Monitoring

Workers send periodic heartbeats while executing tasks. The orchestrator automatically detects stalled tasks and marks them for retry.

- Each task configures its own `heartbeatIntervalMs`
- Orchestrator calculates timeout as `2 × heartbeatIntervalMs`
- Missing heartbeat triggers task failure and retry
- Callback cancels pending timeout to prevent race conditions

### Code Versioning

The orchestrator tracks task code changes via SHA-256 hashing:

- Workers send code hashes on registration
- Orchestrator detects changes and increments `code_version`
- History stored in `task_code_history` table
- UI shows which tasks changed between runs

### Deployment Modes

**Standalone Mode:**
- Orchestrator runs a background poller
- Continuously processes pending tasks
- Suitable for dedicated servers, VMs, containers

**Serverless Mode:**
- No background polling
- External scheduler (Cloud Scheduler, cron) triggers `/api/process`
- Suitable for Cloud Run, Lambda, serverless platforms

## Database Schema

The orchestrator uses PostgreSQL with tables for:

- `services` — Registered workers
- `tasks` — Task definitions with code hashes and versions
- `task_code_history` — Code change audit log
- `pipelines` — Pipeline definitions
- `pipeline_runs` — Pipeline execution tracking
- `task_runs` — Individual task executions
- `dlq` — Dead letter queue entries

Initialize the database with:

```bash
npx pipeweave db init --url $DATABASE_URL
```

## Monitoring

### Queue Statistics

```bash
curl http://localhost:3000/api/queue/status
```

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

Failed tasks after all retries are preserved with:
- Original input and context
- All attempt errors
- Code version at failure time

## Security

### JWT Encryption

The orchestrator encrypts S3 credentials using AES-256-GCM:

1. Generate a 32-byte shared secret:
   ```bash
   openssl rand -hex 32
   ```

2. Set on both orchestrator and all workers:
   ```bash
   export PIPEWEAVE_SECRET_KEY="your-32-byte-hex-key"
   ```

3. Workers decrypt JWT to access S3 directly

### Access Control

- Service registration requires the shared secret key
- API endpoints can be secured with additional authentication
- S3 credentials are never exposed in API responses

## Examples

### Trigger a Pipeline

```bash
curl -X POST http://localhost:3000/api/pipelines/pdf-processor/trigger \
  -H "Content-Type: application/json" \
  -d '{"pdfUrl": "https://example.com/doc.pdf", "extractTables": true}'
```

### Queue a Standalone Task

```bash
curl -X POST http://localhost:3000/api/queue/task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "process-document",
    "input": {"documentUrl": "https://..."},
    "priority": 50
  }'
```

### View Task Code History

```bash
curl http://localhost:3000/api/tasks/download/history
```

## Documentation

For complete documentation, see the [main specification](../../SPEC.md).

## License

MIT
