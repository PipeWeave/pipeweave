# Orchestrator Architecture

This document describes the architecture of the PipeWeave orchestrator implementation.

## Technology Stack

- **HTTP Framework**: Express.js v4.x
- **Database**: PostgreSQL via pg-promise
- **Validation**: Zod (from @pipeweave/shared)
- **Storage**: Multi-provider support (AWS S3, GCS, MinIO) via @pipeweave/shared

## Project Structure

```
src/
├── bin/
│   └── server.ts              # Express server entrypoint
│
├── routes/
│   ├── index.ts               # Route registration & middleware
│   ├── health.ts              # Health & info endpoints
│   ├── services.ts            # Service registration & management
│   ├── pipelines.ts           # Pipeline operations
│   ├── queue.ts               # Task queue + /api/tick
│   ├── tasks.ts               # Task execution (heartbeat, callback)
│   ├── runs.ts                # Run queries
│   ├── dlq.ts                 # Dead Letter Queue
│   └── storage.ts             # Storage backends & proxy
│
├── core/                      # Business logic (TBD)
│   ├── registry.ts            # Service & task registry
│   ├── queue-manager.ts       # Task scheduling
│   ├── executor.ts            # Task dispatcher
│   ├── poller.ts              # Standalone mode polling
│   ├── heartbeat-monitor.ts   # Heartbeat tracking
│   ├── retry-manager.ts       # Retry logic
│   ├── idempotency.ts         # Idempotency handling
│   └── dlq-manager.ts         # DLQ operations
│
├── pipeline/                  # Pipeline logic (TBD)
│   ├── validator.ts           # DAG validation
│   ├── graph.ts               # Graph analysis
│   └── executor.ts            # Pipeline execution
│
├── storage/
│   ├── jwt.ts                 # JWT encryption/decryption
│   └── client.ts              # Storage wrapper (TBD)
│
├── types/
│   └── internal.ts            # Internal types
│
├── db/
│   └── index.ts               # Database client (from cli, TBD: move)
│
├── orchestrator.ts            # Main Orchestrator class
├── maintenance.ts             # Maintenance mode
└── index.ts                   # Public exports
```

## Core Components

### 1. Orchestrator Class

Main orchestrator class that manages:
- Database connection lifecycle
- Storage backend configuration
- Maintenance mode state
- Graceful startup/shutdown

**Key Methods:**
- `start()` - Initialize database, check maintenance mode
- `stop()` - Graceful shutdown
- `getStorageBackend(id?)` - Get storage backend by ID
- `getDatabase()` - Get database instance
- `canAcceptTasks()` - Check maintenance mode

### 2. HTTP Server & Routes

The orchestrator creates its own Express server internally and exposes its functionality through HTTP routes.

**Usage Pattern:**
```typescript
const orchestrator = createOrchestrator(config);
await orchestrator.start();           // Initialize database & storage

const server = orchestrator.createServer();
await server.listen(3000, () => {     // Start HTTP server
  console.log('Ready!');
});
```

The orchestrator handles:
- Express app creation and configuration
- Route registration (all API endpoints)
- HTTP server lifecycle via `createServer()`
- Graceful shutdown (SIGTERM, SIGINT)

See `examples/orchestrator-setup/src/server.ts` for a complete example.

**Middleware Stack:**
- CORS support
- JSON/URL-encoded body parsing (10MB limit)
- Orchestrator attachment to request context
- Request logging (development only)

### 3. Route Modules

Each route module exports a registration function that takes `Express` and registers its endpoints.

**Implemented:**
- ✅ `health.ts` - Health check & orchestrator info
- ✅ `storage.ts` - Storage backends listing & proxy
- ⏳ `services.ts` - Service registration (stub)
- ⏳ `pipelines.ts` - Pipeline management (stub)
- ⏳ `queue.ts` - Queue operations + /api/tick (stub)
- ⏳ `tasks.ts` - Task execution (stub)
- ⏳ `runs.ts` - Run queries (stub)
- ⏳ `dlq.ts` - Dead Letter Queue (stub)

### 4. Storage System

**JWT-based credential encryption:**
- `encryptStorageToken()` - Encrypt backend config into JWT
- `decryptStorageToken()` - Decrypt JWT to get credentials
- Uses AES-256-GCM with PBKDF2 key derivation

**Multi-backend support:**
- Configured via `STORAGE_BACKENDS` JSON environment variable
- Each backend has unique ID, provider type, credentials
- Default backend marked with `isDefault: true`
- Workers use `createStorageProvider()` from @pipeweave/shared

### 5. Maintenance Mode

Three states:
- `running` - Accept and process tasks
- `waiting_for_maintenance` - No new tasks, waiting for completion
- `maintenance` - No tasks running, safe for migrations

