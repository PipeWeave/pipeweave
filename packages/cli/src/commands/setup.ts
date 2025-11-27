import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { randomBytes, createHash } from 'crypto';
import { createDatabase, testConnection } from '../db/index.js';
import { runMigrations, ensureSchemaUpToDate } from '../db/migration-runner.js';
import type { Database } from '../db/index.js';

// ============================================================================
// Types
// ============================================================================

interface SetupConfig {
  // Database connection (for root/admin user)
  adminHost: string;
  adminPort: number;
  adminUser: string;
  adminPassword: string;
  adminDatabase: string; // Usually 'postgres' for admin connection

  // New database and user
  databaseName: string;
  databaseUser: string;
  databasePassword: string;

  // PipeWeave secret
  pipeweaveSecret: string;
}

interface SetupResult {
  databaseUrl: string;
  pipeweaveSecret: string;
  success: boolean;
}

// ============================================================================
// Password & Secret Generation
// ============================================================================

/**
 * Generate a strong random password
 */
export function generatePassword(length: number = 32): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*-_+=';
  const bytes = randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i++) {
    password += charset[bytes[i]! % charset.length];
  }

  return password;
}

/**
 * Generate a PipeWeave secret key (64 character hex)
 */
export function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Copy text to clipboard (cross-platform)
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Try using pbcopy (macOS)
    const { spawn } = await import('child_process');
    const proc = spawn('pbcopy');
    proc.stdin.write(text);
    proc.stdin.end();

    return await new Promise((resolve) => {
      proc.on('exit', (code) => resolve(code === 0));
    });
  } catch (error) {
    // Clipboard copy failed, user will need to copy manually
    return false;
  }
}

// ============================================================================
// Database Setup Functions
// ============================================================================

/**
 * Check if database exists
 */
async function databaseExists(adminDb: Database, databaseName: string): Promise<boolean> {
  try {
    const result = await adminDb.oneOrNone(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [databaseName]
    );
    return result !== null;
  } catch (error) {
    console.error('[setup] Error checking database existence:', error);
    return false;
  }
}

/**
 * Check if user exists
 */
async function userExists(adminDb: Database, username: string): Promise<boolean> {
  try {
    const result = await adminDb.oneOrNone(
      `SELECT 1 FROM pg_roles WHERE rolname = $1`,
      [username]
    );
    return result !== null;
  } catch (error) {
    console.error('[setup] Error checking user existence:', error);
    return false;
  }
}

/**
 * Create database
 */
async function createDatabaseIfNotExists(
  adminDb: Database,
  databaseName: string
): Promise<void> {
  const exists = await databaseExists(adminDb, databaseName);

  if (exists) {
    console.log(chalk.yellow(`Database '${databaseName}' already exists, skipping creation`));
    return;
  }

  console.log(chalk.blue(`Creating database '${databaseName}'...`));

  // Note: Database name cannot be parameterized, but we validate it first
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(databaseName)) {
    throw new Error('Invalid database name. Use only letters, numbers, and underscores.');
  }

  try {
    // Use quoted identifier for database name
    await adminDb.none(`CREATE DATABASE "${databaseName}"`);
    console.log(chalk.green(`✓ Database '${databaseName}' created`));
  } catch (error: any) {
    console.error(chalk.red(`Failed to create database: ${error.message}`));
    throw error;
  }
}

/**
 * Create user
 */
async function createUserIfNotExists(
  adminDb: Database,
  username: string,
  password: string
): Promise<void> {
  const exists = await userExists(adminDb, username);

  if (exists) {
    console.log(chalk.yellow(`User '${username}' already exists, updating password...`));
    // Update password for existing user
    // Use quoted identifier for username
    await adminDb.none(
      `ALTER USER "${username}" WITH PASSWORD $1`,
      [password]
    );
    console.log(chalk.green(`✓ User '${username}' password updated`));
    return;
  }

  console.log(chalk.blue(`Creating user '${username}'...`));

  // Validate username
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(username)) {
    throw new Error('Invalid username. Use only letters, numbers, and underscores.');
  }

  try {
    // Use quoted identifier for username
    await adminDb.none(
      `CREATE USER "${username}" WITH PASSWORD $1`,
      [password]
    );
    console.log(chalk.green(`✓ User '${username}' created`));
  } catch (error: any) {
    console.error(chalk.red(`Failed to create user: ${error.message}`));
    throw error;
  }
}

/**
 * Grant permissions to user on database
 */
async function grantPermissions(
  adminDb: Database,
  databaseName: string,
  username: string
): Promise<void> {
  console.log(chalk.blue(`Granting permissions to '${username}' on '${databaseName}'...`));

  try {
    // Grant database-level permissions
    // Use quoted identifiers to handle usernames properly
    await adminDb.none(`GRANT ALL PRIVILEGES ON DATABASE "${databaseName}" TO "${username}"`);

    console.log(chalk.green(`✓ Permissions granted to '${username}'`));
  } catch (error: any) {
    console.error(chalk.red(`Failed to grant database permissions: ${error.message}`));
    throw error;
  }
}

