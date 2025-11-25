# @pipeweave/shared

Shared types, constants, and utilities used across PipeWeave packages.

## Installation

```bash
npm install @pipeweave/shared
```

## Overview

This package provides common code shared between the orchestrator, SDK, CLI, and UI:

- **TypeScript types** — Shared interfaces and type definitions
- **Constants** — Configuration defaults, limits, and enums
- **Utilities** — Helper functions for validation, serialization, and more
- **Schemas** — Zod schemas for runtime validation

## Exports

### Types

```typescript
import type {
  // Core entities
  Task,
  TaskRun,
  Pipeline,
  PipelineRun,
  Service,

  // Task configuration
  TaskOptions,
  TaskContext,
  TaskResult,

  // Status enums
  TaskStatus,
  PipelineStatus,

  // Dead Letter Queue
  DLQEntry,

  // API types
  TriggerPipelineRequest,
  QueueTaskRequest,
  HeartbeatRequest,
  CallbackPayload,
} from "@pipeweave/shared";
```

### Constants

```typescript
import {
  // Defaults
  DEFAULT_TIMEOUT,
  DEFAULT_RETRIES,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_PRIORITY,
  DEFAULT_IDEMPOTENCY_TTL,
  DEFAULT_MAX_RETRY_DELAY_MS,

  // Limits
  MAX_TASK_NAME_LENGTH,
  MAX_PIPELINE_NAME_LENGTH,
  MAX_INPUT_SIZE_BYTES,
  MAX_OUTPUT_SIZE_BYTES,

  // Status values
  TASK_STATUS,
  PIPELINE_STATUS,
} from "@pipeweave/shared";
```

### Utilities

```typescript
import {
  // Validation
  validateTaskId,
  validatePipelineId,
  validateInput,

  // Serialization
  serializeError,
  deserializeError,

  // Hashing
  hashTaskHandler,

  // Retry logic
  calculateRetryDelay,

  // ID generation
  generateRunId,
  generateTaskRunId,
  generatePipelineRunId,
} from "@pipeweave/shared";
```

### Schemas

```typescript
import {
  // Zod schemas for runtime validation
  TaskOptionsSchema,
  TaskContextSchema,
  TriggerPipelineRequestSchema,
  QueueTaskRequestSchema,
} from "@pipeweave/shared";
```

## Types Reference

### Core Entities

#### `Task`

```typescript
interface Task {
  id: string;
  serviceId: string;
  description?: string;
  allowedNext: string[];
  timeout: number;
  retries: number;
  retryBackoff: "fixed" | "exponential";
  retryDelayMs: number;
  maxRetryDelayMs: number;
  heartbeatIntervalMs: number;
  concurrency: number;
  priority: number;
  codeHash: string;
  codeVersion: number;
  idempotencyKey?: string;
  idempotencyTTL?: number;
  createdAt: Date;
  updatedAt: Date;
}
```

#### `TaskRun`

```typescript
interface TaskRun {
  id: string;
  taskId: string;
  pipelineRunId?: string;
  status: TaskStatus;
  attempt: number;
  inputPath: string;
  outputPath?: string;
  errorMessage?: string;
  errorCode?: string;
  codeVersion: number;
  codeHash: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}
```

#### `Pipeline`

```typescript
interface Pipeline {
  id: string;
  name: string;
  description?: string;
  entryTasks: string[];
  tasks: Record<string, PipelineTask>;
  createdAt: Date;
  updatedAt: Date;
}

interface PipelineTask {
  taskId: string;
  allowedNext: string[];
}
```

#### `PipelineRun`

```typescript
interface PipelineRun {
  id: string;
  pipelineId: string;
  status: PipelineStatus;
  inputPath: string;
  outputPath?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}
```

### Task Context

```typescript
interface TaskContext<TInput = any> {
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
  addAsset(key: string, type: AssetType, data: any): Promise<string>;
  getAsset(key: string): Promise<any>;
  progress(percent: number, message?: string): Promise<void>;
  log: Logger;
}
```

### Status Enums

```typescript
enum TaskStatus {
  QUEUED = "queued",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  TIMEOUT = "timeout",
  CANCELLED = "cancelled",
}

enum PipelineStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  PARTIAL = "partial",
}
```