**Transition Mechanism (Event-Driven):**
- Maintenance mode transitions are event-driven, triggered when task status changes
- When a task completes or fails, the system checks if auto-transition is needed
- No polling interval required - transitions happen immediately when conditions are met
- Works identically in both standalone and serverless modes

**Endpoints:**
- `requestMaintenance()` - Transition to waiting state
- `enterMaintenance()` - Enter maintenance (only if no tasks running)
- `exitMaintenance()` - Return to normal
- Auto-transition occurs when last task completes while in `waiting_for_maintenance` state

## API Endpoints

### Health & Info
- `GET /health` - Health check + maintenance status
- `GET /api/info` - Orchestrator info (version, mode, storage backends)

### Service Management
- `POST /api/register` - Worker registration
- `GET /api/services` - List services
- `GET /api/services/:id` - Service details
- `GET /api/services/:id/tasks` - Tasks for service

### Pipeline Management
- `GET /api/pipelines` - List pipelines
- `GET /api/pipelines/:id` - Pipeline details
- `POST /api/pipelines/:id/trigger` - Trigger pipeline
- `POST /api/pipelines/:id/dry-run` - Validate pipeline

### Task Queue
- `POST /api/queue/task` - Queue standalone task
- `POST /api/queue/batch` - Queue multiple tasks
- `GET /api/queue/status` - Queue statistics
- `GET /api/queue/items` - List queue items
- `POST /api/tick` - **Process pending tasks (serverless mode)**

### Task Execution
- `POST /api/heartbeat` - Worker heartbeat
- `POST /api/progress` - Task progress
- `POST /api/callback/:runId` - Task completion
- `GET /api/tasks/:id/history` - Code change history

### Run Queries
- `GET /api/runs` - List pipeline runs
- `GET /api/runs/:id` - Pipeline run details
- `GET /api/task-runs/:id` - Task run details

### Dead Letter Queue
- `GET /api/dlq` - List DLQ items
- `GET /api/dlq/:id` - DLQ item details
- `POST /api/dlq/:id/retry` - Retry DLQ item
- `POST /api/dlq/purge` - Purge old entries

### Storage
- `GET /api/storage/backends` - **List configured storage backends**
- `GET /api/storage/*` - Retrieve content via proxy

## Request Flow

### Service Registration
```
Worker                  Orchestrator               Database
  |                          |                         |
  |--POST /api/register----->|                         |
  |  {serviceId, tasks[]}    |                         |
  |                          |---INSERT service------->|
  |                          |---INSERT tasks--------->|
  |                          |---INSERT code_history-->|
  |                          |                         |
  |<-----200 OK--------------|                         |
  |  {codeChanges[]}         |                         |
```

### Task Execution (Future)
```
Orchestrator             Worker                    Storage
     |                      |                          |
     |--POST /tasks/:id---->|                          |
     |  {storageToken,      |                          |
     |   inputPath,         |                          |
     |   upstreamRefs}      |                          |
     |                      |                          |
     |                      |--Decrypt JWT------------>|
     |                      |<-Get credentials---------|
     |                      |                          |
     |                      |--Fetch input------------>|
     |                      |<-Input data--------------|
     |                      |                          |
     |                      |--Execute task            |
     |                      |                          |
     |                      |--Upload output---------->|
     |                      |                          |
     |<-POST /api/callback--|                          |
     |  {outputPath}        |                          |
     |                      |                          |
     |--200 OK------------->|                          |
```

### Serverless Mode (/api/tick)
```
Cloud Scheduler         Orchestrator              Database
      |                      |                        |
      |--POST /api/tick----->|                        |
      |                      |--Check maintenance---->|
      |                      |<-Mode: normal----------|
      |                      |                        |
      |                      |--Fetch pending tasks-->|
      |                      |<-Tasks[]---------------|
      |                      |                        |
      |                      |--Dispatch tasks        |
      |                      |  (to workers)          |
      |                      |                        |
      |<-200 OK--------------|                        |
      |  {processed: N}      |                        |
```

## Deployment Modes

### Standalone Mode
- Internal poller runs continuously (every `POLL_INTERVAL_MS`)
- Fetches pending tasks from database
- Dispatches to workers
- Suitable for: VMs, containers, dedicated servers

### Serverless Mode
- No internal poller
- External scheduler calls `POST /api/tick`
- Processes batch of pending tasks per invocation
- Suitable for: Cloud Run, Lambda, serverless platforms

**Configuration:**
```bash
MODE=serverless  # or 'standalone'
```

## Environment Configuration