/**
 * Grant schema permissions (must be run after connecting to the target database)
 */
async function grantSchemaPermissions(
  db: Database,
  username: string
): Promise<void> {
  console.log(chalk.blue(`Granting schema permissions to '${username}'...`));

  try {
    // Grant schema usage
    await db.none(`GRANT ALL ON SCHEMA public TO "${username}"`);

    // Grant permissions on all existing tables
    await db.none(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "${username}"`);

    // Grant permissions on all existing sequences
    await db.none(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "${username}"`);

    // Grant default privileges for future objects
    await db.none(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "${username}"`);
    await db.none(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "${username}"`);

    console.log(chalk.green(`✓ Schema permissions granted to '${username}'`));
  } catch (error: any) {
    console.error(chalk.red(`Failed to grant schema permissions: ${error.message}`));
    throw error;
  }
}

// ============================================================================
// Interactive Setup
// ============================================================================

/**
 * Prompt user for setup configuration
 */
async function promptSetupConfig(): Promise<SetupConfig> {
  console.log(chalk.bold.cyan('\n🚀 PipeWeave Service Setup\n'));
  console.log(chalk.gray('This wizard will help you set up your PipeWeave database and configuration.\n'));

  // Step 1: Database connection info
  console.log(chalk.bold('Step 1: Database Connection'));
  console.log(chalk.gray('Enter the connection details for your PostgreSQL admin user.\n'));

  const connectionAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'adminHost',
      message: 'PostgreSQL host:',
      default: 'localhost',
    },
    {
      type: 'input',
      name: 'adminPort',
      message: 'PostgreSQL port:',
      default: '5432',
      validate: (input) => {
        const port = parseInt(input);
        return !isNaN(port) && port > 0 && port < 65536 || 'Invalid port number';
      },
    },
    {
      type: 'input',
      name: 'adminUser',
      message: 'PostgreSQL admin user:',
      default: 'postgres',
    },
    {
      type: 'password',
      name: 'adminPassword',
      message: 'PostgreSQL admin password:',
      mask: '*',
    },
  ]);

  // Step 2: New database and user
  console.log(chalk.bold('\nStep 2: New Database & User'));
  console.log(chalk.gray('Configure the PipeWeave database and user.\n'));

  const dbAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'databaseName',
      message: 'Database name:',
      default: 'pipeweave',
      validate: (input) => {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input) ||
          'Invalid database name. Use only letters, numbers, and underscores.';
      },
    },
    {
      type: 'input',
      name: 'databaseUser',
      message: 'Database user:',
      default: 'pipeweave',
      validate: (input) => {
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(input) ||
          'Invalid username. Use only letters, numbers, and underscores.';
      },
    },
    {
      type: 'confirm',
      name: 'generatePassword',
      message: 'Generate a strong password?',
      default: true,
    },
  ]);

  let databasePassword: string;

  if (dbAnswers.generatePassword) {
    databasePassword = generatePassword();
    console.log(chalk.green('\n✓ Strong password generated!'));
    console.log(chalk.bold('Password: ') + chalk.cyan(databasePassword));

    const copied = await copyToClipboard(databasePassword);
    if (copied) {
      console.log(chalk.green('✓ Password copied to clipboard'));
    } else {
      console.log(chalk.yellow('⚠ Could not copy to clipboard. Please save the password manually.'));
    }

    const { confirmPassword } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmPassword',
        message: 'Have you saved the password?',
        default: false,
      },
    ]);

    if (!confirmPassword) {
      console.log(chalk.red('\nPlease save the password before continuing.'));
      console.log(chalk.bold('Password: ') + chalk.cyan(databasePassword));

      await inquirer.prompt([
        {
          type: 'confirm',
          name: 'ready',
          message: 'Ready to continue?',
          default: true,
        },
      ]);
    }
  } else {
    const { manualPassword } = await inquirer.prompt([
      {
        type: 'password',
        name: 'manualPassword',
        message: 'Enter password for database user:',
        mask: '*',
        validate: (input) => input.length >= 8 || 'Password must be at least 8 characters',
      },
    ]);
    databasePassword = manualPassword;
  }

  // Step 3: PipeWeave secret
  console.log(chalk.bold('\nStep 3: PipeWeave Secret Key'));
  console.log(chalk.gray('This secret is used to authenticate services with the orchestrator.\n'));

  const pipeweaveSecret = generateSecret();
  console.log(chalk.green('✓ Secret key generated!'));
  console.log(chalk.bold('Secret: ') + chalk.cyan(pipeweaveSecret));

  const secretCopied = await copyToClipboard(pipeweaveSecret);
  if (secretCopied) {
    console.log(chalk.green('✓ Secret copied to clipboard'));
  } else {
    console.log(chalk.yellow('⚠ Could not copy to clipboard. Please save the secret manually.'));
  }

  const { confirmSecret } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmSecret',
      message: 'Have you saved the secret key?',
      default: false,
    },
  ]);

  if (!confirmSecret) {
    console.log(chalk.red('\nPlease save the secret key before continuing.'));
    console.log(chalk.bold('Secret: ') + chalk.cyan(pipeweaveSecret));

    await inquirer.prompt([
      {
        type: 'confirm',
        name: 'ready',
        message: 'Ready to continue?',
        default: true,
      },
    ]);
  }

  return {
    adminHost: connectionAnswers.adminHost,
    adminPort: parseInt(connectionAnswers.adminPort),
    adminUser: connectionAnswers.adminUser,
    adminPassword: connectionAnswers.adminPassword,
    adminDatabase: 'postgres',
    databaseName: dbAnswers.databaseName,
    databaseUser: dbAnswers.databaseUser,
    databasePassword,
    pipeweaveSecret,
  };
}

