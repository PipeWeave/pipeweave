import { z } from 'zod';
import type { TaskInputSchema } from './input-schema.js';

// ============================================================================
// Task Status
// ============================================================================

export const TaskStatus = {
  PENDING: 'pending',
  QUEUED: 'queued',
  RUNNING: 'running',
  WAITING: 'waiting', // Waiting for upstream tasks
  SUCCESS: 'success',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  CANCELLED: 'cancelled',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'waiting',
  'success',
  'failed',
  'timeout',
  'cancelled',
]);

// ============================================================================
// Pipeline Status
// ============================================================================

export const PipelineStatus = {
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCESS: 'success',
  PARTIAL: 'partial', // Some tasks succeeded, some failed
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type PipelineStatus = (typeof PipelineStatus)[keyof typeof PipelineStatus];

export const PipelineStatusSchema = z.enum([
  'pending',
  'running',
  'success',
  'partial',
  'failed',
  'cancelled',
]);

// ============================================================================
// Failure Modes
// ============================================================================

export const FailureMode = {
  FAIL_FAST: 'fail-fast',
  CONTINUE: 'continue',
  PARTIAL_MERGE: 'partial-merge',
} as const;

export type FailureMode = (typeof FailureMode)[keyof typeof FailureMode];

export const FailureModeSchema = z.enum(['fail-fast', 'continue', 'partial-merge']);

// ============================================================================
// Retry Backoff
// ============================================================================

export const RetryBackoff = {
  FIXED: 'fixed',
  EXPONENTIAL: 'exponential',
} as const;

export type RetryBackoff = (typeof RetryBackoff)[keyof typeof RetryBackoff];

export const RetryBackoffSchema = z.enum(['fixed', 'exponential']);

// ============================================================================
// Asset Types
// ============================================================================

export const AssetType = {
  JSON: 'json',
  TEXT: 'text',
  BINARY: 'binary',
} as const;

export type AssetType = (typeof AssetType)[keyof typeof AssetType];

export const AssetTypeSchema = z.enum(['json', 'text', 'binary']);

// ============================================================================
// Task Options
// ============================================================================

export interface TaskOptions {
  /** Allowed next task IDs for programmatic selection */
  allowedNext?: string[];
  /** Timeout in seconds (default: 300) */
  timeout?: number;
  /** Maximum retry attempts (default: 3) */
  retries?: number;
  /** Backoff strategy (default: 'exponential') */
  retryBackoff?: RetryBackoff;
  /** Base delay between retries in ms (default: 1000) */
  retryDelayMs?: number;
  /** Maximum retry delay in ms (default: 86400000 = 24h) */
  maxRetryDelayMs?: number;
  /** Heartbeat interval in ms (default: 60000) */
  heartbeatIntervalMs?: number;
  /** Max concurrent executions (default: 0 = unlimited) */
  concurrency?: number;
  /** Default priority (lower = higher priority, default: 100) */
  priority?: number;
  /** Function to generate idempotency key */
  idempotencyKey?: (input: unknown, codeVersion: number) => string;
  /** Idempotency cache TTL in seconds (default: 86400) */
  idempotencyTTL?: number;
  /** Human-readable description */
  description?: string;
  /** Input schema for UI form generation and validation (optional) */
  inputSchema?: TaskInputSchema;
}

export const TaskOptionsSchema = z.object({
  allowedNext: z.array(z.string()).optional(),
  timeout: z.number().positive().optional(),
  retries: z.number().nonnegative().optional(),
  retryBackoff: RetryBackoffSchema.optional(),
  retryDelayMs: z.number().positive().optional(),
  maxRetryDelayMs: z.number().positive().optional(),
  heartbeatIntervalMs: z.number().positive().optional(),
  concurrency: z.number().nonnegative().optional(),
  priority: z.number().optional(),
  idempotencyTTL: z.number().positive().optional(),
  description: z.string().optional(),
});

// ============================================================================
// Task Attempt
// ============================================================================

export interface TaskAttempt {
  attempt: number;
  error: string;
  errorCode?: string;
  timestamp: Date;
}

export const TaskAttemptSchema = z.object({
  attempt: z.number().positive(),
  error: z.string(),
  errorCode: z.string().optional(),
  timestamp: z.coerce.date(),
});

// ============================================================================
// Task Context
// ============================================================================

export interface TaskContext<TInput = unknown> {
  /** Unique task run ID */
  runId: string;
  /** Pipeline run ID (if part of pipeline) */
  pipelineRunId?: string;
  /** Current attempt number (1, 2, 3...) */
  attempt: number;

  /** Integer version, increments on code change */
  codeVersion: number;
  /** SHA-256 hash of task handler (16 chars) */
  codeHash: string;

  /** Hydrated input data */
  input: TInput;
  /** All upstream task outputs */
  upstream: Record<string, unknown>;

  /** Previous attempt information */
  previousAttempts: TaskAttempt[];

  /** Persist asset for downstream tasks */
  addAsset(key: string, type: AssetType, data: unknown): Promise<string>;
  /** Add asset from file path (for large files) */
  addAssetFromPath(key: string, type: AssetType, filePath: string): Promise<string>;
  /** Load upstream asset */
  getAsset(key: string): Promise<unknown>;
  /** Get local file path for upstream asset */
  getAssetPath(key: string): Promise<string>;

  /** Report progress */
  progress(percent: number, message?: string): Promise<void>;
  /** Logger instance */
  log: TaskLogger;
}

export interface TaskLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

// ============================================================================
// Task Result
// ============================================================================

export interface TaskResult<TOutput = unknown> {
  /** Task output data */
  output: TOutput;
  /** Programmatically selected next tasks (subset of allowedNext) */
  runNext?: string[];
}

// ============================================================================
// Asset Metadata
// ============================================================================

export interface AssetMetadata {
  path: string;
  size: number;
  type: AssetType;
}

export const AssetMetadataSchema = z.object({
  path: z.string(),
  size: z.number().nonnegative(),
  type: AssetTypeSchema,
});