import { z } from 'zod';
import {
  TaskStatus,
  TaskStatusSchema,
  PipelineStatus,
  PipelineStatusSchema,
  FailureMode,
  FailureModeSchema,
  AssetMetadataSchema,
} from './task.js';
import type { AssetMetadata } from './task.js';
import { TaskInputSchemaSchema } from './input-schema.js';
import type { TaskInputSchema } from './input-schema.js';

// ============================================================================
// Task Definition (registered with orchestrator)
// ============================================================================

export interface TaskDefinition {
  id: string;
  serviceId: string;
  codeHash: string;
  codeVersion: number;
  allowedNext: string[];
  timeout: number;
  retries: number;
  retryBackoff: 'fixed' | 'exponential';
  retryDelayMs: number;
  maxRetryDelayMs: number;
  heartbeatIntervalMs: number;
  concurrency: number;
  priority: number;
  idempotencyTTL?: number;
  description?: string;
  registeredAt: Date;
  updatedAt: Date;
}

export const TaskDefinitionSchema = z.object({
  id: z.string(),
  serviceId: z.string(),
  codeHash: z.string(),
  codeVersion: z.number().positive(),
  allowedNext: z.array(z.string()),
  timeout: z.number().positive(),
  retries: z.number().nonnegative(),
  retryBackoff: z.enum(['fixed', 'exponential']),
  retryDelayMs: z.number().positive(),
  maxRetryDelayMs: z.number().positive(),
  heartbeatIntervalMs: z.number().positive(),
  concurrency: z.number().nonnegative(),
  priority: z.number(),
  idempotencyTTL: z.number().positive().optional(),
  description: z.string().optional(),
  registeredAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================================================
// Task Run (execution instance)
// ============================================================================

export interface TaskRun {
  id: string;
  taskId: string;
  pipelineRunId?: string;
  status: TaskStatus;
  codeVersion: number;
  codeHash: string;
  attempt: number;
  priority: number;

  inputPath: string;
  outputPath?: string;
  outputSize?: number;
  assets?: Record<string, AssetMetadata>;
  logsPath?: string;

  error?: string;
  errorCode?: string;

  idempotencyKey?: string;

  scheduledAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  lastHeartbeat?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const TaskRunSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  pipelineRunId: z.string().optional(),
  status: TaskStatusSchema,
  codeVersion: z.number().positive(),
  codeHash: z.string(),
  attempt: z.number().positive(),
  priority: z.number(),
  inputPath: z.string(),
  outputPath: z.string().optional(),
  outputSize: z.number().nonnegative().optional(),
  assets: z.record(AssetMetadataSchema).optional(),
  logsPath: z.string().optional(),
  error: z.string().optional(),
  errorCode: z.string().optional(),
  idempotencyKey: z.string().optional(),
  scheduledAt: z.coerce.date().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  lastHeartbeat: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================================================
// Pipeline Definition
// ============================================================================

export interface PipelineDefinition {
  id: string;
  name: string;
  entryTaskIds: string[];
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const PipelineDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  entryTaskIds: z.array(z.string()),
  description: z.string().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================================================
// Pipeline Run
// ============================================================================

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: PipelineStatus;
  failureMode: FailureMode;

  inputPath: string;
  outputPath?: string;

  /** Snapshot of pipeline structure at creation time */
  structureSnapshot: Record<string, { allowedNext: string[] }>;
  pipelineVersion: string;

  error?: string;

  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const PipelineRunSchema = z.object({
  id: z.string(),
  pipelineId: z.string(),
  status: PipelineStatusSchema,
  failureMode: FailureModeSchema,
  inputPath: z.string(),
  outputPath: z.string().optional(),
  structureSnapshot: z.record(z.object({ allowedNext: z.array(z.string()) })),
  pipelineVersion: z.string(),
  error: z.string().optional(),
  startedAt: z.coerce.date().optional(),
  completedAt: z.coerce.date().optional(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

// ============================================================================
// Service Registration
// ============================================================================

export interface ServiceRegistration {
  id: string;
  version: string;
  baseUrl: string;
  tasks: TaskRegistrationInfo[];
  registeredAt: Date;
  lastHeartbeat: Date;
}

export interface TaskRegistrationInfo {
  id: string;
  codeHash: string;
  allowedNext: string[];
  timeout: number;
  retries: number;
  retryBackoff: 'fixed' | 'exponential';
  retryDelayMs: number;
  maxRetryDelayMs: number;
  heartbeatIntervalMs: number;
  concurrency: number;
  priority: number;
  idempotencyTTL?: number;
  description?: string;
  inputSchema?: TaskInputSchema;
}

export const TaskRegistrationInfoSchema = z.object({
  id: z.string(),
  codeHash: z.string(),
  allowedNext: z.array(z.string()),
  timeout: z.number().positive(),
  retries: z.number().nonnegative(),
  retryBackoff: z.enum(['fixed', 'exponential']),
  retryDelayMs: z.number().positive(),
  maxRetryDelayMs: z.number().positive(),
  heartbeatIntervalMs: z.number().positive(),
  concurrency: z.number().nonnegative(),
  priority: z.number(),
  idempotencyTTL: z.number().positive().optional(),
  description: z.string().optional(),
  inputSchema: TaskInputSchemaSchema.optional(),
});

export const ServiceRegistrationSchema = z.object({
  id: z.string(),
  version: z.string(),
  baseUrl: z.string().url(),
  tasks: z.array(TaskRegistrationInfoSchema),
  registeredAt: z.coerce.date(),
  lastHeartbeat: z.coerce.date(),
});

// ============================================================================
// Code Change Info
// ============================================================================

export interface CodeChangeInfo {
  taskId: string;
  oldHash: string;
  newHash: string;
  oldVersion: number;
  newVersion: number;
}

export const CodeChangeInfoSchema = z.object({
  taskId: z.string(),
  oldHash: z.string(),
  newHash: z.string(),
  oldVersion: z.number().positive(),
  newVersion: z.number().positive(),
});

// ============================================================================
// Task Code History
// ============================================================================

export interface TaskCodeHistory {
  id: string;
  taskId: string;
  codeHash: string;
  codeVersion: number;
  serviceVersion: string;
  recordedAt: Date;
}

export const TaskCodeHistorySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  codeHash: z.string(),
  codeVersion: z.number().positive(),
  serviceVersion: z.string(),
  recordedAt: z.coerce.date(),
});