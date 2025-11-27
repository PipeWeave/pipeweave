-- Migration: 001_initial_schema
-- Description: Initial database schema for PipeWeave
-- Created: 2024-01-01

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Services Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  base_url TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_heartbeat TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'disconnected')),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_services_status ON services(status);
CREATE INDEX IF NOT EXISTS idx_services_last_heartbeat ON services(last_heartbeat);

-- ============================================================================
-- Tasks Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  code_version INTEGER NOT NULL DEFAULT 1,
  allowed_next TEXT[] DEFAULT ARRAY[]::TEXT[],
  timeout_seconds INTEGER NOT NULL DEFAULT 300,
  retries INTEGER NOT NULL DEFAULT 3,
  retry_backoff TEXT NOT NULL DEFAULT 'exponential' CHECK (retry_backoff IN ('fixed', 'exponential')),
  retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
  max_retry_delay_ms INTEGER NOT NULL DEFAULT 86400000,
  heartbeat_interval_ms INTEGER NOT NULL DEFAULT 60000,
  concurrency INTEGER NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 100,
  idempotency_ttl_seconds INTEGER,
  description TEXT,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tasks_service_id ON tasks(service_id);
CREATE INDEX IF NOT EXISTS idx_tasks_code_hash ON tasks(code_hash);
CREATE INDEX IF NOT EXISTS idx_tasks_code_version ON tasks(code_version);

-- ============================================================================
-- Task Code History Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_code_history (
  id SERIAL PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  code_version INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  service_version TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_code_history_task_id ON task_code_history(task_id);
CREATE INDEX IF NOT EXISTS idx_task_code_history_code_version ON task_code_history(task_id, code_version DESC);

-- ============================================================================
-- Pipelines Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  entry_tasks TEXT[] NOT NULL,
  structure JSONB NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  failure_mode TEXT NOT NULL DEFAULT 'fail-fast' CHECK (failure_mode IN ('fail-fast', 'continue', 'partial-merge')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pipelines_name ON pipelines(name);

-- ============================================================================
-- Pipeline Runs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  pipeline_version TEXT NOT NULL,
  structure_snapshot JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'partial')),
  input_path TEXT,
  output_path TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(created_at DESC);

-- ============================================================================
-- Task Runs Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS task_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  pipeline_run_id TEXT REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  code_version INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'timeout', 'cancelled', 'waiting')),
  attempt INTEGER NOT NULL DEFAULT 1,
  max_retries INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  input_path TEXT,
  output_path TEXT,
  output_size INTEGER,
  assets JSONB DEFAULT '{}'::jsonb,
  logs_path TEXT,
  error TEXT,
  error_code TEXT,
  idempotency_key TEXT,
  upstream_refs JSONB DEFAULT '{}'::jsonb,
  selected_next TEXT[] DEFAULT ARRAY[]::TEXT[],
  previous_attempts JSONB DEFAULT '[]'::jsonb,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  heartbeat_timeout_ms INTEGER,
  scheduled_for TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_runs_task_id ON task_runs(task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_pipeline_run_id ON task_runs(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_status ON task_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_runs_idempotency_key ON task_runs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_runs_scheduled_for ON task_runs(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_runs_created_at ON task_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_pending ON task_runs(priority, created_at) WHERE status = 'pending';

-- ============================================================================
-- Dead Letter Queue Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS dlq (
  id TEXT PRIMARY KEY,
  task_run_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  pipeline_run_id TEXT,
  code_version INTEGER NOT NULL,
  code_hash TEXT NOT NULL,
  error TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  input_path TEXT,
  upstream_refs JSONB DEFAULT '{}'::jsonb,
  previous_attempts JSONB NOT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retried_at TIMESTAMPTZ,
  retry_run_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dlq_task_id ON dlq(task_id);
CREATE INDEX IF NOT EXISTS idx_dlq_pipeline_run_id ON dlq(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_dlq_failed_at ON dlq(failed_at DESC);
CREATE INDEX IF NOT EXISTS idx_dlq_retried_at ON dlq(retried_at) WHERE retried_at IS NOT NULL;

-- ============================================================================
-- Idempotency Cache Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS idempotency_cache (
  idempotency_key TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_run_id TEXT NOT NULL,
  code_version INTEGER NOT NULL,
  output_path TEXT NOT NULL,
  output_size INTEGER,
  assets JSONB DEFAULT '{}'::jsonb,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_idempotency_cache_task_id ON idempotency_cache(task_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_cache_expires_at ON idempotency_cache(expires_at);

-- ============================================================================
-- Functions & Triggers
-- ============================================================================

-- Update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_pipelines_updated_at ON pipelines;
CREATE TRIGGER update_pipelines_updated_at BEFORE UPDATE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Cleanup expired idempotency cache entries
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_cache()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM idempotency_cache WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ language 'plpgsql';
