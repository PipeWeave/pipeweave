import type { Database } from './db/index.js';
import logger from './logger.js';

// ============================================================================
// Types
// ============================================================================

export type OrchestratorMode = 'running' | 'waiting_for_maintenance' | 'maintenance';

export interface OrchestratorState {
  id: string;
  mode: OrchestratorMode;
  mode_changed_at: Date;
  pending_tasks_count: number;
  running_tasks_count: number;
  metadata: Record<string, any>;
  updated_at: Date;
}

export interface MaintenanceStatus {
  mode: OrchestratorMode;
  canEnterMaintenance: boolean;
  pendingTasks: number;
  runningTasks: number;
  modeChangedAt: Date;
  message: string;
}

// ============================================================================
// Maintenance Mode Management
// ============================================================================

/**
 * Get current orchestrator state
 */
export async function getOrchestratorState(db: Database): Promise<OrchestratorState> {
  const state = await db.oneOrNone<OrchestratorState>(
    `SELECT * FROM orchestrator_state WHERE id = 'singleton'`
  );

  if (!state) {
    // Initialize if not exists
    return await db.one<OrchestratorState>(
      `INSERT INTO orchestrator_state (id, mode)
       VALUES ('singleton', 'running')
       RETURNING *`
    );
  }

  return state;
}

/**
 * Update orchestrator mode
 */
export async function setOrchestratorMode(
  db: Database,
  mode: OrchestratorMode
): Promise<OrchestratorState> {
  return await db.one<OrchestratorState>(
    `UPDATE orchestrator_state
     SET mode = $1
     WHERE id = 'singleton'
     RETURNING *`,
    [mode]
  );
}

/**
 * Get counts of pending and running tasks
 */