// ============================================================================
// Main Setup Function
// ============================================================================

/**
 * Run the complete setup process
 */
export async function runSetup(): Promise<SetupResult> {
  try {
    // Prompt for configuration
    const config = await promptSetupConfig();

    console.log(chalk.bold('\n📦 Setting up PipeWeave...\n'));

    // Step 1: Connect to admin database
    const spinner = ora('Connecting to PostgreSQL...').start();

    const adminDb = createDatabase({
      host: config.adminHost,
      port: config.adminPort,
      database: config.adminDatabase,
      user: config.adminUser,
      password: config.adminPassword,
    });

    const connected = await testConnection(adminDb);
    if (!connected) {
      spinner.fail('Failed to connect to PostgreSQL');
      throw new Error('Database connection failed');
    }

    spinner.succeed('Connected to PostgreSQL');

    // Step 2: Create database
    await createDatabaseIfNotExists(adminDb, config.databaseName);

    // Step 3: Create user
    await createUserIfNotExists(adminDb, config.databaseUser, config.databasePassword);

    // Step 4: Grant database permissions
    await grantPermissions(adminDb, config.databaseName, config.databaseUser);

    // Step 5: Connect to new database as admin to grant schema permissions
    const newDbAsAdmin = createDatabase({
      host: config.adminHost,
      port: config.adminPort,
      database: config.databaseName,
      user: config.adminUser,
      password: config.adminPassword,
    });

    // Step 6: Run migrations as admin first (to create schema)
    console.log(chalk.bold('\n🔧 Running database migrations...\n'));

    // First try normal migrations
    const migrationResult = await runMigrations(newDbAsAdmin);

    // If there were errors, try to ensure schema is up to date with idempotent re-run
    if (migrationResult.errors.length > 0) {
      console.log(chalk.yellow('\n⚠ Some migration errors occurred. Ensuring schema is up to date...\n'));
      await ensureSchemaUpToDate(newDbAsAdmin);
    }

    // Step 7: Grant schema permissions after tables are created
    await grantSchemaPermissions(newDbAsAdmin, config.databaseUser);

    // Step 8: Test connection with new user
    const testSpinner = ora('Testing connection with new user...').start();

    const userDb = createDatabase({
      host: config.adminHost,
      port: config.adminPort,
      database: config.databaseName,
      user: config.databaseUser,
      password: config.databasePassword,
    });

    const userConnected = await testConnection(userDb);
    if (!userConnected) {
      testSpinner.fail('Failed to connect with new user');
      throw new Error('User connection test failed');
    }

    testSpinner.succeed('Connection test successful');

    // Build connection URL
    const databaseUrl = `postgresql://${config.databaseUser}:${config.databasePassword}@${config.adminHost}:${config.adminPort}/${config.databaseName}`;

    // Display summary
    console.log(chalk.bold.green('\n✓ Setup complete!\n'));
    console.log(chalk.bold('Database Configuration:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('DATABASE_URL=') + databaseUrl);
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.bold('PipeWeave Secret:'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.cyan('PIPEWEAVE_SECRET_KEY=') + config.pipeweaveSecret);
    console.log(chalk.gray('─'.repeat(50)));
    console.log();
    console.log(chalk.bold('Next Steps:'));
    console.log('1. Add these environment variables to your .env file');
    console.log('2. Start the orchestrator: npm run dev:orchestrator');
    console.log('3. Deploy your worker services with the same PIPEWEAVE_SECRET_KEY');
    console.log();

    return {
      databaseUrl,
      pipeweaveSecret: config.pipeweaveSecret,
      success: true,
    };

  } catch (error) {
    console.error(chalk.red('\n✗ Setup failed:'), error);
    return {
      databaseUrl: '',
      pipeweaveSecret: '',
      success: false,
    };
  }
}