## Constants Reference

### Defaults

```typescript
export const DEFAULT_TIMEOUT = 300; // 5 minutes
export const DEFAULT_RETRIES = 3;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60000; // 1 minute
export const DEFAULT_PRIORITY = 100;
export const DEFAULT_IDEMPOTENCY_TTL = 86400; // 24 hours
export const DEFAULT_MAX_RETRY_DELAY_MS = 86400000; // 24 hours
```

### Limits

```typescript
export const MAX_TASK_NAME_LENGTH = 255;
export const MAX_PIPELINE_NAME_LENGTH = 255;
export const MAX_INPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_OUTPUT_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
```

## Utilities Reference

### Validation

```typescript
// Validate task ID format
validateTaskId(id: string): boolean

// Validate pipeline ID format
validatePipelineId(id: string): boolean

// Validate input size
validateInput(input: any): void // throws if invalid
```

### Retry Logic

```typescript
// Calculate delay for next retry attempt
calculateRetryDelay(
  attempt: number,
  backoff: "fixed" | "exponential",
  baseDelayMs: number,
  maxDelayMs: number
): number

// Example usage:
const delay = calculateRetryDelay(3, "exponential", 1000, 60000);
// Returns: 4000 (1000 * 2^2)
```

### Hashing

```typescript
// Generate SHA-256 hash of task handler
hashTaskHandler(handler: Function): string

// Example usage:
const hash = hashTaskHandler(myTaskFunction);
// Returns: "a3f8b2c1d4e5f6a7" (first 16 chars of SHA-256)
```

### ID Generation

```typescript
// Generate unique IDs with prefixes
generateRunId(): string              // "trun_abc123def456"
generateTaskRunId(): string          // "trun_abc123def456"
generatePipelineRunId(): string      // "prun_abc123def456"
```

### Error Serialization

```typescript
// Serialize error for storage/transmission
serializeError(error: Error): SerializedError

// Deserialize error from stored format
deserializeError(data: SerializedError): Error

interface SerializedError {
  message: string;
  code?: string;
  stack?: string;
  details?: any;
}
```

## Usage Examples

### Validating Task Configuration

```typescript
import { TaskOptionsSchema } from "@pipeweave/shared";

const options = {
  allowedNext: ["task-b"],
  timeout: 60,
  retries: 3,
};

const validated = TaskOptionsSchema.parse(options);
```

### Calculating Retry Delays

```typescript
import { calculateRetryDelay, DEFAULT_MAX_RETRY_DELAY_MS } from "@pipeweave/shared";

for (let attempt = 1; attempt <= 5; attempt++) {
  const delay = calculateRetryDelay(
    attempt,
    "exponential",
    1000,
    DEFAULT_MAX_RETRY_DELAY_MS
  );
  console.log(`Attempt ${attempt}: wait ${delay}ms`);
}

// Output:
// Attempt 1: wait 0ms
// Attempt 2: wait 1000ms
// Attempt 3: wait 2000ms
// Attempt 4: wait 4000ms
// Attempt 5: wait 8000ms
```

### Generating IDs

```typescript
import { generateTaskRunId, generatePipelineRunId } from "@pipeweave/shared";

const taskRunId = generateTaskRunId();
// "trun_1a2b3c4d5e6f7g8h"

const pipelineRunId = generatePipelineRunId();
// "prun_9i0j1k2l3m4n5o6p"
```

### Hashing Task Handlers

```typescript
import { hashTaskHandler } from "@pipeweave/shared";

const myHandler = async (ctx) => {
  return { result: "done" };
};

const hash = hashTaskHandler(myHandler);
// "a3f8b2c1d4e5f6a7"
```

## Development

This package is part of the PipeWeave monorepo and uses:

- **TypeScript** — Type-safe development
- **Zod** — Runtime type validation
- **Vitest** — Testing framework

### Testing

```bash
npm test
```

### Building

```bash
npm run build
```

## Contributing

When adding new shared code:

1. Add types to `src/types/`
2. Add constants to `src/constants.ts`
3. Add utilities to `src/utils/`
4. Export from `src/index.ts`
5. Add tests to `src/__tests__/`

## Documentation

For complete documentation, see the [main specification](../../SPEC.md).

## License

MIT
