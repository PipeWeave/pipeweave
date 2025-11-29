# Changelog - Database & Maintenance Mode Implementation

## 1.0.0

### Major Changes

- 52bf545: first inital realease of pipeweave

### Patch Changes

- Updated dependencies [52bf545]
  - @pipeweave/shared@1.0.0

## Summary

Implemented comprehensive database migration system and maintenance mode functionality for the PipeWeave orchestrator.

## What's New

### 🔄 Database Migrations

- **Version-based migration system** with automatic tracking
- **Checksum validation** to detect modified migrations
- **CLI commands** for running and managing migrations
- **Migration tracking table** (`schema_migrations`) with execution time and history
- **Auto-migration** option for development (not recommended for production)

**Files Created:**

- `src/db/migrations/000_migration_tracking.sql` - Migration tracking & orchestrator state tables
- `src/db/migrations/001_initial_schema.sql` - Initial database schema
- `src/db/migration-runner.ts` - Migration discovery, validation, and execution

### 🛠️ Maintenance Mode

- **Three-state system**: `running` → `waiting_for_maintenance` → `maintenance`
- **Graceful task completion**: Waits for all tasks to finish before entering maintenance
- **Auto-transition**: Automatically enters maintenance when all tasks complete
- **Task rejection**: No new tasks accepted in maintenance mode
- **CLI commands** for maintenance mode control

**States:**

1. **running** - Normal operation, accepting new tasks
2. **waiting_for_maintenance** - Draining tasks, no new tasks accepted
3. **maintenance** - Safe for migrations, no tasks running

**Files Created:**

- `src/maintenance.ts` - Maintenance mode state management
- `src/db/migrations/000_migration_tracking.sql` - Orchestrator state table

### 📟 CLI Commands

New `pipeweave` CLI with commands for both migrations and maintenance:

**Migration Commands:**

```bash
pipeweave db:migrate      # Run pending migrations
pipeweave db:status       # Show migration status
pipeweave db:validate     # Validate migration files
pipeweave db:cleanup      # Cleanup expired cache/DLQ
```

**Maintenance Commands:**

```bash
pipeweave maintenance:status   # Show maintenance status
pipeweave maintenance:request  # Request maintenance mode
pipeweave maintenance:enter    # Force enter (if ready)
pipeweave maintenance:exit     # Exit maintenance mode
```

**Files Created:**

- `src/bin/pipeweave-cli.ts` - New unified CLI

### 🔧 Orchestrator Updates

**Enhanced Configuration:**

```typescript
interface OrchestratorConfig {
  // ... existing config
  autoMigrate?: boolean; // Auto-run migrations (default: false)
  maintenanceCheckIntervalMs?: number; // Check interval (default: 5000ms)
}
```

**New Methods:**

```typescript
// Maintenance mode methods
orchestrator.getMaintenanceStatus();
orchestrator.requestMaintenance();
orchestrator.enterMaintenance();
orchestrator.exitMaintenance();
orchestrator.canAcceptTasks();
```

**Auto-Features:**

- Runs migrations on startup if `autoMigrate: true`
- Displays current maintenance mode on startup
- Background checker for auto-transition every 5 seconds
- Graceful shutdown support

### 📚 Documentation

**New Documents:**

- `MIGRATIONS_AND_MAINTENANCE.md` - Complete guide for migrations and maintenance mode
- Updated `DATABASE.md` - Database setup with migration instructions
- Updated `EXAMPLE_USAGE.md` - Added migration and maintenance examples

## Database Schema Changes

### New Tables

#### `schema_migrations`

Tracks applied migrations:

- `version` - Migration version number
- `name` - Migration name
- `checksum` - SHA-256 hash for validation
- `applied_at` - When applied
- `execution_time_ms` - How long it took

#### `orchestrator_state`

Tracks orchestrator operational state:

- `mode` - Current mode (running/waiting_for_maintenance/maintenance)
- `pending_tasks_count` - Number of pending tasks
- `running_tasks_count` - Number of running tasks
- `mode_changed_at` - When mode last changed

### Updated Schema

The main schema SQL was moved from:

- `src/db/schema.sql` (deprecated, kept for reference)

To versioned migrations:

- `src/db/migrations/000_migration_tracking.sql`
- `src/db/migrations/001_initial_schema.sql`

## Breaking Changes

### ⚠️ Database Initialization

**Before:**

```bash
pipeweave-db init
```

**After:**

```bash
pipeweave db:migrate
```

**Migration Path:**

1. Old `init` command still works but is deprecated
2. New deployments should use `pipeweave db:migrate`
3. Auto-migration via `AUTO_MIGRATE=true` (dev only)

### ⚠️ Environment Variables

**Removed:**

- `AUTO_INIT_DB` (replaced with `AUTO_MIGRATE`)

**Added:**

- `AUTO_MIGRATE` - Auto-run migrations on startup
- `MAINTENANCE_CHECK_INTERVAL_MS` - Auto-transition check interval

## Usage Examples

### Basic Migration Workflow