**Required:**
- `DATABASE_URL` or `DB_HOST`/`DB_NAME`/`DB_USER`
- `STORAGE_BACKENDS` (JSON array of storage backend configurations)
- `PIPEWEAVE_SECRET_KEY` (32-byte hex)

**Optional:**
- `MODE` (default: `standalone`)
- `MAX_CONCURRENCY` (default: `10`)
- `POLL_INTERVAL_MS` (default: `1000`)
- `PORT` (default: `3000`)
- `DLQ_RETENTION_DAYS` (default: `30`)
- `IDEMPOTENCY_TTL_SECONDS` (default: `86400`)
- `MAX_RETRY_DELAY_MS` (default: `86400000`)

## Database Schema

**Note:** Schema and migrations are managed by the CLI package (`@pipeweave/cli`).

**Tables:**
- `services` - Registered workers
- `tasks` - Task definitions with code hashes
- `task_code_history` - Code change audit
- `pipelines` - Pipeline definitions
- `pipeline_runs` - Pipeline execution tracking
- `task_runs` - Individual task executions
- `dlq` - Dead letter queue
- `orchestrator_state` - Maintenance mode state

**Initialize:**
```bash
npx @pipeweave/cli db init --url $DATABASE_URL
```

## Security

### JWT Encryption
- **Algorithm**: AES-256-GCM
- **Key Derivation**: PBKDF2 (100,000 iterations)
- **Components**: Salt + IV + Auth Tag + Encrypted Payload
- **Encoding**: Base64URL (URL-safe)

### Storage Credentials
- Never exposed in API responses
- Encrypted in JWT tokens sent to workers
- Workers decrypt with shared `PIPEWEAVE_SECRET_KEY`
- Optional expiration (`exp` claim)

## Next Steps

### Phase 1: Service Registry (Priority 1)
- [ ] Implement `POST /api/register`
- [ ] Service storage in database
- [ ] Task code hash tracking
- [ ] Code version incrementing
- [ ] Orphan task cleanup

### Phase 2: Task Queue (Priority 2)
- [ ] Queue manager implementation
- [ ] Priority-based scheduling
- [ ] Concurrency limits per task type
- [ ] Queue status endpoint

### Phase 3: Task Execution (Priority 3)
- [ ] Task dispatcher (with JWT generation)
- [ ] Heartbeat monitoring
- [ ] Callback handling
- [ ] Retry logic with backoff
- [ ] Idempotency checking

### Phase 4: Pipeline Support (Priority 4)
- [ ] DAG validation
- [ ] Pipeline trigger
- [ ] Parallel execution
- [ ] Join task coordination
- [ ] Programmatic next selection

### Phase 5: Dead Letter Queue (Priority 5)
- [ ] DLQ storage
- [ ] Retry from DLQ
- [ ] Purge old entries

## Development

**Start development server:**
```bash
npm run dev
```

**Build:**
```bash
npm run build
```

**Type check:**
```bash
npm run typecheck
```

**Production:**
```bash
npm run build
npm start
```

## Implementation Phases

### Phase 1: Foundation ✅

**Status**: Complete

