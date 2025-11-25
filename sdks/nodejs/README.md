# @pipeweave/sdk

The PipeWeave Node.js SDK for building distributed task workers.

## Installation

```bash
npm install @pipeweave/sdk
```

## Quick Start

```typescript
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: "http://localhost:3000",
  serviceId: "my-service",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
});

// Register a task
worker.register("process", async (ctx) => {
  const { data } = ctx.input;
  return { processed: true, result: data.toUpperCase() };
});

// Start the worker
worker.listen(8080);
```

## Features

- **Simple task registration** — Define tasks as async functions
- **Local debugging** — Run tasks locally with `runLocal()` and set breakpoints
- **Automatic registration** — Workers auto-register with orchestrator on startup
- **Programmatic routing** — Tasks can dynamically select which tasks run next
- **Idempotency support** — Built-in support for safe task retries
- **Asset handling** — Store and retrieve binary assets with automatic temp file management
- **Heartbeat monitoring** — Automatic health reporting to orchestrator
- **Code versioning** — Automatic code change detection via hashing

## Core Concepts

### Task Registration

```typescript
worker.register(
  "task-id",
  {
    allowedNext: ["next-task"],
    timeout: 60,
    retries: 3,
    heartbeatIntervalMs: 30000,
    concurrency: 5,
    priority: 100,
    idempotencyKey: (input, codeVersion) => `v${codeVersion}-${input.id}`,
  },
  async (ctx) => {
    // Task handler
    return { result: "done" };
  }
);
```

### Task Context

The context object provides access to:

```typescript
interface TaskContext<TInput> {
  runId: string;
  pipelineRunId?: string;
  attempt: number;
  codeVersion: number;
  codeHash: string;
  input: TInput;
  upstream: Record<string, any>;
  previousAttempts: Array<{
    attempt: number;
    error: string;
    errorCode?: string;
    timestamp: Date;
  }>;
  addAsset(key, type, data): Promise<string>;
  getAsset(key): Promise<any>;
  progress(percent, message?): Promise<void>;
  log: Logger;
}
```

### Local Testing

```typescript
import { runLocal } from "@pipeweave/sdk";

const result = await runLocal(worker, "process", {
  input: { data: "test" },
  upstream: { "prev-task": { result: "mock" } },
});

console.log(result.output);
```

### Programmatic Next Selection

```typescript
import { TaskResult } from "@pipeweave/sdk";

worker.register(
  "router",
  {
    allowedNext: ["path-a", "path-b", "path-c"],
  },
  async (ctx): Promise<TaskResult> => {
    if (ctx.input.condition === "fast") {
      return { output: { done: true }, runNext: ["path-a"] };
    }
    return { output: { done: true }, runNext: ["path-b", "path-c"] };
  }
);
```

### Asset Management

```typescript
worker.register("process-file", {}, async (ctx) => {
  // Add assets (stored in temp directory during execution)
  await ctx.addAsset("result", "json", { data: "processed" });
  await ctx.addAsset("pdf", "binary", pdfBuffer);

  // Get assets from upstream tasks
  const inputFile = await ctx.getAsset("input-file");

  return { success: true };
});
```

### Error Handling

```typescript
import { TaskError } from "@pipeweave/sdk";

worker.register("api-call", { retries: 3 }, async (ctx) => {
  try {
    return await callApi(ctx.input);
  } catch (error) {
    throw new TaskError(error.message, {
      code: error.response?.status === 429 ? "RATE_LIMITED" : "API_ERROR",
      retryable: error.response?.status !== 400,
      details: { statusCode: error.response?.status },
    });
  }
});
```

### Idempotency

```typescript
worker.register(
  "process-payment",
  {
    idempotencyKey: (input, codeVersion) =>
      `v${codeVersion}-payment-${input.orderId}`,
    idempotencyTTL: 86400, // Cache for 24 hours
    retries: 3,
  },
  async (ctx) => {
    ctx.log.info(`Processing with code v${ctx.codeVersion}`);
    return await processPayment(ctx.input);
  }
);
```

## Configuration

### Worker Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `orchestratorUrl` | `string` | required | Orchestrator endpoint |
| `serviceId` | `string` | required | Unique service identifier |
| `version` | `string` | `'0.1.0'` | Service version |
| `secretKey` | `string` | required | Shared key for JWT encryption |
| `tempDir` | `string` | `/tmp/pipeweave` | Base directory for temp files |
| `tempCleanupOnFailure` | `boolean` | `true` | Clean temp files on task failure |

### Task Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allowedNext` | `string[]` | `[]` | Allowed next task IDs |
| `timeout` | `number` | `300` | Timeout in seconds |
| `retries` | `number` | `3` | Maximum retry attempts |
| `retryBackoff` | `'fixed' \| 'exponential'` | `'exponential'` | Backoff strategy |
| `retryDelayMs` | `number` | `1000` | Base delay between retries |
| `maxRetryDelayMs` | `number` | `86400000` | Maximum retry delay (24h) |
| `heartbeatIntervalMs` | `number` | `60000` | Heartbeat interval |
| `concurrency` | `number` | `0` (unlimited) | Max concurrent executions |
| `priority` | `number` | `100` | Default priority (lower = higher priority) |
| `idempotencyKey` | `(input, codeVersion) => string` | — | Function to generate idempotency key |
| `idempotencyTTL` | `number` | `86400` | How long to cache results (seconds) |
| `description` | `string` | — | Human-readable description |

## Examples

See the [examples](../../examples) directory for complete examples.

## Documentation

For complete documentation, see the [main specification](../../SPEC.md).

## License

MIT