```bash
# 1. Check current status
pipeweave db:status

# 2. Validate migrations
pipeweave db:validate

# 3. Run migrations
pipeweave db:migrate

# Output:
# [migrations] Checking migration status...
# [migrations] Found 2 migration files
# [migrations] Current version: none
# [migrations] Pending migrations: 2
#
# [migrations] Applying 000_migration_tracking...
# [migrations] ✓ Applied 000_migration_tracking (45ms)
# [migrations] Applying 001_initial_schema...
# [migrations] ✓ Applied 001_initial_schema (123ms)
#
# [migrations] ✓ Applied 2 migration(s)
```

### Maintenance Mode Workflow

```bash
# 1. Request maintenance
pipeweave maintenance:request
# Output: Waiting for 5 tasks to complete

# 2. Wait for auto-transition (or check status)
pipeweave maintenance:status
# Output: Mode: maintenance

# 3. Run migrations safely
pipeweave db:migrate

# 4. Exit maintenance
pipeweave maintenance:exit
# Output: Orchestrator is now running normally
```

### Programmatic Usage

```typescript
import { createOrchestrator } from "@pipeweave/orchestrator";

const orchestrator = createOrchestrator({
  databaseUrl: process.env.DATABASE_URL,
  autoMigrate: false, // Don't auto-run in production
  maintenanceCheckIntervalMs: 5000,
  // ... other config
});

await orchestrator.start();

// Before running migrations
await orchestrator.requestMaintenance();

// Wait for auto-transition
const status = await orchestrator.getMaintenanceStatus();
if (status.mode === "maintenance") {
  // Safe to run migrations
}

// After migrations
await orchestrator.exitMaintenance();
```

## Files Added/Modified

### Added Files

```
src/db/migrations/
  000_migration_tracking.sql      - Migration tracking & orchestrator state
  001_initial_schema.sql          - Initial database schema

src/db/migration-runner.ts        - Migration execution engine
src/maintenance.ts                - Maintenance mode management
src/bin/pipeweave-cli.ts          - New unified CLI

MIGRATIONS_AND_MAINTENANCE.md     - Complete guide
CHANGELOG.md                       - This file
```

### Modified Files

```
src/orchestrator.ts               - Added maintenance mode integration
src/index.ts                      - Added new exports
src/db/index.ts                   - No changes (already complete)
src/db/migrations.ts              - Kept for backward compatibility
package.json                      - Added 'pipeweave' CLI entry
```

## Migration Guide

### From Old to New

**If you previously used `pipeweave-db init`:**

1. **Backup your database**

   ```bash
   pg_dump $DATABASE_URL > backup.sql
   ```

2. **Run migrations**

   ```bash
   pipeweave db:migrate
   ```

3. **Verify**
   ```bash
   pipeweave db:status
   ```

**If starting fresh:**

Just run:

```bash
pipeweave db:migrate
```

## Testing

Run the comprehensive test script:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/pipeweave_test pipeweave-test-db
```

## Next Steps

1. ✅ Database migrations working
2. ✅ Maintenance mode implemented
3. ✅ CLI commands complete
4. ✅ Documentation written
5. 🔜 Integrate with actual task dispatch logic
6. 🔜 Add HTTP endpoints for maintenance mode
7. 🔜 Add UI for maintenance mode status

## API Changes

### New Exports

```typescript
// Migration Runner
export {
  runMigrations,
  getMigrationStatus,
  validateMigrations,
  discoverMigrations,
} from "@pipeweave/orchestrator";

// Maintenance Mode
export {
  getOrchestratorState,
  getMaintenanceStatus,
  requestMaintenance,
  enterMaintenance,
  exitMaintenance,
  canAcceptTasks,
  checkMaintenanceTransition,
} from "@pipeweave/orchestrator";

// Types
export type {
  Migration,
  AppliedMigration,
  MigrationStatus,
  OrchestratorMode,
  OrchestratorState,
  MaintenanceStatus,
} from "@pipeweave/orchestrator";
```

### Orchestrator Methods

```typescript
// New methods on Orchestrator class
orchestrator.getMaintenanceStatus(): Promise<MaintenanceStatus>
orchestrator.requestMaintenance(): Promise<MaintenanceStatus>
orchestrator.enterMaintenance(): Promise<MaintenanceStatus>
orchestrator.exitMaintenance(): Promise<void>
orchestrator.canAcceptTasks(): Promise<boolean>
```

## Notes

- All migrations run in transactions
- Checksums prevent accidental modification of applied migrations
- Auto-transition runs every 5 seconds by default
- Maintenance mode state persists across orchestrator restarts
- CLI supports both connection string and individual credentials

## References

- [MIGRATIONS_AND_MAINTENANCE.md](./MIGRATIONS_AND_MAINTENANCE.md) - Complete guide
- [DATABASE.md](./DATABASE.md) - Database setup
- [EXAMPLE_USAGE.md](./EXAMPLE_USAGE.md) - Usage examples
- [MIGRATION_SUMMARY.md](./MIGRATION_SUMMARY.md) - pg-promise migration summary