**Components:**
- ✅ Database connection & schema (via @pipeweave/cli)
- ✅ Maintenance mode logic (orchestrator.ts, maintenance.ts)
- ✅ Storage backend configuration (multi-provider support)
- ✅ Basic route structure (routes/*)
- ✅ JWT encryption/decryption (storage/jwt.ts)
- ✅ Internal types (types/internal.ts)
- ✅ Example server implementation (examples/orchestrator-setup)

**Files Created:**
- `src/routes/*.ts` (all route files with stubs)
- `src/storage/jwt.ts`
- `src/types/internal.ts`
- `.env.example`
- `examples/orchestrator-setup/src/server.ts`

---

### Phase 2: Core Execution ✅

**Status**: Complete

**Priority**: HIGH - Core functionality required for basic operation

#### 2.1 Service Registration ✅

**File**: `src/core/registry.ts`

**Database Tables Used:**
- `services` - Store service metadata
- `tasks` - Store task definitions with code hashes
- `task_code_history` - Track code changes

**Implementation Steps:**

1. **Create Registry Module** (`core/registry.ts`)
   ```typescript
   export class ServiceRegistry {
     constructor(private db: Database) {}

     async registerService(request: RegisterServiceRequest): Promise<RegisterServiceResponse>
     async getService(serviceId: string): Promise<RegisteredService | null>
     async listServices(): Promise<RegisteredService[]>
     async getTask(taskId: string): Promise<RegisteredTask | null>
     async listTasksForService(serviceId: string): Promise<RegisteredTask[]>
   }
   ```

2. **Implement Service Registration Logic**
   - Calculate code hash for each task (SHA-256)
   - Compare with existing hash in database
   - If hash changed:
     - Increment `code_version`
     - Insert into `task_code_history`
     - Return in `codeChanges` array
   - Update `services.last_seen_at`
   - Detect orphaned tasks (version changed + tasks removed)

3. **Database Queries Needed**
   ```sql
   -- Upsert service
   INSERT INTO services (service_id, version, base_url, registered_at, last_seen_at)
   VALUES ($1, $2, $3, NOW(), NOW())
   ON CONFLICT (service_id)
   DO UPDATE SET version = $2, base_url = $3, last_seen_at = NOW()
   RETURNING *;

   -- Upsert task with code version increment
   INSERT INTO tasks (task_id, service_id, code_hash, code_version, ...)
   VALUES ($1, $2, $3, 1, ...)
   ON CONFLICT (task_id)
   DO UPDATE SET
     code_hash = EXCLUDED.code_hash,
     code_version = CASE
       WHEN tasks.code_hash != EXCLUDED.code_hash
       THEN tasks.code_version + 1
       ELSE tasks.code_version
     END,
     ...
   RETURNING code_version, code_hash;

   -- Insert code history if changed
   INSERT INTO task_code_history (task_id, code_version, code_hash, service_version)
   SELECT $1, $2, $3, $4
   WHERE NOT EXISTS (
     SELECT 1 FROM task_code_history
     WHERE task_id = $1 AND code_hash = $3
   );
   ```

4. **Update Route Handler** (`routes/services.ts`)
   - Validate request with Zod schema
   - Call `registry.registerService()`
   - Return response with code changes

5. **Orphan Cleanup Logic**
   - On version change, find tasks in previous version not in new registration
   - Mark pending `task_runs` for orphaned tasks as `cancelled`
   - Set `error` to "Task type removed in version X.Y.Z"

**Implementation Complete:**
- ✅ SHA-256 code hash calculation
- ✅ Atomic service/task upsert with version tracking
- ✅ Code history recording on hash changes
- ✅ Orphan cleanup for removed tasks
- ✅ Service registration endpoint (`POST /api/register`)
- ✅ Service listing endpoints (`GET /api/services`, `/api/services/:id`)

---

#### 2.2 Task Queue Implementation ✅

**File**: `src/core/queue-manager.ts`

**Database Tables Used:**
- `task_runs` - Queue items

**Implementation Steps:**

1. **Create QueueManager Class**
   ```typescript
   export class QueueManager {
     constructor(private db: Database) {}

     async enqueue(taskId: string, input: unknown, options?: QueueOptions): Promise<string>
     async enqueueBatch(tasks: QueueTaskRequest[]): Promise<QueueTaskResponse[]>
     async getNext(limit: number): Promise<QueueItem[]>
     async markRunning(runId: string): Promise<void>
     async markCompleted(runId: string, result: TaskCallbackPayload): Promise<void>
     async markFailed(runId: string, error: string, errorCode?: string): Promise<void>
     async getStatus(): Promise<QueueStatusResponse>
     async canRunTask(taskId: string): Promise<boolean>
   }
   ```

2. **Priority Queue Logic**
   - Lower priority number = higher priority
   - Query orders by: `priority ASC, created_at ASC`
   - Check concurrency limits before dequeuing

3. **Database Queries**
   ```sql
   -- Enqueue task
   INSERT INTO task_runs (
     run_id, task_id, status, priority, input_path,
     attempt, max_retries, created_at, scheduled_at
   )
   VALUES (
     $1, $2, 'pending', $3, $4,
     1, $5, NOW(), NOW()
   )
   RETURNING run_id;

   -- Get next tasks (with concurrency check)
   WITH running_counts AS (
     SELECT task_id, COUNT(*) as running
     FROM task_runs
     WHERE status = 'running'
     GROUP BY task_id
   )
   SELECT tr.*
   FROM task_runs tr
   LEFT JOIN running_counts rc ON tr.task_id = rc.task_id
   LEFT JOIN tasks t ON tr.task_id = t.task_id
   WHERE tr.status = 'pending'
     AND tr.scheduled_at <= NOW()
     AND (t.concurrency = 0 OR COALESCE(rc.running, 0) < t.concurrency)
   ORDER BY tr.priority ASC, tr.created_at ASC
   LIMIT $1;

   -- Queue status
   SELECT
     status,
     COUNT(*) as count,
     MIN(created_at) as oldest
   FROM task_runs
   GROUP BY status;
   ```

4. **Update Route Handlers** (`routes/queue.ts`)
   - Implement `POST /api/queue/task`
   - Implement `POST /api/queue/batch`
   - Implement `GET /api/queue/status`
   - Implement `GET /api/queue/items`

**Implementation Complete:**
- ✅ Priority-based queue ordering (lower = higher priority)
- ✅ Concurrency limit checking per task type
- ✅ Idempotency key checking
- ✅ Batch queueing support
- ✅ Queue status aggregation
- ✅ Queue endpoints (`POST /api/queue/task`, `/api/queue/batch`, `GET /api/queue/status`)

---

#### 2.3 Task Dispatcher ✅

**File**: `src/core/executor.ts`

**Implementation Steps:**

1. **Create Executor Class**
   ```typescript
   export class TaskExecutor {
     constructor(
       private db: Database,
       private orchestrator: Orchestrator,
       private registry: ServiceRegistry,
       private secretKey: string
     ) {}

     async dispatch(queueItem: QueueItem): Promise<void>
     private async buildDispatchPayload(item: QueueItem): Promise<TaskDispatchPayload>
     private async loadUpstreamOutputs(item: QueueItem): Promise<Record<string, any>>
     private async httpPost(url: string, payload: unknown): Promise<Response>
   }
   ```

2. **Dispatch Flow**
   ```
   1. Get task definition from registry
   2. Get service base URL
   3. Load upstream task outputs (if pipeline)
   4. Generate storage JWT token
   5. Build TaskDispatchPayload
   6. POST to {baseUrl}/tasks/{taskId}
   7. Store dispatch time in database
   ```

3. **JWT Token Generation**
   ```typescript
   const storageBackend = orchestrator.getDefaultStorageBackend();
   const storageToken = encryptStorageToken(
     storageBackend,
     secretKey,
     3600 // 1 hour expiration
   );
   ```

4. **Build Dispatch Payload**
   ```typescript
   const payload: TaskDispatchPayload = {
     runId: item.runId,
     taskId: item.taskId,
     pipelineRunId: item.pipelineRunId,
     attempt: item.attempt,
     codeVersion: task.codeVersion,
     codeHash: task.codeHash,
     storageToken,
     inputPath: item.inputPath,
     upstreamRefs: await this.loadUpstreamOutputs(item),
     previousAttempts: await this.getPreviousAttempts(item.runId),
     heartbeatIntervalMs: task.heartbeatIntervalMs,
   };
   ```

5. **HTTP POST to Worker**
   ```typescript
   const url = `${service.baseUrl}/tasks/${taskId}`;
   const response = await fetch(url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(payload),
     signal: AbortSignal.timeout(5000), // 5s timeout for dispatch
   });
   ```

6. **Error Handling**
   - Worker unreachable → Mark as failed, schedule retry
   - Worker returns 4xx → Mark as failed (non-retryable)
   - Worker returns 5xx → Mark as failed, schedule retry
   - Timeout → Mark as timeout, schedule retry

**Implementation Complete:**
- ✅ JWT generation with storage credentials
- ✅ HTTP POST to worker endpoints with 5s timeout
- ✅ Task dispatch payload building
- ✅ Error handling (offline, 4xx, 5xx responses)
- ✅ Automatic failure marking on dispatch errors

---

#### 2.4 Heartbeat Monitoring ✅

**File**: `src/core/heartbeat-monitor.ts`

**Implementation Steps:**

1. **Create HeartbeatMonitor Class**
   ```typescript
   export class HeartbeatMonitor {
     private trackers: Map<string, HeartbeatTracker> = new Map();

     constructor(private db: Database) {}

     startTracking(runId: string, taskId: string, heartbeatIntervalMs: number): void
     recordHeartbeat(runId: string, progress?: number, message?: string): Promise<void>
     cancelTracking(runId: string): void
     private handleTimeout(runId: string): Promise<void>
   }
   ```

2. **Start Tracking on Dispatch**
   ```typescript
   startTracking(runId: string, taskId: string, heartbeatIntervalMs: number) {
     const timeoutMs = heartbeatIntervalMs * 2;

     const tracker: HeartbeatTracker = {
       runId,
       taskId,
       startedAt: new Date(),
       lastHeartbeat: new Date(),
       timeoutMs,
       timeoutHandle: setTimeout(() => {
         this.handleTimeout(runId);
       }, timeoutMs),
     };

     this.trackers.set(runId, tracker);
   }
   ```

3. **Record Heartbeat**
   ```typescript
   async recordHeartbeat(runId: string, progress?: number, message?: string) {
     const tracker = this.trackers.get(runId);
     if (!tracker) return; // Task already completed

     // Update database
     await this.db.none(
       'UPDATE task_runs SET progress = $1, progress_message = $2, last_heartbeat = NOW() WHERE run_id = $3',
       [progress, message, runId]
     );

     // Reset timeout
     if (tracker.timeoutHandle) {
       clearTimeout(tracker.timeoutHandle);
     }

     tracker.lastHeartbeat = new Date();
     tracker.timeoutHandle = setTimeout(() => {
       this.handleTimeout(runId);
     }, tracker.timeoutMs);
   }
   ```

4. **Handle Timeout**
   ```typescript
   private async handleTimeout(runId: string) {
     const tracker = this.trackers.get(runId);
     if (!tracker) return;

     // Mark as timeout in database
     await this.db.none(
       'UPDATE task_runs SET status = $1, error = $2, error_code = $3, completed_at = NOW() WHERE run_id = $4',
       ['timeout', 'Task heartbeat timeout', 'TIMEOUT', runId]
     );

     // Schedule retry if retries remaining
     // ... retry logic ...

     this.trackers.delete(runId);
   }
   ```

5. **Cancel on Callback**
   ```typescript
   cancelTracking(runId: string) {
     const tracker = this.trackers.get(runId);
     if (tracker?.timeoutHandle) {
       clearTimeout(tracker.timeoutHandle);
     }
     this.trackers.delete(runId);
   }
   ```

6. **Update Route Handler** (`routes/tasks.ts`)
   - Implement `POST /api/heartbeat`
   - Call `heartbeatMonitor.recordHeartbeat()`

**Implementation Complete:**
- ✅ In-memory heartbeat tracking with Map
- ✅ Timeout = 2× heartbeatIntervalMs
- ✅ Automatic timeout handling and task failure
- ✅ Timeout cancellation on callback
- ✅ Heartbeat endpoint (`POST /api/heartbeat`)

---

#### 2.5 Callback Handling ✅

**File**: Update `routes/tasks.ts` and create retry logic

**Implementation Steps:**

1. **Implement Callback Endpoint**
   ```typescript
   app.post('/api/callback/:runId', async (req: OrchestratorRequest, res) => {
     const { runId } = req.params;
     const payload = TaskCallbackPayloadSchema.parse(req.body);

     // Cancel heartbeat timeout
     heartbeatMonitor.cancelTracking(runId);

     if (payload.status === 'success') {
       await handleSuccess(runId, payload);
       await queueDownstreamTasks(runId, payload);
     } else {
       await handleFailure(runId, payload);
     }

     res.json({ acknowledged: true });
   });
   ```

2. **Handle Success**
   ```typescript
   async function handleSuccess(runId: string, payload: TaskCallbackPayload) {
     await db.none(`
       UPDATE task_runs
       SET status = 'completed',
           output_path = $1,
           output_size = $2,
           logs_path = $3,
           completed_at = NOW()
       WHERE run_id = $4
     `, [payload.outputPath, payload.outputSize, payload.logsPath, runId]);

     // Store assets metadata
     if (payload.assets) {
       for (const [key, asset] of Object.entries(payload.assets)) {
         await db.none(`
           INSERT INTO task_assets (run_id, key, path, size, type)
           VALUES ($1, $2, $3, $4, $5)
         `, [runId, key, asset.path, asset.size, asset.type]);
       }
     }
   }
   ```

3. **Handle Failure**
   ```typescript
   async function handleFailure(runId: string, payload: TaskCallbackPayload) {
     const taskRun = await db.one('SELECT * FROM task_runs WHERE run_id = $1', [runId]);

     if (taskRun.attempt < taskRun.max_retries) {
       // Schedule retry
       await retryManager.scheduleRetry(taskRun);
     } else {
       // Move to DLQ
       await dlqManager.add(taskRun, payload.error!);
       await db.none(`
         UPDATE task_runs
         SET status = 'failed', error = $1, error_code = $2, completed_at = NOW()
         WHERE run_id = $3
       `, [payload.error, payload.errorCode, runId]);
     }
   }
   ```

4. **Queue Downstream Tasks**
   ```typescript
   async function queueDownstreamTasks(runId: string, payload: TaskCallbackPayload) {
     const taskRun = await db.one('SELECT * FROM task_runs WHERE run_id = $1', [runId]);
     const task = await registry.getTask(taskRun.task_id);

     // Determine which tasks to run next
     let nextTaskIds = task.allowedNext;
     if (payload.selectedNext && payload.selectedNext.length > 0) {
       // Programmatic next selection
       nextTaskIds = payload.selectedNext.filter(id => task.allowedNext.includes(id));
     }

     // Queue all next tasks
     for (const nextTaskId of nextTaskIds) {
       await queueManager.enqueue(nextTaskId, {
         pipelineRunId: taskRun.pipeline_run_id,
         // ... pass context ...
       });
     }
   }
   ```

**Implementation Complete:**
- ✅ Success handling with output metadata storage
- ✅ Failure handling with retry scheduling
- ✅ Exponential/fixed backoff calculation
- ✅ DLQ addition after exhausting retries
- ✅ Idempotency result caching
- ✅ Callback endpoint (`POST /api/callback/:runId`)
- ✅ Retry Manager (`src/core/retry-manager.ts`)
- ✅ DLQ Manager (`src/core/dlq-manager.ts`)
- ✅ Idempotency Manager (`src/core/idempotency.ts`)

---

#### 2.6 Standalone Poller ✅

**File**: `src/core/poller.ts`

**Implementation Steps:**

1. **Create Poller Class**
   ```typescript
   export class TaskPoller {
     private intervalHandle?: NodeJS.Timeout;
     private isRunning = false;

     constructor(
       private queueManager: QueueManager,
       private executor: TaskExecutor,
       private heartbeatMonitor: HeartbeatMonitor,
       private maxConcurrency: number,
       private pollIntervalMs: number
     ) {}

     start(): void
     stop(): void
     private async poll(): Promise<void>
   }
   ```

2. **Polling Loop**
   ```typescript
   start() {
     if (this.isRunning) return;
     this.isRunning = true;

     this.intervalHandle = setInterval(async () => {
       await this.poll();
     }, this.pollIntervalMs);

     console.log(`[Poller] Started (interval: ${this.pollIntervalMs}ms)`);
   }

   private async poll() {
     try {
       // Get pending tasks
       const tasks = await this.queueManager.getNext(this.maxConcurrency);

       if (tasks.length === 0) return;

       console.log(`[Poller] Dispatching ${tasks.length} tasks`);

       // Dispatch in parallel
       await Promise.allSettled(
         tasks.map(async (task) => {
           try {
             await this.executor.dispatch(task);

             // Start heartbeat monitoring
             const taskDef = await registry.getTask(task.taskId);
             this.heartbeatMonitor.startTracking(
               task.runId,
               task.taskId,
               taskDef.heartbeatIntervalMs
             );
           } catch (error) {
             console.error(`[Poller] Dispatch failed for ${task.runId}:`, error);
             await this.queueManager.markFailed(
               task.runId,
               error instanceof Error ? error.message : 'Unknown error',
               'DISPATCH_FAILED'
             );
           }
         })
       );
     } catch (error) {
       console.error('[Poller] Poll error:', error);
     }
   }
   ```

3. **Integration with Orchestrator**
   ```typescript
   // In orchestrator.ts
   async start() {
     // ... existing startup ...

     if (this.config.mode === 'standalone') {
       this.poller = new TaskPoller(
         this.queueManager,
         this.executor,
         this.heartbeatMonitor,
         this.config.maxConcurrency,
         this.config.pollIntervalMs
       );
       this.poller.start();
       console.log('[PipeWeave] Poller started');
     }
   }
   ```

4. **Update /api/tick for Serverless** (`routes/queue.ts`)
   ```typescript
   app.post('/api/tick', async (req: OrchestratorRequest, res) => {
     // ... existing checks ...

     // Manual poll trigger
     const tasks = await queueManager.getNext(config.maxConcurrency);

     await Promise.allSettled(
       tasks.map(task => executor.dispatch(task))
     );

     res.json({
       status: 'ok',
       processed: tasks.length,
       timestamp: new Date().toISOString(),
     });
   });
   ```

**Implementation Complete:**
- ✅ Polling loop with configurable interval
- ✅ Automatic task fetching and dispatching
- ✅ Heartbeat monitoring integration
- ✅ Error handling and retry scheduling
- ✅ Graceful startup/shutdown
- ✅ Serverless mode support via `/api/tick`
- ✅ Manual poll trigger for serverless mode
- ✅ Task Poller (`src/core/poller.ts`)
- ✅ Integration with Orchestrator class

**Phase 2 Summary:**

All core execution components are now implemented and integrated:
- Service registration with code versioning
- Task queueing with priority and concurrency controls
- Task dispatching to workers via HTTP
- Heartbeat monitoring with timeout detection
- Callback handling with retry logic and DLQ
- Standalone polling mode for autonomous operation
- Serverless mode support via manual tick endpoint

The orchestrator can now:
- Accept worker registrations
- Queue standalone tasks
- Dispatch tasks to workers
- Monitor execution via heartbeats
- Handle success/failure callbacks
- Retry failed tasks with configurable backoff
- Move failed tasks to DLQ after retries exhausted
- Support both standalone and serverless deployment modes

---

### Phase 3: Pipeline Support

**Priority**: MEDIUM - Required for DAG workflows

#### 3.1 Pipeline DAG Validation

**File**: `src/pipeline/validator.ts`

**Implementation Steps:**

1. **Create PipelineValidator**
   - Build graph from task definitions
   - Detect cycles using DFS
   - Validate `allowedNext` references exist
   - Check for disconnected subgraphs
   - Identify entry and end nodes

2. **Topological Sort**
   - Determine execution levels
   - Identify parallel vs sequential tasks

3. **Dry-Run Endpoint**
   - Validate without executing
   - Return execution plan
   - Show warnings (e.g., concurrency limits)

**Database Queries:**
```sql
-- Get all tasks for pipeline
SELECT * FROM tasks WHERE task_id IN (...);

-- Validate pipeline structure
INSERT INTO pipelines (pipeline_id, structure, entry_tasks, end_tasks)
VALUES ($1, $2, $3, $4);
```

---

#### 3.2 Pipeline Trigger

**File**: `src/pipeline/executor.ts`

**Implementation Steps:**

1. **Create Pipeline Execution Logic**
   - Store pipeline input in S3
   - Create `pipeline_runs` entry
   - Queue entry tasks with pipeline context
   - Track pipeline status

2. **Join Task Coordination**
   - Track upstream completions
   - Only queue join task when all predecessors complete

3. **Programmatic Next Selection**
   - Respect `allowedNext` constraints
   - Validate selected tasks are in allowed list

**Database Queries:**
```sql
-- Create pipeline run
INSERT INTO pipeline_runs (pipeline_run_id, pipeline_id, status, input_path)
VALUES ($1, $2, 'running', $3)
RETURNING *;

-- Queue entry tasks
INSERT INTO task_runs (run_id, task_id, pipeline_run_id, ...)
VALUES ...;

-- Check if join task ready
SELECT COUNT(*) = (
  SELECT COUNT(*) FROM task_dependencies WHERE task_id = $1
) as all_complete
FROM task_runs
WHERE pipeline_run_id = $2
  AND task_id IN (SELECT upstream_task_id FROM task_dependencies WHERE task_id = $1)
  AND status = 'completed';
```

---

### Phase 4: Reliability

**Priority**: HIGH - Production readiness

#### 4.1 Retry Logic with Backoff

**File**: `src/core/retry-manager.ts`

**Implementation Steps:**

1. **Calculate Retry Delay**
   ```typescript
   function calculateRetryDelay(strategy: RetryStrategy): number {
     if (strategy.retryBackoff === 'fixed') {
       return strategy.retryDelayMs;
     }

     // Exponential: delay = min(base * 2^(attempt-1), max)
     const exponentialDelay = strategy.retryDelayMs * Math.pow(2, strategy.attempt - 1);
     return Math.min(exponentialDelay, strategy.maxRetryDelayMs);
   }
   ```

2. **Schedule Retry**
   ```sql
   UPDATE task_runs
   SET status = 'pending',
       attempt = attempt + 1,
       scheduled_at = NOW() + INTERVAL '$1 milliseconds'
   WHERE run_id = $2;
   ```

---

#### 4.2 Idempotency Checking

**File**: `src/core/idempotency.ts`

**Implementation Steps:**

1. **Check Idempotency Key**
   ```sql
   SELECT output_path, output_size
   FROM task_runs
   WHERE task_id = $1
     AND idempotency_key = $2
     AND status = 'completed'
     AND completed_at > NOW() - INTERVAL '$3 seconds';
   ```

2. **Return Cached Result**
   - Skip execution
   - Still queue downstream tasks
   - Record as `completed` with cached output

---

#### 4.3 Dead Letter Queue

**File**: `src/core/dlq-manager.ts`

**Implementation Steps:**

1. **Add to DLQ**
   ```sql
   INSERT INTO dlq (dlq_id, task_run_id, task_id, pipeline_run_id, error, attempts, input_path)
   VALUES ($1, $2, $3, $4, $5, $6, $7);
   ```

2. **Retry from DLQ**
   - Queue new task run with current code version
   - Mark DLQ entry as retried

3. **Purge Old Entries**
   ```sql
   DELETE FROM dlq
   WHERE created_at < NOW() - INTERVAL '$1 days';
   ```

---

### Phase 5: Observability

**Priority**: LOW - Nice to have

#### 5.1 Queue Status

Implement detailed queue metrics.

#### 5.2 Run Queries

Implement filtering and pagination for runs.

#### 5.3 Code History Tracking

Already implemented in Phase 2.1, expose via endpoints.

#### 5.4 Storage Proxy

Already implemented in routes/storage.ts.

---

## Testing Strategy

**Unit Tests:**
- JWT encryption/decryption
- Retry calculation logic
- DAG validation
- Queue priority ordering

**Integration Tests:**
- Service registration flow
- Task execution flow
- Pipeline execution
- Maintenance mode transitions

**E2E Tests:**
- Full pipeline execution
- Worker registration + task dispatch
- Heartbeat timeout handling
- DLQ retry flow
