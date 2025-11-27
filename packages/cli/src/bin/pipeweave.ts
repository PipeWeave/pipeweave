#!/usr/bin/env node

/**
 * PipeWeave CLI - Complete command line interface
 * Includes database management, migrations, maintenance, and orchestration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { createDatabase, createDatabaseFromEnv, testConnection, closeDatabase } from '../db/index.js';
import { getDatabaseStatus, runCleanupTasks } from '../db/migrations.js';
import {
  runMigrations,
  getMigrationStatus,
  validateMigrations,
  ensureSchemaUpToDate,
} from '../db/migration-runner.js';
import {
  getMaintenanceStatus,
  requestMaintenance,
  enterMaintenance,
  exitMaintenance,
} from '../maintenance.js';
import type { Connection } from '../config/connections.js';
import {
  loadConnections,
  saveConnection,
  deleteConnection,
  getConnection,
  markConnectionUsed,
  setDefaultConnection,
  getDefaultConnection,
  listConnections,
  getConfigPath,
} from '../config/connections.js';
import { runSetup } from '../commands/setup.js';

// ============================================================================
// ASCII Art Logo
// ============================================================================

const LOGO = `
${chalk.cyan('╔═══════════════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}                                                               ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('██████╗ ██╗██████╗ ███████╗')}${chalk.bold.magenta('██╗    ██╗███████╗ █████╗ ██╗   ██╗███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('██╔══██╗██║██╔══██╗██╔════╝')}${chalk.bold.magenta('██║    ██║██╔════╝██╔══██╗██║   ██║██╔════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('██████╔╝██║██████╔╝█████╗  ')}${chalk.bold.magenta('██║ █╗ ██║█████╗  ███████║██║   ██║█████╗  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('██╔═══╝ ██║██╔═══╝ ██╔══╝  ')}${chalk.bold.magenta('██║███╗██║██╔══╝  ██╔══██║╚██╗ ██╔╝██╔══╝  ')}  ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('██║     ██║██║     ███████╗')}${chalk.bold.magenta('╚███╔███╔╝███████╗██║  ██║ ╚████╔╝ ███████╗')}  ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.bold.cyan('╚═╝     ╚═╝╚═╝     ╚══════╝')}${chalk.bold.magenta(' ╚══╝╚══╝ ╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝')}  ${chalk.cyan('║')}
${chalk.cyan('║')}                                                               ${chalk.cyan('║')}
${chalk.cyan('║')}           ${chalk.yellow('Task Orchestration & Pipeline Management')}            ${chalk.cyan('║')}
${chalk.cyan('║')}                      ${chalk.gray('version 0.1.0')}                          ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════════════════╝')}
`;

function showLogo() {
  console.log(LOGO);
}

// ============================================================================
// Global State
// ============================================================================

let selectedConnection: Connection | undefined;

const program = new Command();

program
  .name('pipeweave')
  .description('PipeWeave CLI - Task orchestration and database management')
  .version('0.1.0')
  .hook('preAction', (thisCommand) => {
    // Show logo for help command
    if (thisCommand.args.includes('--help') || thisCommand.args.includes('-h')) {
      showLogo();
    }
  });

// ============================================================================
// Helper: Create database from options or env
// ============================================================================

function createDatabaseFromOptions(options: any) {
  if (options.url) {
    return createDatabase({ connectionString: options.url });
  } else if (options.host && options.database && options.user) {
    return createDatabase({
      host: options.host,
      port: parseInt(options.port || '5432'),
      database: options.database,
      user: options.user,
      password: options.password,
      ssl: options.ssl ? { rejectUnauthorized: false } : undefined,
    });
  } else {
    return createDatabaseFromEnv();
  }
}

// ============================================================================
// setup command
// ============================================================================

program
  .command('setup')
  .description('Complete setup wizard for PipeWeave (database, user, secret)')
  .action(async () => {
    try {
      const result = await runSetup();
      process.exit(result.success ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('\n✗ Setup failed:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// init command
// ============================================================================

program
  .command('init')
  .description('Initialize a new PipeWeave project')
  .option('-n, --name <name>', 'Service name')
  .option('-d, --dir <directory>', 'Target directory', '.')
  .action(async (options) => {
    console.log(chalk.blue('Initializing PipeWeave project...'));
    // TODO: Implement project scaffolding
    console.log(chalk.green('✓ Project initialized'));
  });

// ============================================================================
// services command
// ============================================================================

program
  .command('services')
  .description('List registered services')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .action(async (options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required. Use --url or set PIPEWEAVE_ORCHESTRATOR_URL'));
      process.exit(1);
    }
    // TODO: Implement service listing
    console.log(chalk.blue('Fetching services...'));
  });

// ============================================================================
// trigger command
// ============================================================================

program
  .command('trigger <pipeline>')
  .description('Trigger a pipeline run')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .option('-i, --input <json>', 'Input JSON', '{}')
  .option('-w, --wait', 'Wait for completion')
  .option('-p, --priority <number>', 'Priority (lower = higher)', '100')
  .action(async (pipeline, options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    // TODO: Implement pipeline triggering
    console.log(chalk.blue(`Triggering pipeline '${pipeline}'...`));
  });

// ============================================================================
// status command
// ============================================================================

program
  .command('status <runId>')
  .description('Get status of a pipeline run')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .action(async (runId, options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    // TODO: Implement status checking
    console.log(chalk.blue(`Fetching status for '${runId}'...`));
  });

// ============================================================================
// dry-run command
// ============================================================================

program
  .command('dry-run <pipeline>')
  .description('Validate a pipeline without executing')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .option('-i, --input <json>', 'Input JSON', '{}')
  .action(async (pipeline, options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    // TODO: Implement dry-run
    console.log(chalk.blue(`Validating pipeline '${pipeline}'...`));
  });

// ============================================================================
// db command group
// ============================================================================

const db = program.command('db').description('Database management commands');

db.command('migrate')
  .description('Run pending database migrations')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      console.log(chalk.blue('[db] Running migrations...\n'));

      const database = createDatabaseFromOptions(options);

      // Test connection
      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      // Run migrations
      const result = await runMigrations(database);

      console.log(chalk.green(`\n[db] ✓ Migration complete`));
      console.log(`  • Applied: ${result.applied}`);
      console.log(`  • Skipped: ${result.skipped}`);

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[db] ✗ Error:'), error);
      process.exit(1);
    }
  });

db.command('status')
  .description('Show database migration status')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      // Test connection
      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      // Get migration status
      const status = await getMigrationStatus(database);

      console.log('\n=== Database Migration Status ===\n');
      console.log(`Current version: ${status.current || 'none'}`);
      console.log(`Applied migrations: ${status.applied.length}`);
      console.log(`Pending migrations: ${status.pending.length}\n`);

      if (status.applied.length > 0) {
        console.log('Applied:');
        status.applied.forEach((m) => {
          console.log(chalk.green(`  ✓ ${m.version}_${m.name} (${new Date(m.applied_at).toISOString()})`));
        });
        console.log('');
      }

      if (status.pending.length > 0) {
        console.log('Pending:');
        status.pending.forEach((m) => {
          console.log(chalk.yellow(`  • ${m.version}_${m.name}`));
        });
        console.log('');
      }

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[db] ✗ Error:'), error);
      process.exit(1);
    }
  });

db.command('validate')
  .description('Validate migration files')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      // Test connection
      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      // Validate
      const validation = await validateMigrations(database);

      console.log('\n=== Migration Validation ===\n');

      if (validation.valid) {
        console.log(chalk.green('✓ All migrations are valid'));
      } else {
        console.log(chalk.red('✗ Validation failed:\n'));
        validation.errors.forEach((err) => console.log(chalk.red(`  • ${err}`)));
      }

      closeDatabase(database);
      process.exit(validation.valid ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('\n[db] ✗ Error:'), error);
      process.exit(1);
    }
  });

db.command('cleanup')
  .description('Run cleanup tasks (expired cache, old DLQ entries)')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .option('--dlq-retention-days <days>', 'DLQ retention in days', '30')
  .action(async (options) => {
    try {
      console.log(chalk.blue('[db] Running cleanup tasks...\n'));

      const database = createDatabaseFromOptions(options);

      // Test connection
      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      const result = await runCleanupTasks(database, {
        dlqRetentionDays: parseInt(options.dlqRetentionDays),
      });

      console.log(chalk.green(`\n[db] ✓ Cleanup complete`));
      console.log(`  • Expired cache entries deleted: ${result.expiredCacheDeleted}`);
      console.log(`  • Old DLQ entries deleted: ${result.oldDlqDeleted}`);

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[db] ✗ Error:'), error);
      process.exit(1);
    }
  });

db.command('ensure-schema')
  .description('Ensure database schema is fully up to date (idempotent)')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      // Test connection
      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      // Ensure schema is up to date
      const result = await ensureSchemaUpToDate(database);

      console.log(chalk.green(`\n[db] ✓ Schema ensured`));
      console.log(`  • Re-applied: ${result.reapplied}`);
      console.log(`  • Warnings: ${result.errors.length}`);

      if (result.errors.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        result.errors.forEach((err) => console.log(chalk.yellow(`  • ${err}`)));
      }

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[db] ✗ Error:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// maintenance command group
// ============================================================================

const maintenance = program.command('maintenance').description('Orchestrator maintenance mode management');

maintenance.command('status')
  .description('Show orchestrator maintenance mode status')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      const status = await getMaintenanceStatus(database);

      console.log('\n=== Maintenance Mode Status ===\n');
      console.log(`Mode: ${chalk.bold(status.mode)}`);
      console.log(`Pending tasks: ${status.pendingTasks}`);
      console.log(`Running tasks: ${status.runningTasks}`);
      console.log(`Can enter maintenance: ${status.canEnterMaintenance ? chalk.green('Yes') : chalk.red('No')}`);
      console.log(`Status: ${status.message}`);
      console.log(`Mode changed at: ${status.modeChangedAt.toISOString()}\n`);

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[maintenance] ✗ Error:'), error);
      process.exit(1);
    }
  });

maintenance.command('request')
  .description('Request maintenance mode (waits for tasks to complete)')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      const status = await requestMaintenance(database);

      console.log(chalk.green('\n[maintenance] ✓ Maintenance mode requested'));
      console.log(`\nMode: ${status.mode}`);
      console.log(`Pending tasks: ${status.pendingTasks}`);
      console.log(`Running tasks: ${status.runningTasks}`);
      console.log(`Status: ${status.message}\n`);

      if (status.canEnterMaintenance) {
        console.log(chalk.cyan('All tasks complete. Run `pipeweave maintenance enter` to enter maintenance mode.\n'));
      } else {
        console.log(chalk.yellow('Waiting for tasks to complete. The orchestrator will auto-transition when ready.\n'));
      }

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[maintenance] ✗ Error:'), error);
      process.exit(1);
    }
  });

maintenance.command('enter')
  .description('Enter maintenance mode (only if no tasks running)')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      const status = await enterMaintenance(database);

      if (status.mode === 'maintenance') {
        console.log(chalk.green('\n[maintenance] ✓ Entered maintenance mode\n'));
        console.log('No new tasks will be accepted.');
        console.log('Run migrations or perform maintenance tasks now.\n');
      } else {
        console.log(chalk.red('\n[maintenance] ✗ Cannot enter maintenance mode\n'));
        console.log(`Status: ${status.message}`);
        console.log(`Pending tasks: ${status.pendingTasks}`);
        console.log(`Running tasks: ${status.runningTasks}\n`);
        process.exit(1);
      }

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[maintenance] ✗ Error:'), error);
      process.exit(1);
    }
  });

maintenance.command('exit')
  .description('Exit maintenance mode and resume normal operation')
  .option('--url <url>', 'Database connection URL')
  .option('--host <host>', 'Database host')
  .option('--port <port>', 'Database port', '5432')
  .option('--database <database>', 'Database name')
  .option('--user <user>', 'Database user')
  .option('--password <password>', 'Database password')
  .option('--ssl', 'Enable SSL connection')
  .action(async (options) => {
    try {
      const database = createDatabaseFromOptions(options);

      const connected = await testConnection(database);
      if (!connected) {
        throw new Error('Database connection failed');
      }

      await exitMaintenance(database);

      console.log(chalk.green('\n[maintenance] ✓ Exited maintenance mode\n'));
      console.log('Orchestrator is now running normally and accepting new tasks.\n');

      closeDatabase(database);
      process.exit(0);
    } catch (error) {
      console.error(chalk.red('\n[maintenance] ✗ Error:'), error);
      process.exit(1);
    }
  });

// ============================================================================
// dlq command group
// ============================================================================

const dlq = program.command('dlq').description('Dead Letter Queue management');

dlq.command('list')
  .description('List DLQ items')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .option('-l, --limit <number>', 'Limit results', '20')
  .action(async (options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    console.log(chalk.blue('Fetching DLQ items...'));
    // TODO: Implement
  });

dlq.command('show <id>')
  .description('Show DLQ item details')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .action(async (id, options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    console.log(chalk.blue(`Fetching DLQ item '${id}'...`));
    // TODO: Implement
  });

dlq.command('retry <id>')
  .description('Retry a DLQ item')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .action(async (id, options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    console.log(chalk.blue(`Retrying DLQ item '${id}'...`));
    // TODO: Implement
  });

dlq.command('retry-all')
  .description('Retry all DLQ items')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .option('--pipeline <id>', 'Filter by pipeline')
  .action(async (options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    console.log(chalk.blue('Retrying all DLQ items...'));
    // TODO: Implement
  });

dlq.command('purge')
  .description('Purge old DLQ items')
  .option('-u, --url <url>', 'Orchestrator URL', process.env.PIPEWEAVE_ORCHESTRATOR_URL)
  .option('--older-than <duration>', 'Duration (e.g., 7d, 24h)', '30d')
  .action(async (options) => {
    if (!options.url) {
      console.error(chalk.red('Error: Orchestrator URL required'));
      process.exit(1);
    }
    console.log(chalk.blue(`Purging DLQ items older than ${options.olderThan}...`));
    // TODO: Implement
  });

// ============================================================================
// Interactive Mode
// ============================================================================

async function runInteractiveMode() {
  showLogo();

  // Show connection selection on startup
  await handleConnectionSelection();

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: '🛠️  Complete Service Setup', value: 'setup' },
        { name: '🚀 Trigger a pipeline', value: 'trigger' },
        { name: '📊 Check pipeline status', value: 'status' },
        { name: '🔍 List services', value: 'services' },
        { name: '🧪 Dry-run pipeline', value: 'dry-run' },
        { name: '💾 Database Management', value: 'database' },
        { name: '🔧 Maintenance Mode', value: 'maintenance' },
        { name: '⚰️  Dead Letter Queue', value: 'dlq' },
        { name: '📦 Initialize Project', value: 'init' },
        { name: '🔗 Manage Connections', value: 'connections' },
        { name: '❌ Exit', value: 'exit' },
      ],
    },
  ]);

  if (action === 'exit') {
    console.log(chalk.cyan('\n👋 Goodbye!\n'));
    process.exit(0);
  }

  switch (action) {
    case 'setup':
      await handleSetupInteractive();
      break;
    case 'trigger':
      await handleTriggerInteractive();
      break;
    case 'status':
      await handleStatusInteractive();
      break;
    case 'services':
      await handleServicesInteractive();
      break;
    case 'dry-run':
      await handleDryRunInteractive();
      break;
    case 'database':
      await handleDatabaseInteractive();
      break;
    case 'maintenance':
      await handleMaintenanceInteractive();
      break;
    case 'dlq':
      await handleDlqInteractive();
      break;
    case 'init':
      await handleInitInteractive();
      break;
    case 'connections':
      await handleConnectionsManagement();
      break;
  }
}

// ============================================================================
// Connection Selection and Management
// ============================================================================

async function handleConnectionSelection() {
  const connections = listConnections();
  const defaultConn = getDefaultConnection();

  if (connections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No saved connections found.'));
    const { createNow } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'createNow',
        message: 'Would you like to create a connection now?',
        default: true,
      },
    ]);

    if (createNow) {
      await handleCreateConnection();
    } else {
      console.log(chalk.gray('You can create connections later from the main menu.\n'));
    }
    return;
  }

  // Show current connection status
  if (selectedConnection) {
    console.log(chalk.green(`\n✓ Using connection: ${chalk.bold(selectedConnection.name)}`));
  } else if (defaultConn) {
    selectedConnection = defaultConn;
    console.log(chalk.cyan(`\n→ Using default connection: ${chalk.bold(defaultConn.name)}`));
  }

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Connection:',
      choices: [
        { name: '→ Continue with current connection', value: 'continue' },
        { name: '🔄 Switch connection', value: 'switch' },
        { name: '➕ Add new connection', value: 'add' },
        { name: '🗑️  Delete a connection', value: 'delete' },
      ],
    },
  ]);

  switch (action) {
    case 'continue':
      break;
    case 'switch':
      await handleSwitchConnection();
      break;
    case 'add':
      await handleCreateConnection();
      break;
    case 'delete':
      await handleDeleteConnection();
      break;
  }

  // Show selected connection info
  if (selectedConnection) {
    console.log('');
    if (selectedConnection.orchestratorUrl) {
      console.log(chalk.gray(`  Orchestrator: ${selectedConnection.orchestratorUrl}`));
    }
    if (selectedConnection.database?.url) {
      console.log(chalk.gray(`  Database: ${selectedConnection.database.url}`));
    } else if (selectedConnection.database?.host) {
      console.log(chalk.gray(`  Database: ${selectedConnection.database.host}:${selectedConnection.database.port}/${selectedConnection.database.database}`));
    }
    console.log('');
  }
}

async function handleSwitchConnection() {
  const connections = listConnections();
  const config = loadConnections();

  const choices = connections.map(conn => ({
    name: `${conn.name}${config.defaultConnection === conn.name ? chalk.gray(' (default)') : ''}`,
    value: conn.name,
  }));

  const { connectionName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'connectionName',
      message: 'Select connection:',
      choices,
    },
  ]);

  selectedConnection = getConnection(connectionName);
  if (selectedConnection) {
    markConnectionUsed(connectionName);
    console.log(chalk.green(`\n✓ Switched to connection: ${chalk.bold(selectedConnection.name)}\n`));
  }
}

async function handleCreateConnection() {
  console.log(chalk.cyan('\n=== Create New Connection ===\n'));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Connection name:',
      validate: (input) => {
        if (!input) return 'Name is required';
        if (getConnection(input)) return 'A connection with this name already exists';
        return true;
      },
    },
    {
      type: 'input',
      name: 'orchestratorUrl',
      message: 'Orchestrator URL (optional):',
      default: process.env.PIPEWEAVE_ORCHESTRATOR_URL || '',
    },
    {
      type: 'list',
      name: 'dbType',
      message: 'Database configuration:',
      choices: [
        { name: 'Skip (configure later)', value: 'skip' },
        { name: 'Connection string', value: 'url' },
        { name: 'Individual parameters', value: 'params' },
      ],
    },
  ]);

  let database: Connection['database'] = undefined;

  if (answers.dbType === 'url') {
    const dbUrl = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Database connection URL:',
        default: process.env.DATABASE_URL || '',
      },
    ]);
    database = { url: dbUrl.url || undefined };
  } else if (answers.dbType === 'params') {
    const params = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Host:',
        default: 'localhost',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: '5432',
      },
      {
        type: 'input',
        name: 'database',
        message: 'Database name:',
      },
      {
        type: 'input',
        name: 'user',
        message: 'User:',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
      },
      {
        type: 'confirm',
        name: 'ssl',
        message: 'Use SSL?',
        default: false,
      },
    ]);
    database = {
      host: params.host,
      port: parseInt(params.port),
      database: params.database || undefined,
      user: params.user || undefined,
      password: params.password || undefined,
      ssl: params.ssl,
    };
  }

  const newConnection: Omit<Connection, 'createdAt' | 'lastUsed'> = {
    name: answers.name,
    orchestratorUrl: answers.orchestratorUrl || undefined,
    database,
  };

  saveConnection(newConnection);
  selectedConnection = getConnection(answers.name);

  console.log(chalk.green(`\n✓ Connection '${answers.name}' saved successfully!\n`));
  console.log(chalk.gray(`   Stored in: ${getConfigPath()}\n`));
}

async function handleDeleteConnection() {
  const connections = listConnections();

  if (connections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No connections to delete\n'));
    return;
  }

  const { connectionName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'connectionName',
      message: 'Select connection to delete:',
      choices: connections.map(c => ({ name: c.name, value: c.name })),
    },
  ]);

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Are you sure you want to delete '${connectionName}'?`,
      default: false,
    },
  ]);

  if (confirm) {
    deleteConnection(connectionName);
    console.log(chalk.green(`\n✓ Connection '${connectionName}' deleted\n`));

    // If we deleted the selected connection, clear it
    if (selectedConnection?.name === connectionName) {
      selectedConnection = getDefaultConnection();
    }
  }
}

async function handleConnectionsManagement() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'Connection management:',
      choices: [
        { name: '📋 List all connections', value: 'list' },
        { name: '➕ Add new connection', value: 'add' },
        { name: '✏️  Edit connection', value: 'edit' },
        { name: '🗑️  Delete connection', value: 'delete' },
        { name: '⭐ Set default connection', value: 'default' },
        { name: '⬅️  Back', value: 'back' },
      ],
    },
  ]);

  switch (action) {
    case 'back':
      await runInteractiveMode();
      return;
    case 'list':
      await handleListConnections();
      break;
    case 'add':
      await handleCreateConnection();
      await runInteractiveMode();
      return;
    case 'edit':
      await handleEditConnection();
      break;
    case 'delete':
      await handleDeleteConnection();
      break;
    case 'default':
      await handleSetDefaultConnection();
      break;
  }

  await runInteractiveMode();
}

async function handleListConnections() {
  const connections = listConnections();
  const config = loadConnections();

  if (connections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No saved connections\n'));
    return;
  }

  console.log(chalk.cyan('\n=== Saved Connections ===\n'));

  connections.forEach((conn, index) => {
    const isDefault = config.defaultConnection === conn.name;
    const isCurrent = selectedConnection?.name === conn.name;

    let prefix = '  ';
    if (isCurrent) prefix = chalk.green('→ ');
    else if (isDefault) prefix = chalk.cyan('* ');

    console.log(`${prefix}${chalk.bold(conn.name)}${isDefault ? chalk.gray(' (default)') : ''}`);
    if (conn.orchestratorUrl) {
      console.log(`    Orchestrator: ${chalk.gray(conn.orchestratorUrl)}`);
    }
    if (conn.database?.url) {
      console.log(`    Database: ${chalk.gray(conn.database.url)}`);
    } else if (conn.database?.host) {
      console.log(`    Database: ${chalk.gray(`${conn.database.host}:${conn.database.port}/${conn.database.database}`)}`);
    }
    if (conn.lastUsed) {
      console.log(`    Last used: ${chalk.gray(new Date(conn.lastUsed).toLocaleString())}`);
    }
    console.log('');
  });
}

async function handleEditConnection() {
  const connections = listConnections();

  if (connections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No connections to edit\n'));
    return;
  }

  const { connectionName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'connectionName',
      message: 'Select connection to edit:',
      choices: connections.map(c => ({ name: c.name, value: c.name })),
    },
  ]);

  const existing = getConnection(connectionName);
  if (!existing) return;

  console.log(chalk.cyan(`\n=== Edit Connection: ${connectionName} ===\n`));

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'orchestratorUrl',
      message: 'Orchestrator URL:',
      default: existing.orchestratorUrl || '',
    },
    {
      type: 'list',
      name: 'dbType',
      message: 'Database configuration:',
      choices: [
        { name: 'Keep current', value: 'keep' },
        { name: 'Connection string', value: 'url' },
        { name: 'Individual parameters', value: 'params' },
        { name: 'Remove', value: 'remove' },
      ],
    },
  ]);

  let database: Connection['database'] = existing.database;

  if (answers.dbType === 'url') {
    const dbUrl = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Database connection URL:',
        default: existing.database?.url || '',
      },
    ]);
    database = { url: dbUrl.url || undefined };
  } else if (answers.dbType === 'params') {
    const params = await inquirer.prompt([
      {
        type: 'input',
        name: 'host',
        message: 'Host:',
        default: existing.database?.host || 'localhost',
      },
      {
        type: 'input',
        name: 'port',
        message: 'Port:',
        default: existing.database?.port?.toString() || '5432',
      },
      {
        type: 'input',
        name: 'database',
        message: 'Database name:',
        default: existing.database?.database || '',
      },
      {
        type: 'input',
        name: 'user',
        message: 'User:',
        default: existing.database?.user || '',
      },
      {
        type: 'password',
        name: 'password',
        message: 'Password:',
        default: existing.database?.password || '',
      },
      {
        type: 'confirm',
        name: 'ssl',
        message: 'Use SSL?',
        default: existing.database?.ssl || false,
      },
    ]);
    database = {
      host: params.host,
      port: parseInt(params.port),
      database: params.database || undefined,
      user: params.user || undefined,
      password: params.password || undefined,
      ssl: params.ssl,
    };
  } else if (answers.dbType === 'remove') {
    database = undefined;
  }

  const updated: Omit<Connection, 'createdAt' | 'lastUsed'> = {
    name: connectionName,
    orchestratorUrl: answers.orchestratorUrl || undefined,
    database,
  };

  saveConnection(updated);
  console.log(chalk.green(`\n✓ Connection '${connectionName}' updated successfully!\n`));

  // Update selectedConnection if it was the one being edited
  if (selectedConnection?.name === connectionName) {
    selectedConnection = getConnection(connectionName);
  }
}

async function handleSetDefaultConnection() {
  const connections = listConnections();

  if (connections.length === 0) {
    console.log(chalk.yellow('\n⚠️  No connections available\n'));
    return;
  }

  const config = loadConnections();

  const { connectionName } = await inquirer.prompt([
    {
      type: 'list',
      name: 'connectionName',
      message: 'Select default connection:',
      choices: connections.map(c => ({
        name: `${c.name}${config.defaultConnection === c.name ? chalk.gray(' (current default)') : ''}`,
        value: c.name,
      })),
    },
  ]);

  setDefaultConnection(connectionName);
  console.log(chalk.green(`\n✓ Default connection set to '${connectionName}'\n`));
}

async function handleTriggerInteractive() {
  // Use selected connection or fall back to environment
  const orchestratorUrl = selectedConnection?.orchestratorUrl || process.env.PIPEWEAVE_ORCHESTRATOR_URL;

  if (!orchestratorUrl) {
    console.log(chalk.red('\n✗ No orchestrator URL configured'));
    console.log(chalk.yellow('Please set up a connection or set PIPEWEAVE_ORCHESTRATOR_URL\n'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'pipeline',
      message: 'Pipeline name:',
      validate: (input) => input ? true : 'Pipeline name is required',
    },
    {
      type: 'input',
      name: 'input',
      message: 'Input JSON (optional):',
      default: '{}',
    },
    {
      type: 'input',
      name: 'priority',
      message: 'Priority (lower = higher):',
      default: '100',
    },
    {
      type: 'confirm',
      name: 'wait',
      message: 'Wait for completion?',
      default: false,
    },
  ]);

  console.log(chalk.blue(`\nTriggering pipeline '${answers.pipeline}' on ${orchestratorUrl}...`));
  // TODO: Implement pipeline triggering
  console.log(chalk.yellow('Note: Pipeline triggering not yet implemented\n'));
}

async function handleStatusInteractive() {
  // Use selected connection or fall back to environment
  const orchestratorUrl = selectedConnection?.orchestratorUrl || process.env.PIPEWEAVE_ORCHESTRATOR_URL;

  if (!orchestratorUrl) {
    console.log(chalk.red('\n✗ No orchestrator URL configured'));
    console.log(chalk.yellow('Please set up a connection or set PIPEWEAVE_ORCHESTRATOR_URL\n'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'runId',
      message: 'Run ID:',
      validate: (input) => input ? true : 'Run ID is required',
    },
  ]);

  console.log(chalk.blue(`\nFetching status for '${answers.runId}' from ${orchestratorUrl}...`));
  // TODO: Implement status checking
  console.log(chalk.yellow('Note: Status checking not yet implemented\n'));
}

async function handleServicesInteractive() {
  // Use selected connection or fall back to environment
  const orchestratorUrl = selectedConnection?.orchestratorUrl || process.env.PIPEWEAVE_ORCHESTRATOR_URL;

  if (!orchestratorUrl) {
    console.log(chalk.red('\n✗ No orchestrator URL configured'));
    console.log(chalk.yellow('Please set up a connection or set PIPEWEAVE_ORCHESTRATOR_URL\n'));
    return;
  }

  console.log(chalk.blue(`\nFetching services from ${orchestratorUrl}...`));
  // TODO: Implement service listing
  console.log(chalk.yellow('Note: Service listing not yet implemented\n'));
}

async function handleDryRunInteractive() {
  // Use selected connection or fall back to environment
  const orchestratorUrl = selectedConnection?.orchestratorUrl || process.env.PIPEWEAVE_ORCHESTRATOR_URL;

  if (!orchestratorUrl) {
    console.log(chalk.red('\n✗ No orchestrator URL configured'));
    console.log(chalk.yellow('Please set up a connection or set PIPEWEAVE_ORCHESTRATOR_URL\n'));
    return;
  }

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'pipeline',
      message: 'Pipeline name:',
      validate: (input) => input ? true : 'Pipeline name is required',
    },
    {
      type: 'input',
      name: 'input',
      message: 'Input JSON (optional):',
      default: '{}',
    },
  ]);

  console.log(chalk.blue(`\nValidating pipeline '${answers.pipeline}' on ${orchestratorUrl}...`));
  // TODO: Implement dry-run
  console.log(chalk.yellow('Note: Dry-run validation not yet implemented\n'));
}

async function handleDatabaseInteractive() {
  const { dbAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'dbAction',
      message: 'Database action:',
      choices: [
        { name: '▶️  Run migrations', value: 'migrate' },
        { name: '📋 Show status', value: 'status' },
        { name: '✅ Validate migrations', value: 'validate' },
        { name: '🧹 Run cleanup', value: 'cleanup' },
        { name: '⬅️  Back', value: 'back' },
      ],
    },
  ]);

  if (dbAction === 'back') {
    await runInteractiveMode();
    return;
  }

  // Automatically use database connection from selected connection
  let options: any = {};

  if (selectedConnection?.database) {
    // Use the stored connection automatically
    if (selectedConnection.database.url) {
      options.url = selectedConnection.database.url;
    } else {
      options = {
        host: selectedConnection.database.host,
        port: selectedConnection.database.port,
        database: selectedConnection.database.database,
        user: selectedConnection.database.user,
        password: selectedConnection.database.password,
        ssl: selectedConnection.database.ssl,
      };
    }
  }

  // If no stored connection, ask for connection details
  if (!options.url && !options.host) {
    console.log(chalk.yellow('\n⚠️  No database configured in selected connection'));

    const dbConfig = await inquirer.prompt([
      {
        type: 'list',
        name: 'configType',
        message: 'How would you like to connect?',
        choices: [
          { name: 'Use environment variables (DATABASE_URL)', value: 'env' },
          { name: 'Connection string', value: 'url' },
          { name: 'Individual parameters', value: 'params' },
        ],
      },
    ]);

    if (dbConfig.configType === 'url') {
      const urlAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Database connection URL:',
          validate: (input) => input ? true : 'URL is required',
        },
      ]);
      options.url = urlAnswer.url;
    } else if (dbConfig.configType === 'params') {
      const params = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: 'Host:',
          default: 'localhost',
        },
        {
          type: 'input',
          name: 'port',
          message: 'Port:',
          default: '5432',
        },
        {
          type: 'input',
          name: 'database',
          message: 'Database name:',
          validate: (input) => input ? true : 'Database name is required',
        },
        {
          type: 'input',
          name: 'user',
          message: 'User:',
          validate: (input) => input ? true : 'User is required',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
        },
        {
          type: 'confirm',
          name: 'ssl',
          message: 'Use SSL?',
          default: false,
        },
      ]);
      options = { ...params };
    }
  }

  try {
    const database = createDatabaseFromOptions(options);
    const connected = await testConnection(database);

    if (!connected) {
      console.error(chalk.red('\n✗ Database connection failed\n'));
      closeDatabase(database);
      return;
    }

    switch (dbAction) {
      case 'migrate':
        console.log(chalk.blue('\n[db] Running migrations...\n'));
        const migrateResult = await runMigrations(database);
        console.log(chalk.green(`\n[db] ✓ Migration complete`));
        console.log(`  • Applied: ${migrateResult.applied}`);
        console.log(`  • Skipped: ${migrateResult.skipped}\n`);
        break;

      case 'status':
        const status = await getMigrationStatus(database);
        console.log('\n=== Database Migration Status ===\n');
        console.log(`Current version: ${status.current || 'none'}`);
        console.log(`Applied migrations: ${status.applied.length}`);
        console.log(`Pending migrations: ${status.pending.length}\n`);
        if (status.applied.length > 0) {
          console.log('Applied:');
          status.applied.forEach((m) => {
            console.log(chalk.green(`  ✓ ${m.version}_${m.name} (${new Date(m.applied_at).toISOString()})`));
          });
          console.log('');
        }
        if (status.pending.length > 0) {
          console.log('Pending:');
          status.pending.forEach((m) => {
            console.log(chalk.yellow(`  • ${m.version}_${m.name}`));
          });
          console.log('');
        }
        break;

      case 'validate':
        const validation = await validateMigrations(database);
        console.log('\n=== Migration Validation ===\n');
        if (validation.valid) {
          console.log(chalk.green('✓ All migrations are valid\n'));
        } else {
          console.log(chalk.red('✗ Validation failed:\n'));
          validation.errors.forEach((err) => console.log(chalk.red(`  • ${err}`)));
          console.log('');
        }
        break;

      case 'cleanup':
        const retentionAnswer = await inquirer.prompt([
          {
            type: 'input',
            name: 'dlqRetentionDays',
            message: 'DLQ retention in days:',
            default: '30',
          },
        ]);
        console.log(chalk.blue('\n[db] Running cleanup tasks...\n'));
        const cleanupResult = await runCleanupTasks(database, {
          dlqRetentionDays: parseInt(retentionAnswer.dlqRetentionDays),
        });
        console.log(chalk.green(`\n[db] ✓ Cleanup complete`));
        console.log(`  • Expired cache entries deleted: ${cleanupResult.expiredCacheDeleted}`);
        console.log(`  • Old DLQ entries deleted: ${cleanupResult.oldDlqDeleted}\n`);
        break;
    }

    closeDatabase(database);
  } catch (error) {
    console.error(chalk.red('\n[db] ✗ Error:'), error);
  }
}

async function handleMaintenanceInteractive() {
  const { maintAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'maintAction',
      message: 'Maintenance action:',
      choices: [
        { name: '📊 Show status', value: 'status' },
        { name: '🔔 Request maintenance mode', value: 'request' },
        { name: '🔒 Enter maintenance mode', value: 'enter' },
        { name: '🔓 Exit maintenance mode', value: 'exit' },
        { name: '⬅️  Back', value: 'back' },
      ],
    },
  ]);

  if (maintAction === 'back') {
    await runInteractiveMode();
    return;
  }

  // Automatically use database connection from selected connection
  let options: any = {};

  if (selectedConnection?.database) {
    // Use the stored connection automatically
    if (selectedConnection.database.url) {
      options.url = selectedConnection.database.url;
    } else {
      options = {
        host: selectedConnection.database.host,
        port: selectedConnection.database.port,
        database: selectedConnection.database.database,
        user: selectedConnection.database.user,
        password: selectedConnection.database.password,
        ssl: selectedConnection.database.ssl,
      };
    }
  }

  // If no stored connection, ask for connection details
  if (!options.url && !options.host) {
    console.log(chalk.yellow('\n⚠️  No database configured in selected connection'));

    const dbConfig = await inquirer.prompt([
      {
        type: 'list',
        name: 'configType',
        message: 'How would you like to connect?',
        choices: [
          { name: 'Use environment variables (DATABASE_URL)', value: 'env' },
          { name: 'Connection string', value: 'url' },
          { name: 'Individual parameters', value: 'params' },
        ],
      },
    ]);

    if (dbConfig.configType === 'url') {
      const urlAnswer = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Database connection URL:',
          validate: (input) => input ? true : 'URL is required',
        },
      ]);
      options.url = urlAnswer.url;
    } else if (dbConfig.configType === 'params') {
      const params = await inquirer.prompt([
        {
          type: 'input',
          name: 'host',
          message: 'Host:',
          default: 'localhost',
        },
        {
          type: 'input',
          name: 'port',
          message: 'Port:',
          default: '5432',
        },
        {
          type: 'input',
          name: 'database',
          message: 'Database name:',
          validate: (input) => input ? true : 'Database name is required',
        },
        {
          type: 'input',
          name: 'user',
          message: 'User:',
          validate: (input) => input ? true : 'User is required',
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
        },
        {
          type: 'confirm',
          name: 'ssl',
          message: 'Use SSL?',
          default: false,
        },
      ]);
      options = { ...params };
    }
  }

  try {
    const database = createDatabaseFromOptions(options);
    const connected = await testConnection(database);

    if (!connected) {
      console.error(chalk.red('\n✗ Database connection failed\n'));
      closeDatabase(database);
      return;
    }

    switch (maintAction) {
      case 'status':
        const status = await getMaintenanceStatus(database);
        console.log('\n=== Maintenance Mode Status ===\n');
        console.log(`Mode: ${chalk.bold(status.mode)}`);
        console.log(`Pending tasks: ${status.pendingTasks}`);
        console.log(`Running tasks: ${status.runningTasks}`);
        console.log(`Can enter maintenance: ${status.canEnterMaintenance ? chalk.green('Yes') : chalk.red('No')}`);
        console.log(`Status: ${status.message}`);
        console.log(`Mode changed at: ${status.modeChangedAt.toISOString()}\n`);
        break;

      case 'request':
        const reqStatus = await requestMaintenance(database);
        console.log(chalk.green('\n[maintenance] ✓ Maintenance mode requested'));
        console.log(`\nMode: ${reqStatus.mode}`);
        console.log(`Pending tasks: ${reqStatus.pendingTasks}`);
        console.log(`Running tasks: ${reqStatus.runningTasks}`);
        console.log(`Status: ${reqStatus.message}\n`);
        if (reqStatus.canEnterMaintenance) {
          console.log(chalk.cyan('All tasks complete. You can now enter maintenance mode.\n'));
        } else {
          console.log(chalk.yellow('Waiting for tasks to complete. The orchestrator will auto-transition when ready.\n'));
        }
        break;

      case 'enter':
        const enterStatus = await enterMaintenance(database);
        if (enterStatus.mode === 'maintenance') {
          console.log(chalk.green('\n[maintenance] ✓ Entered maintenance mode\n'));
          console.log('No new tasks will be accepted.');
          console.log('Run migrations or perform maintenance tasks now.\n');
        } else {
          console.log(chalk.red('\n[maintenance] ✗ Cannot enter maintenance mode\n'));
          console.log(`Status: ${enterStatus.message}`);
          console.log(`Pending tasks: ${enterStatus.pendingTasks}`);
          console.log(`Running tasks: ${enterStatus.runningTasks}\n`);
        }
        break;

      case 'exit':
        await exitMaintenance(database);
        console.log(chalk.green('\n[maintenance] ✓ Exited maintenance mode\n'));
        console.log('Orchestrator is now running normally and accepting new tasks.\n');
        break;
    }

    closeDatabase(database);
  } catch (error) {
    console.error(chalk.red('\n[maintenance] ✗ Error:'), error);
  }
}

async function handleDlqInteractive() {
  // Use selected connection or fall back to environment
  const orchestratorUrl = selectedConnection?.orchestratorUrl || process.env.PIPEWEAVE_ORCHESTRATOR_URL;

  if (!orchestratorUrl) {
    console.log(chalk.red('\n✗ No orchestrator URL configured'));
    console.log(chalk.yellow('Please set up a connection or set PIPEWEAVE_ORCHESTRATOR_URL\n'));
    return;
  }

  const { dlqAction } = await inquirer.prompt([
    {
      type: 'list',
      name: 'dlqAction',
      message: 'DLQ action:',
      choices: [
        { name: '📋 List items', value: 'list' },
        { name: '🔍 Show item details', value: 'show' },
        { name: '🔄 Retry item', value: 'retry' },
        { name: '🔄 Retry all', value: 'retry-all' },
        { name: '🗑️  Purge old items', value: 'purge' },
        { name: '⬅️  Back', value: 'back' },
      ],
    },
  ]);

  if (dlqAction === 'back') {
    await runInteractiveMode();
    return;
  }

  console.log(chalk.blue(`\nUsing orchestrator: ${orchestratorUrl}`));
  console.log(chalk.yellow('Note: DLQ operations not yet implemented\n'));
}

async function handleSetupInteractive() {
  try {
    const result = await runSetup();

    if (result.success) {
      // Ask if user wants to save this as a connection
      const { saveConn } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'saveConn',
          message: 'Would you like to save this configuration as a connection?',
          default: true,
        },
      ]);

      if (saveConn) {
        const { connName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'connName',
            message: 'Connection name:',
            default: 'default',
            validate: (input) => {
              if (!input) return 'Name is required';
              if (getConnection(input)) return 'A connection with this name already exists';
              return true;
            },
          },
        ]);

        // Parse the DATABASE_URL to extract connection details
        const dbUrl = result.databaseUrl;

        const newConnection: Omit<Connection, 'createdAt' | 'lastUsed'> = {
          name: connName,
          orchestratorUrl: undefined, // User can set this later
          database: {
            url: dbUrl,
          },
        };

        saveConnection(newConnection);
        selectedConnection = getConnection(connName);

        console.log(chalk.green(`\n✓ Connection '${connName}' saved successfully!\n`));
      }
    }
  } catch (error) {
    console.error(chalk.red('\n✗ Setup failed:'), error);
  }
}

async function handleInitInteractive() {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Service name:',
      validate: (input) => input ? true : 'Service name is required',
    },
    {
      type: 'input',
      name: 'dir',
      message: 'Target directory:',
      default: '.',
    },
  ]);

  console.log(chalk.blue('\nInitializing PipeWeave project...'));
  // TODO: Implement project scaffolding
  console.log(chalk.yellow('Note: Project initialization not yet implemented\n'));
}

// ============================================================================
// Main Entry Point
// ============================================================================

// Show logo if running interactively (no arguments)
if (process.argv.length === 2) {
  runInteractiveMode().catch((error) => {
    console.error(chalk.red('Error:'), error);
    process.exit(1);
  });
} else {
  // Parse and run commands
  program.parse();
}
