# PipeWeave

**A lightweight, debuggable task orchestration framework for serverless architectures**

---

## Table of Contents

1. [Overview](#overview)
2. [Philosophy & Design Goals](#philosophy--design-goals)
3. [Architecture](#architecture)
4. [Core Concepts](#core-concepts)
5. [SDK Reference](#sdk-reference)
6. [Web UI](#web-ui)
7. [CLI Reference](#cli-reference)
8. [Orchestrator](#orchestrator)
9. [Deployment Modes](#deployment-modes)
10. [Storage & Data Flow](#storage--data-flow)
11. [Error Handling & Reliability](#error-handling--reliability)
12. [Example: PDF Processing Pipeline](#example-pdf-processing-pipeline)
13. [Configuration Reference](#configuration-reference)
14. [Development Workflow](#development-workflow)
15. [Comparison with Alternatives](#comparison-with-alternatives)

---

## Overview

PipeWeave is a minimal task orchestration system designed for teams who need:

- **Local debuggability** — Set breakpoints in your IDE and step through task handlers
- **Serverless-first** — Deploy tasks anywhere (Cloud Run, Lambda, Kubernetes, bare metal)
- **Programmatic pipeline definition** — Define workflows in code with dynamic routing
- **Simple data passing** — Single hydrated context per task with automatic S3 persistence
- **Reliable execution** — Heartbeat monitoring, automatic retries, timeout handling

PipeWeave consists of four components:

| Component        | Purpose                                                           |
| ---------------- | ----------------------------------------------------------------- |
| **SDK**          | Register tasks, define pipelines, auto-register with orchestrator |
| **Orchestrator** | Execute pipelines, manage hydration, handle retries               |
| **CLI**          | Trigger pipelines, manage database, view services                 |
| **Web UI**       | Monitor multiple orchestrators, view runs, trigger pipelines      |

### Key Features

- **Auto-Registration** — Workers register with orchestrator on startup, no manual deployment
- **Programmatic Next Selection** — Tasks can dynamically choose which tasks run next
- **Heartbeat Monitoring** — Workers report health; orchestrator detects stalled tasks
- **Task Concurrency** — Limit concurrent executions per task type
- **Orphan Cleanup** — Pending tasks for removed task types are automatically cancelled on version change
- **Dead Letter Queue** — Failed tasks after all retries are preserved for inspection
- **Idempotent Execution** — Built-in support for safe task retries

---

## Philosophy & Design Goals

### 1. Tasks Are Just Functions

```typescript
worker.register("process", async (ctx) => {
  const data = ctx.input;
  return { processed: true };
});
```

No decorators, no magic, no framework lock-in. Your business logic is a plain async function.

### 2. Local-First Development

Every task can run locally with full debugger support:

```typescript
// Set breakpoints anywhere in your handler
const result = await runLocal(worker, "process", { data: "..." });
```

### 3. Pipelines Defined in Code

Pipelines emerge from task relationships:

```typescript
worker.register("fetch", { allowedNext: ["transform"] }, handler);
worker.register("transform", { allowedNext: ["load"] }, handler);
worker.register("load", {}, handler); // End of pipeline
```

### 4. Hydration Over Message Passing

Tasks receive a **hydrated context** — a single JSON object containing all data they need.

### 5. HTTP as the Universal Protocol

Tasks are HTTP endpoints. Deploy anywhere that can serve HTTP.

### 6. Idempotency by Design

Tasks should be idempotent — running the same task twice with the same input produces the same result. PipeWeave provides tools to support this pattern.

---

## Architecture

```mermaid
flowchart TB
    subgraph UI["🖥️ Web UI (Next.js)"]
        Dashboard["Dashboard"]
        Monitor["Monitoring"]
        CodeHist["Code History"]
        DLQ["Dead Letter Queue"]
    end

    subgraph Orchestrator["⚙️ Orchestrator"]
        PM[Pipeline Manager]
        QE[Queue & Executor]
        RR[Retry & Recovery]
        JWT[JWT Generator]
        CH[Code Hash Tracker]
        DLQMgr[DLQ Manager]
    end

    DB[(PostgreSQL<br/>State & Metadata)]
    S3[(S3 / MinIO<br/>Outputs & Assets)]

    subgraph Services["🔧 Workers"]
        subgraph W1["Worker"]
            Dec[JWT Decrypt]
            Hyd[Hydration]
            Exec[Execute]
            Deh[Dehydration]
            TmpStore[Temp Storage]
        end
    end

    subgraph CLI["💻 CLI"]
        Deploy["deploy"]
        DBCmd["db init/migrate"]
        DryRun["dry-run"]
    end

    UI -->|HTTP API| Orchestrator
    CLI -->|HTTP API| Orchestrator
    CLI -->|Direct| DB
    Orchestrator <--> DB
    Orchestrator -->|JWT + Task Info| Services
    Services -->|Direct S3 Access| S3
    Services -->|Metadata Only| Orchestrator
```

### Worker-Side Hydration with JWT

**Key Design:** Workers load data directly from S3 using JWT-encrypted credentials. The orchestrator only sends metadata — workers handle all data I/O.

```mermaid
flowchart LR
    subgraph Orchestrator
        JWT["Generate JWT<br/>(encrypted S3 creds)"]
        Meta["Send metadata:<br/>• upstreamRefs (S3 paths)<br/>• initialInput"]
    end

    subgraph Worker
        Dec["1. Decrypt JWT"]
        Load["2. Load upstream from S3"]
        Build["3. Build context"]
        Exec["4. Execute (assets in temp dir)"]
        Store["5. Dehydrate to S3"]
        Clean["6. Cleanup temp files"]
        CB["7. Callback (metadata only)"]
    end

    JWT --> Dec
    Meta --> Load
    Dec --> Load
    Load --> Build --> Exec --> Store --> Clean --> CB
```

### Security Model

```
┌─────────────────────────────────────────────────────────────────┐
│  Shared Secret Key (PIPEWEAVE_SECRET_KEY)                       │
│  ────────────────────────────────────────                       │
│  • Set on orchestrator and all workers                          │
│  • Used to encrypt/decrypt JWT containing S3 credentials        │
│  • AES-256-GCM encryption with auth tag                         │
│                                                                 │
│  JWT Payload (encrypted):                                       │
│  {                                                              │
│    "endpoint": "https://s3.amazonaws.com",                      │
│    "bucket": "pipeweave-data",                                  │
│    "accessKey": "AKIA...",                                      │
│    "secretKey": "..."                                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

### Temporary Asset Storage & Dehydration

During task execution, assets are stored in a **local temporary directory**. After the task completes successfully, all assets are persisted to S3 (**dehydration**), and the temporary files are cleaned up.

```mermaid
flowchart TB
    subgraph Execution["During Execution"]
        Add["ctx.addAsset('file', 'binary', data)"]
        Tmp["Temp Directory<br/>/tmp/pipeweave/{runId}/"]
        Get["ctx.getAsset('file')"]
    end

    subgraph After["After Success"]
        Persist["Upload all assets to S3"]
        Cleanup["Delete temp directory"]
        Meta["Send metadata to orchestrator:<br/>{ path, size, type }"]
    end

    subgraph OnFailure["On Failure"]
        CleanupFail["Delete temp directory<br/>(no orphan files in S3)"]
    end

    Add --> Tmp
    Tmp --> Get
    Execution --> |"Task succeeds"| Persist
    Persist --> Cleanup --> Meta
    Execution --> |"Task fails"| CleanupFail
```

**Benefits:**

- Failed tasks don't leave orphan files in S3
- Handles large files without memory pressure
- Atomic: all assets written together on success
- Automatic cleanup prevents disk space issues

**Configuration:**

```typescript
const worker = createWorker({
  // ...
  tempDir: "/tmp/pipeweave", // Default temp directory base
  tempCleanupOnFailure: true, // Clean temp files on failure (default: true)
});
```

### Task Code Hashing & Versioning

Every task handler is hashed on registration. The orchestrator tracks changes and maintains a simple integer version number (`codeVersion`) that increments on every code change.

```typescript
// Worker calculates hash from function source
const codeHash = sha256(handler.toString()).substring(0, 16);

// Example output on worker startup:
// [PipeWeave] Task code hashes:
//   • download [a3f8b2c1d4e5f6a7] v3 → [extract-text, extract-tables]
//   • extract-text [b4c9d0e1f2a3b4c5] v1 → [summarize]
```

The orchestrator tracks code changes:

- Stores current `code_hash` and `code_version` in `tasks` table
- `code_version` starts at 1 and increments on every hash change
- Records history in `task_code_history` table
- Returns `codeChanges` array on registration with old/new versions
- UI can show which tasks have changed and their version history

```
┌─────────────────────────────────────────────────────────────────┐
│  Code Version Tracking                                          │
│  ─────────────────────                                          │
│                                                                 │
│  tasks table:                                                   │
│  ┌──────────────┬──────────────────┬──────────────┐            │
│  │ task_id      │ code_hash        │ code_version │            │
│  ├──────────────┼──────────────────┼──────────────┤            │
│  │ download     │ a3f8b2c1d4e5f6a7 │ 3            │            │
│  │ extract-text │ b4c9d0e1f2a3b4c5 │ 1            │            │
│  └──────────────┴──────────────────┴──────────────┘            │
│                                                                 │
│  On code change:                                                │
│    1. New hash detected                                         │
│    2. code_version++                                            │
│    3. Record in task_code_history                               │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Sequence

```mermaid
sequenceDiagram
    autonumber
    participant Client
    participant Orchestrator
    participant DB as PostgreSQL
    participant Worker
    participant S3
    participant TmpDir as Temp Directory

    Client->>Orchestrator: Trigger Pipeline
    Orchestrator->>DB: Create runs (with code_hash)

    Note over Orchestrator: Generate JWT with S3 creds
    Orchestrator->>Worker: POST /tasks/a<br/>{storageToken, upstreamRefs, initialInput, heartbeatIntervalMs}

    Worker->>Worker: Decrypt JWT → S3 credentials
    Worker->>S3: Load upstream outputs (direct)
    Worker->>Worker: Build hydration context

    loop Every heartbeatIntervalMs
        Worker-->>Orchestrator: POST /api/heartbeat
    end

    Worker->>TmpDir: Store assets during execution
    Worker->>Worker: Execute task handler

    Note over Worker: Dehydration (on success)
    Worker->>S3: Upload output + all assets from temp
    Worker->>TmpDir: Delete temp directory
    Worker-->>Orchestrator: Callback {outputPath, outputSize, assets}

    Note over Orchestrator: Callback cancels heartbeat timeout
    Orchestrator->>DB: Store metadata (paths only)
    Orchestrator-->>Client: Pipeline Complete
```

---

## Core Concepts

### Tasks

A task is an async function registered with a unique ID:

```typescript
worker.register(
  "task-id", // Unique identifier
  {
    /* options */
  }, // Configuration
  async (ctx) => {
    // Handler function
    return output;
  }
);
```

#### Task Options

| Option                | Type                             | Default         | Description                                                   |
| --------------------- | -------------------------------- | --------------- | ------------------------------------------------------------- |
| `allowedNext`         | `string[]`                       | `[]`            | **Allowed** next task IDs (for programmatic selection)        |
| `timeout`             | `number`                         | `300`           | Timeout in seconds                                            |
| `retries`             | `number`                         | `3`             | Maximum retry attempts                                        |
| `retryBackoff`        | `'fixed' \| 'exponential'`       | `'exponential'` | Backoff strategy                                              |
| `retryDelayMs`        | `number`                         | `1000`          | Base delay between retries                                    |
| `maxRetryDelayMs`     | `number`                         | `86400000`      | Maximum retry delay (default: 24 hours)                       |
| `heartbeatIntervalMs` | `number`                         | `60000`         | Heartbeat interval for this task                              |
| `concurrency`         | `number`                         | `0` (unlimited) | Max concurrent executions of this task                        |
| `priority`            | `number`                         | `100`           | Default priority for this task type (lower = higher priority) |
| `idempotencyKey`      | `(input, codeVersion) => string` | —               | Function to generate idempotency key                          |
| `idempotencyTTL`      | `number`                         | `86400`         | How long to cache idempotent results (seconds)                |
| `description`         | `string`                         | —               | Human-readable description                                    |

#### Task Concurrency

Limit how many instances of a task can run simultaneously:

```typescript
worker.register(
  "call-api",
  {
    allowedNext: ["process-response"],
    concurrency: 5, // Max 5 concurrent API calls
    timeout: 30,
  },
  async (ctx) => {
    // Rate-limited API call
    const response = await rateLimitedApi.call(ctx.input);
    return response;
  }
);

worker.register(
  "heavy-processing",
  {
    concurrency: 2, // Only 2 concurrent (resource-intensive)
    timeout: 600,
  },
  async (ctx) => {
    // CPU/memory intensive work
    return processLargeFile(ctx.input);
  }
);
```

**Use cases:**

- **Rate-limited APIs** — Prevent exceeding API quotas
- **Resource-intensive tasks** — Limit CPU/memory usage
- **Database connections** — Control connection pool pressure
- **External service limits** — Respect third-party constraints

The orchestrator tracks running tasks per `task_id` and only dispatches new tasks when below the limit.

#### Task Priority

Set default priority for task types. Tasks with lower priority values are executed first:

```typescript
worker.register(
  "critical-task",
  {
    priority: 10, // High priority (low number)
  },
  handler
);

worker.register(
  "background-task",
  {
    priority: 200, // Low priority (high number)
  },
  handler
);
```

Priority can also be overridden per-instance when queuing:

```bash
curl -X POST http://localhost:3000/api/queue/task \
  -d '{"taskId": "background-task", "input": {...}, "priority": 5}'
```

#### Task Context (`ctx`)

```typescript
interface TaskContext<TInput> {
  runId: string; // Unique task run ID
  pipelineRunId?: string; // Pipeline run ID
  attempt: number; // Current attempt (1, 2, 3...)

  // Task code information
  codeVersion: number; // Integer version, increments on code change
  codeHash: string; // SHA-256 hash of task handler (16 chars)

  input: TInput; // Hydrated input data
  upstream: Record<string, any>; // All upstream task outputs

  // Previous attempt information (for retry logic)
  previousAttempts: Array<{
    attempt: number;
    error: string;
    errorCode?: string;
    timestamp: Date;
  }>;

  addAsset(key, type, data): Promise<string>; // Persist for downstream
  getAsset(key): Promise<any>; // Load upstream asset

  progress(percent, message?): Promise<void>; // Report progress
  log: Logger; // Logging
}
```

The `codeVersion` and `codeHash` are useful for:

- Logging which code version processed a request
- Debugging issues across deployments
- Custom idempotency logic that considers code changes

#### Intelligent Retry Logic

Use `previousAttempts` to implement intelligent retry behavior:

```typescript
worker.register(
  "call-external-api",
  {
    retries: 5,
    retryBackoff: "exponential",
  },
  async (ctx) => {
    // Check if previous failure was rate-limiting
    const lastAttempt = ctx.previousAttempts[ctx.previousAttempts.length - 1];
    if (lastAttempt?.errorCode === "RATE_LIMITED") {
      // Wait extra time before retrying
      await sleep(5000);
    }

    try {
      return await externalApi.call(ctx.input);
    } catch (error) {
      // Attach error code for next retry's context
      throw new TaskError(error.message, { code: error.code });
    }
  }
);
```

#### Programmatic Next Selection

Tasks can dynamically choose which tasks run next by returning a `TaskResult`:

```typescript
import { TaskResult } from "@pipeweave/sdk";

worker.register(
  "router",
  {
    // Define ALL possible next tasks
    allowedNext: ["path-a", "path-b", "path-c"],
  },
  async (ctx): Promise<TaskResult> => {
    const { condition } = ctx.input;

    // Choose next tasks programmatically
    if (condition === "fast") {
      return { output: { result: "done" }, runNext: ["path-a"] };
    } else {
      // Run multiple in parallel
      return { output: { result: "done" }, runNext: ["path-b", "path-c"] };
    }
  }
);
```

**Rules:**

- `allowedNext` in options defines **allowed** tasks (validated at runtime)
- Return `TaskResult` with `runNext` to select which tasks run
- Omit `runNext` in return to run ALL allowed tasks (default behavior)
- Selected tasks run in parallel if multiple specified

#### Heartbeat

Workers automatically send heartbeats to the orchestrator while tasks run. The heartbeat interval is configured per-task and sent to the orchestrator during registration:

```typescript
worker.register(
  "long-task",
  {
    heartbeatIntervalMs: 30000, // Every 30 seconds
    timeout: 600,
  },
  handler
);

worker.register(
  "quick-task",
  {
    heartbeatIntervalMs: 60000, // Every 60 seconds (default)
    timeout: 60,
  },
  handler
);
```

**How it works:**

1. Worker registers task with its `heartbeatIntervalMs`
2. Orchestrator stores the interval in the `tasks` table
3. When dispatching a task, orchestrator calculates timeout as `2 × heartbeatIntervalMs`
4. Worker sends heartbeats at the configured interval
5. If no heartbeat received within timeout, task is marked failed

**Timeout Cancellation:**

- When the orchestrator receives a task callback (success or failure), any pending heartbeat timeout is immediately cancelled
- This prevents race conditions where a completed task could be marked as failed due to timing issues

```
┌─────────────────────────────────────────────────────────────────┐
│  Heartbeat Flow                                                 │
│  ──────────────                                                 │
│                                                                 │
│  Task Config: heartbeatIntervalMs: 30000                        │
│  Orchestrator: heartbeatTimeoutMs: 60000 (auto-calculated 2×)   │
│                                                                 │
│  Timeline:                                                      │
│  ─────────                                                      │
│  0s   Task starts, first heartbeat sent                         │
│  30s  Second heartbeat sent                                     │
│  55s  Task completes, callback sent                             │
│  55s  Orchestrator receives callback → cancels timeout          │
│  60s  (Timeout would have fired, but was cancelled)             │
└─────────────────────────────────────────────────────────────────┘
```

---

### Idempotency

Tasks can be configured for idempotent execution — if the same task with the same idempotency key was already completed, the cached result is returned. The `codeVersion` is provided to your key function so you can decide whether code changes should invalidate cached results.

#### How Idempotency Works

The idempotency key function receives both the input and the current `codeVersion`, giving you full control:

```typescript
// Option 1: Include codeVersion (re-execute on code changes)
idempotencyKey: (input, codeVersion) => `${codeVersion}:${input.orderId}`;

// Option 2: Exclude codeVersion (keep cached result across code changes)
idempotencyKey: (input, codeVersion) => `${input.orderId}`;
```

This means:

- **With codeVersion in key:** Same input + different code = task re-executes
- **Without codeVersion in key:** Same input + different code = cached result returned

#### Idempotency Keys

Define how to generate an idempotency key from task input:

```typescript
worker.register(
  "process-payment",
  {
    // codeVersion is passed as second argument — use it or ignore it
    idempotencyKey: (input, codeVersion) =>
      `v${codeVersion}-payment-${input.orderId}-${input.amount}`,
    idempotencyTTL: 86400, // Cache for 24 hours
    retries: 3,
  },
  async (ctx) => {
    // Also available in context for logging/debugging
    ctx.log.info(`Processing with code v${ctx.codeVersion} (${ctx.codeHash})`);

    return await processPayment(ctx.input);
  }
);
```

#### Idempotency Behavior

```mermaid
flowchart TD
    A[Task Dispatched] --> B{Idempotency Key<br/>Configured?}
    B -->|No| E[Execute Task]
    B -->|Yes| C["Call idempotencyKey(input, codeVersion)"]
    C --> D{Key Exists in<br/>Completed Tasks?}
    D -->|No| E
    D -->|Yes| F[Return Cached Result]
    E --> G[Store Result with Key]
    F --> H[Trigger Downstream Tasks]
    G --> H
```

**Important:** When a cached result is returned, downstream tasks are **still triggered** with the cached output. Idempotency only skips re-execution of the current task, not the rest of the pipeline.

```
┌─────────────────────────────────────────────────────────────────┐
│  Idempotency Key Function                                       │
│  ────────────────────────                                       │
│                                                                 │
│  Signature: (input: TInput, codeVersion: number) => string      │
│                                                                 │
│  Example 1: Version-aware (recommended for most cases)          │
│  ─────────────────────────────────────────────────────          │
│  idempotencyKey: (input, v) => `v${v}-order-${input.orderId}`   │
│                                                                 │
│  • Order 123, code v3 → key: "v3-order-123"                     │
│  • Order 123, code v4 → key: "v4-order-123" (re-executes)       │
│                                                                 │
│  Example 2: Version-independent (for stable computations)       │
│  ────────────────────────────────────────────────────────       │
│  idempotencyKey: (input, _v) => `hash-${input.fileHash}`        │
│                                                                 │
│  • File abc123, code v3 → key: "hash-abc123"                    │
│  • File abc123, code v4 → key: "hash-abc123" (cached!)          │
│                                                                 │
│  Use version-independent when:                                  │
│  • Pure computations (hashing, checksums)                       │
│  • Expensive operations you want to cache across deploys        │
│  • External API calls where your code doesn't affect result     │
└─────────────────────────────────────────────────────────────────┘
```

#### Configuration

| Option           | Type                             | Default | Description                         |
| ---------------- | -------------------------------- | ------- | ----------------------------------- |
| `idempotencyKey` | `(input, codeVersion) => string` | —       | Function to generate key            |
| `idempotencyTTL` | `number`                         | `86400` | How long to cache results (seconds) |

#### Best Practices for Idempotent Tasks

1. **Include codeVersion for most tasks** — Re-executing after code changes is usually the safe choice
2. **Exclude codeVersion for pure computations** — If the output depends only on input, not code logic
3. **Use deterministic inputs** — Include all relevant data in the idempotency key
4. **Avoid side effects** — Or make them idempotent (e.g., upsert instead of insert)

```typescript
// Good: Include version for business logic that might change
idempotencyKey: (input, v) => `v${v}-${input.userId}-${input.action}`;

// Good: Exclude version for pure computation
idempotencyKey: (input, _v) => `checksum-${input.fileHash}`;

// Bad: Missing relevant data
idempotencyKey: (input, v) => `${input.userId}`; // Same user, different actions = collision
```

#### Accessing Code Info in Tasks

Use `ctx.codeVersion` and `ctx.codeHash` for logging or custom logic:

````typescript
worker.register('process', {
  idempotencyKey: (input, codeVersion) => `v${codeVersion}-doc-${input.documentId}`,
}, async (ctx) => {
  ctx.log.info(`Processing document ${ctx.input.documentId}`);
  ctx.log.info(`Code version: ${ctx.codeVersion}, hash: ${ctx.codeHash}`);

  return await processDocument(ctx.input);
});

---

### Hydration

**Hydration** prepares a task's input by combining data from multiple sources:

```mermaid
flowchart LR
    subgraph Sources["Data Sources"]
        PI[Pipeline Input]
        PO[Previous Output]
        UO[Upstream Outputs]
        AR[Asset References]
    end

    HE["🔄 Hydration<br/>Engine"]

    subgraph Result["Hydration File"]
        HF["ctx.input<br/>ctx.upstream<br/>ctx.getAsset()"]
    end

    PI --> HE
    PO --> HE
    UO --> HE
    AR --> HE
    HE --> HF
````

#### Hydration File Structure

```json
{
  "input": {
    "pdfUrl": "https://example.com/doc.pdf",
    "storagePath": "s3://bucket/assets/pdf-file"
  },
  "upstream": {
    "download": {
      "storagePath": "...",
      "sizeBytes": 102400
    }
  },
  "assets": {
    "pdf-file": "runs/xxx/assets/pdf-file"
  },
  "previousAttempts": [],
  "codeVersion": 3,
  "codeHash": "a3f8b2c1d4e5f6a7"
}
```

---

### Assets

Assets are persisted data for downstream tasks:

```typescript
// Store (written to temp directory during execution)
await ctx.addAsset("tables", "json", tableData);
await ctx.addAsset("pdf", "binary", pdfBuffer);

// Load (from upstream, fetched from S3)
const tables = await ctx.getAsset("tables");
```

| Type     | Content-Type               | Use Case        |
| -------- | -------------------------- | --------------- |
| `json`   | `application/json`         | Structured data |
| `text`   | `text/plain`               | Reports, CSVs   |
| `binary` | `application/octet-stream` | Files, images   |

#### Large Asset Handling

Assets are stored in a temporary directory during task execution, making it safe to work with large files:

```typescript
worker.register(
  "process-video",
  {
    timeout: 1800, // 30 minutes
  },
  async (ctx) => {
    // Large file is stored in temp directory, not memory
    const videoPath = await ctx.getAssetPath("input-video"); // Returns local path

    // Process using file path (no memory pressure)
    const outputPath = await transcodeVideo(videoPath);

    // Add output asset from file path
    await ctx.addAssetFromPath("output-video", "binary", outputPath);

    return { duration: getVideoDuration(outputPath) };
  }
);
```

---

### Pipelines

Pipelines are DAGs defined through the `allowedNext` option:

#### Linear Pipeline

```mermaid
flowchart LR
    A[Task A] --> B[Task B] --> C[Task C]
```

```typescript
worker.register("A", { allowedNext: ["B"] }, handlerA);
worker.register("B", { allowedNext: ["C"] }, handlerB);
worker.register("C", {}, handlerC);
```

#### Parallel Split

```mermaid
flowchart LR
    A[Task A] --> B[Task B]
    A --> C[Task C]
```

```typescript
worker.register("A", { allowedNext: ["B", "C"] }, handlerA);
```

#### Parallel Join (Fan-in)

```mermaid
flowchart LR
    B[Task B] --> D[Task D]
    C[Task C] --> D
```

```typescript
worker.register("B", { allowedNext: ["D"] }, handlerB);
worker.register("C", { allowedNext: ["D"] }, handlerC);
worker.register("D", {}, handlerD); // Waits for both
```

#### Complex DAG

```mermaid
flowchart LR
    A[Download] --> B[Extract Text]
    A --> C[Extract Tables]
    B --> D[Summarize]
    C --> D
    D --> E[Notify]
    D --> F[Archive]
```

#### Execution Rules

1. **Entry tasks** start immediately with pipeline input
2. **Parallel tasks** execute concurrently
3. **Join tasks** wait for ALL predecessors
4. **End tasks** (no `allowedNext`) complete the pipeline

---

### Pipeline Versioning

When pipeline structure changes between deployments, in-flight pipelines continue with their original structure:

```mermaid
flowchart TD
    subgraph V1["Pipeline v1.0 (in-flight)"]
        A1[Download] --> B1[Process] --> C1[Upload]
    end

    subgraph V2["Pipeline v1.1 (new)"]
        A2[Download] --> X2[Validate] --> B2[Process] --> C2[Upload]
    end
```

**Behavior:**

- Each pipeline run stores a snapshot of its structure at creation time
- In-flight runs use their original structure, not the new one
- New runs use the latest registered structure
- The UI shows which version each run is using

```typescript
// Pipeline runs store their structure
{
  "pipelineRunId": "prun_abc123",
  "pipelineVersion": "1.0.0",
  "structureSnapshot": {
    "download": { "allowedNext": ["process"] },
    "process": { "allowedNext": ["upload"] },
    "upload": { "allowedNext": [] }
  }
}
```

---

## SDK Reference

### `createWorker(config)`

```typescript
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: "http://localhost:3000",
  serviceId: "my-service",
  version: "1.0.0",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY, // Required: for JWT decryption
  tempDir: "/tmp/pipeweave", // Optional: temp directory base
  tempCleanupOnFailure: true, // Optional: cleanup on failure
});
```

| Config Option          | Type      | Default          | Description                      |
| ---------------------- | --------- | ---------------- | -------------------------------- |
| `orchestratorUrl`      | `string`  | required         | Orchestrator endpoint            |
| `serviceId`            | `string`  | required         | Unique service identifier        |
| `version`              | `string`  | `'0.1.0'`        | Service version                  |
| `secretKey`            | `string`  | required         | Shared key for JWT encryption    |
| `tempDir`              | `string`  | `/tmp/pipeweave` | Base directory for temp files    |
| `tempCleanupOnFailure` | `boolean` | `true`           | Clean temp files on task failure |

### `worker.register(id, [options], handler)`

```typescript
worker.register(
  "my-task",
  {
    allowedNext: ["next-task"],
    timeout: 60,
    retries: 5,
    heartbeatIntervalMs: 30000,
  },
  async (ctx) => {
    // Function is hashed on registration for code change detection
    return { result: "done" };
  }
);
```

On registration, the handler function is hashed (SHA-256, first 16 chars). This hash is:

- Sent to orchestrator during registration
- Stored in `tasks.code_hash` column
- Used to detect code changes between deployments

### `worker.listen(port)`

```typescript
await worker.listen(8080);

// Console output:
// [PipeWeave] Worker my-service v1.0.0 on port 8080
// [PipeWeave] Task code hashes:
//   • download [a3f8b2c1d4e5f6a7] → [process]
//   • process [b4c9d0e1f2a3b4c5] → (end)
// [PipeWeave] Heartbeat intervals:
//   • download: 30000ms (timeout: 60000ms)
//   • process: 60000ms (timeout: 120000ms)
```

### `runLocal(worker, taskId, input, upstream?)`

```typescript
// For local debugging with breakpoints
const result = await runLocal(
  worker,
  "my-task",
  { data: "test" }, // ctx.input
  { "prev-task": prevOutput } // ctx.upstream
);
```

### `TaskResult` (Programmatic Next)

```typescript
import { TaskResult } from "@pipeweave/sdk";

worker.register(
  "router",
  {
    allowedNext: ["path-a", "path-b", "path-c"], // All ALLOWED next tasks
  },
  async (ctx): Promise<TaskResult> => {
    // Dynamically select which tasks run
    if (ctx.input.condition === "fast") {
      return { output: { done: true }, runNext: ["path-a"] };
    } else {
      // Run multiple in parallel
      return { output: { done: true }, runNext: ["path-b", "path-c"] };
    }
  }
);
```

### `TaskError` (Structured Errors)

```typescript
import { TaskError } from "@pipeweave/sdk";

worker.register("api-call", { retries: 3 }, async (ctx) => {
  try {
    return await callApi(ctx.input);
  } catch (error) {
    // Throw structured error with code for retry logic
    throw new TaskError(error.message, {
      code: error.response?.status === 429 ? "RATE_LIMITED" : "API_ERROR",
      retryable: error.response?.status !== 400, // Don't retry client errors
      details: { statusCode: error.response?.status },
    });
  }
});
```

---

## Web UI

The Web UI is a standalone Next.js application that can connect to **multiple orchestrators** simultaneously.

```mermaid
flowchart LR
    subgraph UI["🖥️ PipeWeave Web UI"]
        Store["Orchestrator Store"]
        Dashboard["Dashboard"]
        Pipelines["Pipelines View"]
        Runs["Runs View"]
        DLQ["Dead Letter Queue"]
    end

    subgraph Orchestrators["Orchestrators"]
        O1["Production"]
        O2["Staging"]
        O3["Development"]
    end

    Store --> O1
    Store --> O2
    Store --> O3
```

### Features

- **Multi-orchestrator support** — Connect to unlimited orchestrators (prod, staging, dev)
- **Real-time updates** — Auto-refresh run status every few seconds
- **Pipeline visualization** — View DAG structure and task flow
- **Run monitoring** — Track task execution, view errors, inspect input/output
- **Trigger pipelines** — Start runs directly from the UI with custom input
- **Dead Letter Queue** — View and retry failed tasks
- **Code change tracking** — See which tasks have changed between runs

### Running the UI

```bash
cd packages/ui
npm install
npm run dev
# Open http://localhost:4000
```

### Adding Orchestrators

1. Click the **+** button in the sidebar
2. Enter a name (e.g., "Production")
3. Enter the orchestrator URL (e.g., `https://orchestrator.example.com`)
4. Add API key if required
5. Click **Add**

The UI persists orchestrator connections in localStorage, so they survive page reloads.

### Pages

| Page              | URL          | Description                            |
| ----------------- | ------------ | -------------------------------------- |
| Dashboard         | `/`          | Overview stats, recent runs, pipelines |
| Pipelines         | `/pipelines` | List all pipelines, trigger runs       |
| Runs              | `/runs`      | List all runs with filtering           |
| Run Detail        | `/runs/:id`  | Task execution details, input/output   |
| Dead Letter Queue | `/dlq`       | Failed tasks after all retries         |

---

## CLI Reference

The CLI handles **triggering pipelines** and **database management**. Deployments are automatic when workers start.

### Commands

```mermaid
flowchart LR
    subgraph CLI["pipeweave CLI"]
        init["init"]
        services["services"]
        trigger["trigger"]
        status["status"]
        db["db"]
        dryrun["dry-run"]
        dlq["dlq"]
    end

    init --> |creates| Project["Project Files"]
    services --> |lists| Orchestrator
    trigger --> |starts| Pipeline["Pipeline Run"]
    dryrun --> |validates| Pipeline
    db --> |manages| Database["PostgreSQL"]
    dlq --> |manages| DLQ["Dead Letter Queue"]
```

### `pipeweave init`

```bash
pipeweave init --name my-service
```

### `pipeweave services`

List registered services:

```bash
pipeweave services --url http://localhost:3000
```

### `pipeweave trigger`

```bash
pipeweave trigger my-pipeline -i '{"key": "value"}' --wait
```

### `pipeweave dry-run`

Validate a pipeline definition without executing:

```bash
pipeweave dry-run my-pipeline -i '{"key": "value"}'

# Output:
# ✓ Pipeline 'my-pipeline' validated
#
# Execution plan:
#   1. download (entry)
#   2. extract-text, extract-tables (parallel)
#   3. summarize (join, waits for: extract-text, extract-tables)
#   4. notify, archive (parallel, end)
#
# Warnings:
#   - Task 'extract-tables' has concurrency limit of 2
```

### `pipeweave status`

```bash
pipeweave status prun_abc123
```

### `pipeweave dlq`

Manage the Dead Letter Queue:

```bash
# List failed tasks
pipeweave dlq list --url http://localhost:3000

# View details of a failed task
pipeweave dlq show trun_abc123

# Retry a failed task
pipeweave dlq retry trun_abc123

# Retry all failed tasks for a pipeline
pipeweave dlq retry-all --pipeline my-pipeline

# Purge old DLQ entries
pipeweave dlq purge --older-than 7d
```

### Database Commands

```bash
pipeweave db init --url postgres://...    # Initialize schema
pipeweave db migrate --url $DATABASE_URL  # Run migrations
pipeweave db status --url $DATABASE_URL   # Show status
pipeweave db reset --url $DATABASE_URL --yes  # Reset (destructive)
```

---

## Orchestrator

### API Endpoints

| Endpoint                     | Method | Description                                |
| ---------------------------- | ------ | ------------------------------------------ |
| `/health`                    | GET    | Health check                               |
| `/api/register`              | POST   | Register/update service (with code hashes) |
| `/api/services`              | GET    | List all registered services               |
| `/api/services/:id/tasks`    | GET    | List tasks with code info                  |
| `/api/tasks/:id/history`     | GET    | Task code change history                   |
| `/api/pipelines`             | GET    | List pipelines                             |
| `/api/pipelines/:id/trigger` | POST   | Trigger pipeline                           |
| `/api/pipelines/:id/dry-run` | POST   | Validate pipeline without executing        |
| `/api/runs`                  | GET    | List pipeline runs                         |
| `/api/runs/:id`              | GET    | Get run details (with code change flags)   |
| `/api/queue/task`            | POST   | **Queue standalone task**                  |
| `/api/queue/batch`           | POST   | **Queue multiple tasks**                   |
| `/api/queue/status`          | GET    | **Get queue statistics**                   |
| `/api/queue/items`           | GET    | **List queue items**                       |
| `/api/task-runs/:id`         | GET    | **Get single task run**                    |
| `/api/storage/*`             | GET    | **Get S3 content**                         |
| `/api/process`               | POST   | Process pending (serverless)               |
| `/api/heartbeat`             | POST   | Task heartbeat                             |
| `/api/progress`              | POST   | Task progress update                       |
| `/api/callback/:runId`       | POST   | Task completion callback (metadata only)   |
| `/api/dlq`                   | GET    | **List dead letter queue items**           |
| `/api/dlq/:id/retry`         | POST   | **Retry a DLQ item**                       |

### Task Queue API

Queue standalone tasks for execution (not part of a pipeline):

```bash
# Queue a single task
curl -X POST http://localhost:3000/api/queue/task \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "process-document",
    "input": { "documentUrl": "https://..." },
    "priority": 50,
    "metadata": { "userId": "user123" }
  }'

# Response
{
  "runId": "trun_abc123",
  "status": "queued",
  "taskId": "process-document",
  "inputPath": "standalone/trun_abc123/input.json"
}
```

```bash
# Queue multiple tasks
curl -X POST http://localhost:3000/api/queue/batch \
  -H "Content-Type: application/json" \
  -d '{
    "tasks": [
      { "taskId": "process-document", "input": { "url": "..." } },
      { "taskId": "process-document", "input": { "url": "..." }, "priority": 10 }
    ]
  }'

# Response
{
  "queued": 2,
  "results": [
    { "runId": "trun_abc123", "taskId": "process-document", "status": "queued" },
    { "runId": "trun_def456", "taskId": "process-document", "status": "queued" }
  ]
}
```

```bash
# Get queue status
curl http://localhost:3000/api/queue/status

# Response
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

Priority values: lower number = higher priority (default: 100). Task-type priority can be overridden per-instance.

### Dead Letter Queue API

Tasks that fail after all retries are moved to the Dead Letter Queue:

```bash
# List DLQ items
curl http://localhost:3000/api/dlq

# Response
{
  "items": [
    {
      "id": "dlq_abc123",
      "taskRunId": "trun_xyz789",
      "taskId": "process-document",
      "pipelineRunId": "prun_def456",
      "codeVersion": 3,
      "codeHash": "a3f8b2c1d4e5f6a7",
      "error": "Connection timeout after 3 retries",
      "attempts": 3,
      "failedAt": "2024-01-15T10:30:00Z",
      "input": { "url": "..." }
    }
  ],
  "total": 5
}

# Retry a DLQ item (uses current code version, not the failed version)
curl -X POST http://localhost:3000/api/dlq/dlq_abc123/retry

# Response
{
  "newRunId": "trun_new123",
  "status": "queued",
  "codeVersion": 4
}
```

### Task Code History API

Track code changes across deployments:

```
GET /api/tasks/download/history

Response:
[
  { "code_version": 3, "code_hash": "a3f8b2c1d4e5f6a7", "service_version": "1.2.0", "recorded_at": "2024-01-15T..." },
  { "code_version": 2, "code_hash": "b4c9d0e1f2a3b4c5", "service_version": "1.1.0", "recorded_at": "2024-01-10T..." },
  { "code_version": 1, "code_hash": "c5d0e1f2a3b4c5d6", "service_version": "1.0.0", "recorded_at": "2024-01-01T..." }
]
```

### Callback Payload (Metadata Only)

Workers send only metadata, not inline data:

```json
{
  "status": "success",
  "outputPath": "runs/prun_xxx/outputs/trun_yyy.json",
  "outputSize": 1234,
  "assets": {
    "pdf-file": {
      "path": "runs/.../assets/pdf-file",
      "size": 50000,
      "type": "binary"
    }
  },
  "logsPath": "runs/.../logs/trun_yyy.jsonl",
  "selectedNext": ["process", "notify"]
}
```

### Auto-Registration with Code Hashes

Workers register with code hashes for change detection:

```
Worker starts (v1.1.0)
    │
    ▼
POST /api/register
{
  tasks: [
    { id: "download", codeHash: "a3f8b2c1d4e5f6a7", heartbeatIntervalMs: 30000, ... }
  ]
}
    │
    ▼
Orchestrator compares hashes
    │
    ├── Hash unchanged → No action
    │
    └── Hash changed?
            │
            ├── Update tasks.code_hash
            ├── Increment tasks.code_version
            ├── Record in task_code_history
            └── Return codeChanges: [{ taskId, oldHash, newHash, oldVersion, newVersion }]
```

### Orphan Cleanup

When a worker registers with a **different version**, pending tasks for removed task types are automatically cancelled:

```
Worker v1.0.0 (running)
  Tasks: [download, process, upload]
    │
    ▼
Worker v1.1.0 starts (upload task removed)
  Tasks: [download, process]
    │
    ▼
POST /api/register { version: "1.1.0", tasks: [...] }
    │
    ▼
Orchestrator detects version change:
  - Previous version: 1.0.0
  - New version: 1.1.0
  - Missing tasks: [upload]
    │
    ▼
Cancel all pending 'upload' tasks:
  - Status → 'cancelled'
  - Reason: 'Task type removed in version 1.1.0'
```

**Important:** Orphan cleanup only triggers on version change. If the same version re-registers (e.g., after restart), pending tasks are preserved.

---

## Deployment Modes

### Standalone Mode

```mermaid
flowchart LR
    subgraph Orchestrator["Orchestrator (standalone)"]
        Poller["⏱️ Poller"]
        Executor["🔧 Executor"]
    end

    DB[(PostgreSQL)]
    Tasks["Task Services"]

    Poller -->|polls| DB
    Poller --> Executor
    Executor -->|HTTP| Tasks
```

```bash
MODE=standalone
POLL_INTERVAL_MS=1000
```

### Serverless Mode

```mermaid
flowchart LR
    Scheduler["☁️ Cloud Scheduler"]

    subgraph CloudRun["Cloud Run"]
        Orch["Orchestrator"]
    end

    Tasks["Task Services"]

    Scheduler -->|POST /api/process| Orch
    Orch -->|HTTP| Tasks
```

```bash
MODE=serverless
```

---

## Storage & Data Flow

### Data Storage Strategy

**All data is stored in S3** — the PostgreSQL database only stores metadata (paths, sizes, status):

| Data Type      | Location                                     | Purpose                |
| -------------- | -------------------------------------------- | ---------------------- |
| Pipeline input | S3 (`pipelines/{run-id}/input.json`)         | Initial pipeline input |
| Task input     | S3 (`standalone/{run-id}/input.json`)        | Standalone task input  |
| Task outputs   | S3 (`runs/{run-id}/outputs/{task-run}.json`) | Task results           |
| Binary assets  | S3 (`runs/{run-id}/assets/`)                 | Files, images, PDFs    |
| Task logs      | S3 (`runs/{run-id}/logs/`)                   | Debugging              |

```mermaid
flowchart TB
    subgraph PostgreSQL
        PR[pipeline_runs]
        TR[task_runs]
        PR --> |input_path, output_path| Paths["S3 Paths Only<br/>(no inline data)"]
        TR --> |input_path, output_path, assets| Paths
    end

    subgraph S3["☁️ S3 Bucket"]
        subgraph Pipelines["pipelines/{run-id}/"]
            PI["input.json"]
        end
        subgraph Standalone["standalone/{run-id}/"]
            SI["input.json"]
        end
        subgraph Runs["runs/{run-id}/"]
            O["outputs/"]
            A["assets/"]
            L["logs/"]
        end
    end

    Worker -->|Store results| O
    Worker -->|Assets| A
    Worker -->|Logs| L
```

### Benefits of S3-Only Storage

- **Consistent data handling** — All data flows through S3
- **Unlimited size** — No PostgreSQL JSONB size limits
- **Cost efficient** — Database stores only metadata
- **Debuggable** — All data accessible via S3 paths
- **Scalable** — S3 handles large volumes of data

### Retrieving Data

Use the `/api/storage/*` endpoint to retrieve S3 content:

```bash
# Get task output
curl http://localhost:3000/api/storage/runs/prun_xxx/outputs/trun_yyy.json

# Response
{
  "path": "runs/prun_xxx/outputs/trun_yyy.json",
  "content": { "result": "processed successfully" }
}
```

---

## Error Handling & Reliability

### Retry Behavior

Tasks can be configured with automatic retry behavior:

```typescript
worker.register(
  "flaky-api",
  {
    retries: 5,
    retryBackoff: "exponential", // or 'fixed'
    retryDelayMs: 1000, // Base delay
    maxRetryDelayMs: 3600000, // Cap at 1 hour (default: 24 hours)
  },
  handler
);
```

**Exponential backoff:** Delays are `min(retryDelayMs * 2^(attempt-1), maxRetryDelayMs)`

With default `maxRetryDelayMs: 86400000` (24 hours):

- Attempt 1: immediate
- Attempt 2: 1000ms delay
- Attempt 3: 2000ms delay
- Attempt 4: 4000ms delay
- Attempt 5: 8000ms delay
- ...
- Attempt 15: 16384000ms delay (~4.5 hours)
- Attempt 18+: 86400000ms delay (24 hours, capped)

**Configuration:**

| Option            | Type                       | Default         | Description                      |
| ----------------- | -------------------------- | --------------- | -------------------------------- |
| `retries`         | `number`                   | `3`             | Maximum retry attempts           |
| `retryBackoff`    | `'fixed' \| 'exponential'` | `'exponential'` | Backoff strategy                 |
| `retryDelayMs`    | `number`                   | `1000`          | Base delay between retries (ms)  |
| `maxRetryDelayMs` | `number`                   | `86400000`      | Maximum delay cap (default: 24h) |

```typescript
// Example: Quick retries with low cap for time-sensitive tasks
worker.register(
  "real-time-api",
  {
    retries: 3,
    retryBackoff: "exponential",
    retryDelayMs: 100,
    maxRetryDelayMs: 5000, // Never wait more than 5 seconds
  },
  handler
);

// Example: Patient retries for batch jobs
worker.register(
  "batch-import",
  {
    retries: 10,
    retryBackoff: "exponential",
    retryDelayMs: 60000, // Start at 1 minute
    maxRetryDelayMs: 86400000, // Cap at 24 hours (default)
  },
  handler
);
```

### Non-Retryable Errors

Mark errors as non-retryable to skip straight to failure:

```typescript
throw new TaskError("Invalid input format", { retryable: false });
```

### Dead Letter Queue

After all retries are exhausted, failed tasks are moved to the DLQ:

```mermaid
flowchart LR
    A[Task Fails] --> B{Retries<br/>Remaining?}
    B -->|Yes| C[Retry with Backoff]
    B -->|No| D[Move to DLQ]
    D --> E[Manual Review]
    E --> F[Retry or Discard]
```

DLQ entries include:

- Original input
- All attempt errors with timestamps
- Pipeline context
- Code version and hash at time of failure

### Partial Pipeline Failures

When some tasks in a fan-out fail:

```mermaid
flowchart LR
    A[Download] --> B[Process A ✓]
    A --> C[Process B ✗]
    A --> D[Process C ✓]
    B --> E[Merge]
    C -.->|failed| E
    D --> E
```

**Behavior options** (configured per-pipeline):

| Mode            | Behavior                                       |
| --------------- | ---------------------------------------------- |
| `fail-fast`     | Cancel remaining tasks when any task fails     |
| `continue`      | Continue with successful branches, skip merge  |
| `partial-merge` | Merge available results, mark run as `partial` |

```typescript
// Configure in pipeline trigger
curl -X POST http://localhost:3000/api/pipelines/my-pipeline/trigger \
  -d '{"input": {...}, "failureMode": "partial-merge"}'
```

### Task Timeout Handling

When a task exceeds its timeout:

1. Orchestrator marks task as `timeout`
2. Task is retried (if retries remaining)
3. Previous attempt's error is recorded with `errorCode: 'TIMEOUT'`

Workers can check for timeout in retry logic:

```typescript
worker.register("long-task", { timeout: 300, retries: 2 }, async (ctx) => {
  if (ctx.previousAttempts.some((a) => a.errorCode === "TIMEOUT")) {
    // Previous attempt timed out - maybe use a simpler algorithm
    return await processSimplified(ctx.input);
  }
  return await processComplete(ctx.input);
});
```

---

## Example: PDF Processing Pipeline

### Pipeline Structure

```mermaid
flowchart LR
    D["📥 download"] --> ET["📄 extract-text"]
    D -.->|optional| TB["📊 extract-tables"]
    ET --> S["📝 summarize"]
    TB --> S
```

### Implementation with Programmatic Next

```typescript
import { createWorker, TaskResult, TaskError } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: "http://localhost:3000",
  serviceId: "pdf-processor",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY,
  tempDir: "/tmp/pipeweave",
});

// Download task with PROGRAMMATIC NEXT selection
worker.register(
  "download",
  {
    allowedNext: ["extract-text", "extract-tables"], // All ALLOWED next tasks
    timeout: 120,
    heartbeatIntervalMs: 30000,
    idempotencyKey: (input, codeVersion) =>
      `v${codeVersion}-download-${input.pdfUrl}`,
  },
  async (ctx): Promise<TaskResult> => {
    const { pdfUrl, extractTables = true } = ctx.input;

    // Log code version for debugging
    ctx.log.info(`Running download v${ctx.codeVersion} (${ctx.codeHash})`);

    // Check if previous attempt failed due to network
    if (ctx.previousAttempts.some((a) => a.errorCode === "NETWORK_ERROR")) {
      ctx.log.info("Retrying after network error, using backup URL");
    }

    try {
      const buffer = await downloadPdf(pdfUrl);
      await ctx.addAsset("pdf-file", "binary", buffer);

      const output = { sizeBytes: buffer.length };

      // Dynamically choose which tasks run next
      if (extractTables) {
        return { output, runNext: ["extract-text", "extract-tables"] }; // Parallel
      } else {
        return { output, runNext: ["extract-text"] }; // Skip table extraction
      }
    } catch (error) {
      throw new TaskError(error.message, {
        code: error.code === "ENOTFOUND" ? "NETWORK_ERROR" : "DOWNLOAD_ERROR",
        retryable: error.code !== "ENOENT", // Don't retry 404s
      });
    }
  }
);

worker.register(
  "extract-text",
  {
    allowedNext: ["summarize"],
    heartbeatIntervalMs: 60000,
  },
  async (ctx) => {
    const pdf = await ctx.getAsset("pdf-file");
    const text = await extractText(pdf);
    return { text, wordCount: text.split(/\s+/).length };
  }
);

worker.register(
  "extract-tables",
  {
    allowedNext: ["summarize"],
    concurrency: 2, // Limit concurrent table extraction
    heartbeatIntervalMs: 60000,
  },
  async (ctx) => {
    const pdf = await ctx.getAsset("pdf-file");
    const tables = await extractTables(pdf);
    return { tables, count: tables.length };
  }
);

worker.register("summarize", {}, async (ctx) => {
  const text = ctx.upstream["extract-text"];
  const tables = ctx.upstream["extract-tables"]; // May be undefined
  return generateSummary(text, tables);
});

worker.listen(8080);
```

### Execution Timeline

```mermaid
gantt
    title Pipeline Execution Timeline
    dateFormat X
    axisFormat %s

    section Download
    download           :done, d1, 0, 2

    section Parallel
    extract-text       :active, t1, 2, 5
    extract-tables     :active, t2, 2, 8

    section Join
    summarize          :s1, 8, 10
```

---

## Configuration Reference

### Environment Variables

#### Orchestrator

| Variable                  | Required | Default      | Description                   |
| ------------------------- | -------- | ------------ | ----------------------------- |
| `DATABASE_URL`            | Yes      | —            | PostgreSQL connection         |
| `S3_ENDPOINT`             | Yes      | —            | S3/MinIO endpoint             |
| `S3_BUCKET`               | Yes      | —            | Bucket name                   |
| `S3_ACCESS_KEY`           | Yes      | —            | Access key                    |
| `S3_SECRET_KEY`           | Yes      | —            | Secret key                    |
| `PIPEWEAVE_SECRET_KEY`    | Yes      | —            | **Shared JWT encryption key** |
| `MODE`                    | No       | `standalone` | Execution mode                |
| `MAX_CONCURRENCY`         | No       | `10`         | Parallel tasks                |
| `POLL_INTERVAL_MS`        | No       | `1000`       | Task polling interval         |
| `DLQ_RETENTION_DAYS`      | No       | `30`         | How long to keep DLQ entries  |
| `IDEMPOTENCY_TTL_SECONDS` | No       | `86400`      | Default idempotency cache TTL |
| `MAX_RETRY_DELAY_MS`      | No       | `86400000`   | Default max retry delay (24h) |

#### Worker (SDK)

| Config                 | Type      | Default          | Description                   |
| ---------------------- | --------- | ---------------- | ----------------------------- |
| `orchestratorUrl`      | `string`  | required         | Orchestrator endpoint         |
| `serviceId`            | `string`  | required         | Unique service ID             |
| `version`              | `string`  | `'0.1.0'`        | Service version               |
| `secretKey`            | `string`  | required         | **Shared JWT encryption key** |
| `tempDir`              | `string`  | `/tmp/pipeweave` | Base temp directory           |
| `tempCleanupOnFailure` | `boolean` | `true`           | Clean temp on failure         |

#### CLI

| Variable                     | Description          |
| ---------------------------- | -------------------- |
| `PIPEWEAVE_ORCHESTRATOR_URL` | Default orchestrator |
| `PIPEWEAVE_API_TOKEN`        | API token            |
| `PIPEWEAVE_BASE_URL`         | Service base URL     |
| `DATABASE_URL`               | For `db` commands    |

### Shared Secret Key

The `PIPEWEAVE_SECRET_KEY` is used to encrypt S3 credentials in JWTs. **Must be identical on orchestrator and all workers.**

```bash
# Generate a secure key
openssl rand -hex 32

# Set on both orchestrator and workers
export PIPEWEAVE_SECRET_KEY="your-32-byte-hex-key"
```

The JWT contains:

- S3 endpoint, bucket, access key, secret key
- Encrypted with AES-256-GCM
- Workers decrypt to access S3 directly

### Heartbeat Configuration

The heartbeat system ensures running tasks are monitored. Each task defines its own heartbeat interval, and the orchestrator automatically calculates the timeout as 2× the interval:

```typescript
// Task-level configuration
worker.register(
  "quick-task",
  {
    heartbeatIntervalMs: 30000, // 30 seconds
    // Orchestrator timeout: 60000ms (auto-calculated)
  },
  handler
);

worker.register(
  "long-task",
  {
    heartbeatIntervalMs: 120000, // 2 minutes
    // Orchestrator timeout: 240000ms (auto-calculated)
  },
  handler
);
```

**How it works:**

1. Task registers with `heartbeatIntervalMs`
2. Orchestrator stores interval in `tasks` table
3. On dispatch, orchestrator sets `heartbeatTimeoutMs = 2 × heartbeatIntervalMs`
4. Worker sends heartbeats at configured interval
5. If no heartbeat within timeout, task is marked failed
6. **Callback cancels timeout** — When orchestrator receives task callback, pending timeout is cancelled

```
┌─────────────────────────────────────────────────────────────────┐
│  Heartbeat Flow (per-task configuration)                        │
│  ──────────────────────────────────────                         │
│                                                                 │
│  Task 'process' Config:                                         │
│    heartbeatIntervalMs: 30000                                   │
│                                                                 │
│  Orchestrator (auto-calculated):                                │
│    heartbeatTimeoutMs: 60000 (2× interval)                      │
│                                                                 │
│  Timeline:                                                      │
│  ─────────                                                      │
│  0s   Task starts, first heartbeat sent                         │
│  30s  Second heartbeat sent                                     │
│  55s  Task completes, callback sent                             │
│  55s  Orchestrator receives callback → CANCELS timeout          │
│  60s  (Timeout would have fired here, but was cancelled)        │
│                                                                 │
│  Race Condition Prevention:                                     │
│  ─────────────────────────                                      │
│  • Callback always cancels timeout immediately                  │
│  • No "completed but marked failed" scenarios                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Development Workflow

```mermaid
flowchart TB
    subgraph Dev["Development"]
        A["1️⃣ pipeweave init"] --> B["2️⃣ Define tasks"]
        B --> C["3️⃣ Test locally"]
        C --> D{"Tests pass?"}
        D -->|No| B
        D -->|Yes| E["4️⃣ Dry-run validation"]
        E --> F["5️⃣ Start services"]
    end

    subgraph Deploy["Deployment"]
        F --> G["6️⃣ pipeweave trigger"]
        G --> H["7️⃣ Monitor"]
        H --> I{"Failures?"}
        I -->|Yes| J["8️⃣ Check DLQ"]
        J --> K["9️⃣ Fix & Retry"]
    end
```

### Local Testing

```typescript
import { runLocal } from "@pipeweave/sdk";

// Test individual tasks with full debugger support
const result = await runLocal(worker, "process", {
  input: { data: "test" },
  upstream: { "previous-task": { result: "mock" } },
  previousAttempts: [
    { attempt: 1, error: "Simulated failure", timestamp: new Date() },
  ],
  codeVersion: 1, // Optional: defaults to current registered version
  codeHash: "a3f8b2c1d4e5f6a7", // Optional: defaults to current hash
});
```

### Dry-Run Validation

Before deploying, validate your pipeline structure:

```bash
pipeweave dry-run my-pipeline -i '{"test": true}'
```

This checks:

- All referenced tasks exist
- DAG is valid (no cycles)
- Join tasks have all predecessors defined
- Concurrency limits are reasonable

---

## Comparison with Alternatives

| Feature                 | PipeWeave | Airflow | Prefect | Temporal |
| ----------------------- | :-------: | :-----: | :-----: | :------: |
| Local debugging         |    ✅     |   ❌    |   ⚠️    |    ⚠️    |
| Serverless-first        |    ✅     |   ❌    |   ⚠️    |    ❌    |
| Minimal deps            |    ✅     |   ❌    |   ⚠️    |    ⚠️    |
| Learning curve          |    Low    |  High   | Medium  |   High   |
| Web UI                  |    ✅     |   ✅    |   ✅    |    ✅    |
| Multi-orchestrator UI   |    ✅     |   ❌    |   ❌    |    ❌    |
| Programmatic routing    |    ✅     |   ⚠️    |   ✅    |    ✅    |
| Heartbeat monitoring    |    ✅     |   ✅    |   ✅    |    ✅    |
| Task concurrency limits |    ✅     |   ✅    |   ✅    |    ✅    |
| CLI DB management       |    ✅     |   ✅    |   ✅    |    ⚠️    |
| Dead Letter Queue       |    ✅     |   ⚠️    |   ✅    |    ✅    |
| Idempotency support     |    ✅     |   ⚠️    |   ✅    |    ✅    |
| Dry-run validation      |    ✅     |   ⚠️    |   ✅    |    ⚠️    |
| Production-ready        |   Early   |   ✅    |   ✅    |    ✅    |

### Decision Guide

```mermaid
quadrantChart
    title When to Use What
    x-axis Simple --> Complex
    y-axis Small Scale --> Large Scale

    quadrant-1 Temporal
    quadrant-2 Airflow
    quadrant-3 PipeWeave
    quadrant-4 Prefect

    PipeWeave: [0.2, 0.3]
    Prefect: [0.5, 0.6]
    Airflow: [0.75, 0.8]
    Temporal: [0.85, 0.7]
```

**Choose PipeWeave when:**

- You need local debugging with breakpoints
- You're deploying to serverless platforms
- You want minimal infrastructure
- You prefer code over configuration

---

## License

MIT