export async function getTaskCounts(db: Database): Promise<{
  pending: number;
  running: number;
}> {
  const result = await db.one<{ pending: string; running: string }>(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') as pending,
       COUNT(*) FILTER (WHERE status = 'running') as running
     FROM task_runs
     WHERE status IN ('pending', 'running')`
  );

  return {
    pending: parseInt(result.pending),
    running: parseInt(result.running),
  };
}

/**
 * Update task counts in orchestrator state
 */
export async function updateTaskCounts(db: Database): Promise<void> {
  const counts = await getTaskCounts(db);

  await db.none(
    `UPDATE orchestrator_state
     SET pending_tasks_count = $1,
         running_tasks_count = $2
     WHERE id = 'singleton'`,
    [counts.pending, counts.running]
  );
}

/**
 * Request maintenance mode
 * Transitions from 'running' to 'waiting_for_maintenance'
 */
export async function requestMaintenance(db: Database): Promise<MaintenanceStatus> {
  const state = await getOrchestratorState(db);

  if (state.mode === 'maintenance') {
    return {
      mode: state.mode,
      canEnterMaintenance: true,
      pendingTasks: 0,
      runningTasks: 0,
      modeChangedAt: state.mode_changed_at,
      message: 'Already in maintenance mode',
    };
  }

  if (state.mode === 'waiting_for_maintenance') {
    // Update counts
    await updateTaskCounts(db);
    const counts = await getTaskCounts(db);

    return {
      mode: state.mode,
      canEnterMaintenance: counts.pending === 0 && counts.running === 0,
      pendingTasks: counts.pending,
      runningTasks: counts.running,
      modeChangedAt: state.mode_changed_at,
      message: `Waiting for ${counts.pending + counts.running} tasks to complete`,
    };
  }

  // Transition to waiting_for_maintenance
  const newState = await setOrchestratorMode(db, 'waiting_for_maintenance');
  await updateTaskCounts(db);
  const counts = await getTaskCounts(db);

  logger.info('[maintenance] Requested maintenance mode');
  logger.info(`[maintenance] Waiting for ${counts.pending + counts.running} tasks to complete`);

  return {
    mode: newState.mode,
    canEnterMaintenance: counts.pending === 0 && counts.running === 0,
    pendingTasks: counts.pending,
    runningTasks: counts.running,
    modeChangedAt: newState.mode_changed_at,
    message: `Waiting for ${counts.pending + counts.running} tasks to complete`,
  };
}

/**
 * Enter maintenance mode (only if no tasks are running)
 * Transitions from 'waiting_for_maintenance' to 'maintenance'
 */
export async function enterMaintenance(db: Database): Promise<MaintenanceStatus> {
  const state = await getOrchestratorState(db);

  if (state.mode === 'maintenance') {
    return {
      mode: state.mode,
      canEnterMaintenance: true,
      pendingTasks: 0,
      runningTasks: 0,
      modeChangedAt: state.mode_changed_at,
      message: 'Already in maintenance mode',
    };
  }

  if (state.mode === 'running') {
    throw new Error('Cannot enter maintenance directly from running mode. Call requestMaintenance() first.');
  }

  // Check if we can enter maintenance
  await updateTaskCounts(db);
  const counts = await getTaskCounts(db);

  if (counts.pending > 0 || counts.running > 0) {
    return {
      mode: state.mode,
      canEnterMaintenance: false,
      pendingTasks: counts.pending,
      runningTasks: counts.running,
      modeChangedAt: state.mode_changed_at,
      message: `Cannot enter maintenance: ${counts.pending + counts.running} tasks still active`,
    };
  }

  // Enter maintenance
  const newState = await setOrchestratorMode(db, 'maintenance');
  logger.info('[maintenance] Entered maintenance mode');

  return {
    mode: newState.mode,
    canEnterMaintenance: true,
    pendingTasks: 0,
    runningTasks: 0,
    modeChangedAt: newState.mode_changed_at,
    message: 'Maintenance mode active',
  };
}

/**
 * Exit maintenance mode
 * Transitions from 'maintenance' to 'running'
 */
export async function exitMaintenance(db: Database): Promise<OrchestratorState> {
  const state = await getOrchestratorState(db);

  if (state.mode === 'running') {
    logger.info('[maintenance] Already in running mode');
    return state;
  }

  const newState = await setOrchestratorMode(db, 'running');
  logger.info('[maintenance] Exited maintenance mode - orchestrator is now running');

  return newState;
}

/**
 * Check if orchestrator can accept new tasks
 */
export async function canAcceptTasks(db: Database): Promise<boolean> {
  const state = await getOrchestratorState(db);
  return state.mode === 'running';
}

/**
 * Get maintenance status
 */
export async function getMaintenanceStatus(db: Database): Promise<MaintenanceStatus> {
  const state = await getOrchestratorState(db);
  await updateTaskCounts(db);
  const counts = await getTaskCounts(db);

  const canEnter = counts.pending === 0 && counts.running === 0;

  let message: string;
  switch (state.mode) {
    case 'running':
      message = 'Orchestrator is running normally';
      break;
    case 'waiting_for_maintenance':
      message = canEnter
        ? 'Ready to enter maintenance mode'
        : `Waiting for ${counts.pending + counts.running} tasks to complete`;
      break;
    case 'maintenance':
      message = 'Maintenance mode active - no new tasks accepted';
      break;
  }

  return {
    mode: state.mode,
    canEnterMaintenance: canEnter,
    pendingTasks: counts.pending,
    runningTasks: counts.running,
    modeChangedAt: state.mode_changed_at,
    message,
  };
}

/**
 * Auto-transition to maintenance if waiting and all tasks complete
 * Called after task status changes (event-driven)
 */
export async function checkMaintenanceTransition(db: Database): Promise<boolean> {
  const state = await getOrchestratorState(db);

  if (state.mode !== 'waiting_for_maintenance') {
    return false;
  }

  await updateTaskCounts(db);
  const counts = await getTaskCounts(db);

  if (counts.pending === 0 && counts.running === 0) {
    await enterMaintenance(db);
    return true;
  }

  return false;
}

/**
 * Hook to call after task status changes
 * Checks if maintenance mode transition is needed
 * This is event-driven and doesn't require polling
 */
export async function onTaskStatusChange(db: Database): Promise<void> {
  try {
    const transitioned = await checkMaintenanceTransition(db);
    if (transitioned) {
      logger.info('[maintenance] Auto-transitioned to maintenance mode (event-driven)');
    }
  } catch (error) {
    logger.error('[maintenance] Error in onTaskStatusChange hook', { error });
  }
}
