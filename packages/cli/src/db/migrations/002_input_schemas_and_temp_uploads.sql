-- Migration: 002_input_schemas_and_temp_uploads
-- Description: Add input schema support and temporary upload tracking
-- Created: 2024-11-30

-- ============================================================================
-- Add input_schema column to tasks table
-- ============================================================================

ALTER TABLE tasks
ADD COLUMN IF NOT EXISTS input_schema JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_input_schema
  ON tasks USING GIN (input_schema)
  WHERE input_schema IS NOT NULL;

COMMENT ON COLUMN tasks.input_schema IS 'JSON schema for task input validation and UI form generation (optional)';

-- ============================================================================
-- Temporary Uploads Table
-- ============================================================================

CREATE TABLE IF NOT EXISTS temp_uploads (
  id TEXT PRIMARY KEY,
  storage_path TEXT NOT NULL,
  storage_backend_id TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  claimed_by_run_id TEXT,
  deleted_at TIMESTAMPTZ,

  -- File metadata
  original_filename TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  uploaded_by TEXT,

  -- Additional metadata
  metadata JSONB DEFAULT '{}'::jsonb,

  -- Constraints
  CONSTRAINT temp_uploads_claimed_fk
    FOREIGN KEY (claimed_by_run_id)
    REFERENCES task_runs(id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_temp_uploads_expires_at
  ON temp_uploads(expires_at);

CREATE INDEX IF NOT EXISTS idx_temp_uploads_claimed_by_run_id
  ON temp_uploads(claimed_by_run_id)
  WHERE claimed_by_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_temp_uploads_deleted_at
  ON temp_uploads(deleted_at)
  WHERE deleted_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_temp_uploads_cleanup
  ON temp_uploads(expires_at, claimed_by_run_id, deleted_at)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE temp_uploads IS 'Tracks temporary file uploads from the UI, with automatic cleanup of unclaimed files';
COMMENT ON COLUMN temp_uploads.expires_at IS 'When the upload expires if not claimed (default 24 hours)';
COMMENT ON COLUMN temp_uploads.claimed_by_run_id IS 'Task run ID that claimed this upload (prevents deletion)';
COMMENT ON COLUMN temp_uploads.deleted_at IS 'When the file was deleted from storage';

-- ============================================================================
-- Cleanup Function for Temp Uploads
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_expired_temp_uploads()
RETURNS TABLE (
  deleted_count INTEGER,
  archived_count INTEGER
) AS $$
DECLARE
  v_deleted_count INTEGER := 0;
  v_archived_count INTEGER := 0;
BEGIN
  -- Count expired uploads that need cleanup (not claimed, not deleted, expired)
  SELECT COUNT(*) INTO v_deleted_count
  FROM temp_uploads
  WHERE expires_at < NOW()
    AND claimed_by_run_id IS NULL
    AND deleted_at IS NULL;

  -- Archive old deleted records (older than 30 days)
  DELETE FROM temp_uploads
  WHERE deleted_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_archived_count = ROW_COUNT;

  -- Return counts
  RETURN QUERY SELECT v_deleted_count, v_archived_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_temp_uploads() IS 'Returns count of expired uploads to delete and count of archived records removed';
