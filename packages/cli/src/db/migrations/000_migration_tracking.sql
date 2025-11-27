-- Migration: 000_migration_tracking
-- Description: Create migration tracking table (always runs first)
-- Created: 2024-01-01

-- ============================================================================
-- Migration Tracking Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum TEXT NOT NULL,
  execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_version ON schema_migrations(version);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

-- ============================================================================
-- Orchestrator State Table (for maintenance mode)
-- ============================================================================

CREATE TABLE IF NOT EXISTS orchestrator_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  mode TEXT NOT NULL DEFAULT 'running' CHECK (mode IN ('running', 'waiting_for_maintenance', 'maintenance')),
  mode_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pending_tasks_count INTEGER DEFAULT 0,
  running_tasks_count INTEGER DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default state
INSERT INTO orchestrator_state (id, mode) VALUES ('singleton', 'running')
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_orchestrator_state_mode ON orchestrator_state(mode);

-- Trigger to update timestamp
CREATE OR REPLACE FUNCTION update_orchestrator_state_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  IF NEW.mode != OLD.mode THEN
    NEW.mode_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_orchestrator_state_updated_at ON orchestrator_state;
CREATE TRIGGER update_orchestrator_state_updated_at BEFORE UPDATE ON orchestrator_state
  FOR EACH ROW EXECUTE FUNCTION update_orchestrator_state_timestamp();
