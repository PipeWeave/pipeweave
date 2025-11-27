# Getting Started with PipeWeave

This guide will walk you through setting up PipeWeave from scratch.

## Prerequisites

- **Node.js >= 18** and **npm >= 9**
- **PostgreSQL 15+** (for orchestrator database)
- **Storage Backend** (Local filesystem, AWS S3, Google Cloud Storage, or MinIO)

## Installation

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/pipeweave/pipeweave.git
cd pipeweave

# Install dependencies for all packages
npm install

# Build all packages (builds in dependency order)
npm run build
```

### 2. Set Up Infrastructure

#### PostgreSQL Database

**Option A: Using Docker**
```bash
docker run -d \
  --name pipeweave-db \
  -e POSTGRES_DB=pipeweave \
  -e POSTGRES_USER=pipeweave \
  -e POSTGRES_PASSWORD=pipeweave \
  -p 5432:5432 \
  postgres:15
```

**Option B: Native Installation**
```bash
# macOS
brew install postgresql@15
brew services start postgresql@15
createdb pipeweave

# Ubuntu/Debian
sudo apt-get install postgresql-15
sudo -u postgres createdb pipeweave
```

#### Storage Backend

Choose one of the following options:

**Option 1: Local Filesystem (Simplest for development)**

No external dependencies required. Files are stored in a local directory.

```bash
# Configuration will be added to .env in the next step
STORAGE_PROVIDER=local
S3_ENDPOINT=file://
S3_BUCKET=data
LOCAL_STORAGE_BASE_PATH=./storage
```

**Option 2: MinIO (Self-hosted S3-compatible)**

```bash
# Using Docker
docker run -d \
  --name pipeweave-minio \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  -p 9000:9000 \
  -p 9001:9001 \
  minio/minio server /data --console-address ":9001"

# Create bucket via MinIO console at http://localhost:9001
# Or use mc CLI:
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/pipeweave
```

**Option 3: AWS S3**

Create an S3 bucket and IAM user with appropriate permissions (see [Configuration Guide](./configuration.md#aws-s3)).

**Option 4: Google Cloud Storage**

Create a GCS bucket and service account with Storage Admin role (see [Configuration Guide](./configuration.md#google-cloud-storage)).

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate a secure secret key
openssl rand -hex 32

# Edit .env and set your values
```

**Minimum required configuration:**

```bash
# Database
DATABASE_URL=postgresql://pipeweave:pipeweave@localhost:5432/pipeweave

# Storage (using local filesystem for development)
STORAGE_BACKENDS='[
  {
    "id": "local-dev",
    "provider": "local",
    "endpoint": "file://",
    "bucket": "data",
    "credentials": { "basePath": "./storage" },
    "isDefault": true
  }
]'

# Security (use the key generated above)
PIPEWEAVE_SECRET_KEY=your-generated-secret-key-here
```

See the [Configuration Guide](./configuration.md) for all available options.

### 4. Initialize Database

**Option A: Complete Setup Wizard (Recommended)**

The easiest way to set up PipeWeave:

```bash
# Run the complete setup wizard
npx @pipeweave/cli setup

# Or if you've built the packages:
node packages/cli/dist/bin/pipeweave.js setup
```

This interactive wizard will:
- Create the database and user with a strong generated password
- Grant all necessary permissions
- Run all database migrations
- Generate a secure PipeWeave secret key
- Provide you with the complete configuration to add to your `.env` file

**Option B: Manual Database Initialization**

If you've already created your database manually:

```bash
# Initialize database schema
npx @pipeweave/cli db migrate --url $DATABASE_URL

# Or if using npm scripts:
npm run build:packages
node packages/cli/dist/bin/pipeweave.js db migrate --url $DATABASE_URL
```

### 5. Create Orchestrator Service

Create a file for your orchestrator (e.g., `orchestrator.ts`):

```typescript
import { createOrchestrator } from "@pipeweave/orchestrator";

const orchestrator = createOrchestrator({
  databaseUrl: process.env.DATABASE_URL!,
  storageBackends: [
    {
      id: "local-dev",
      provider: "local",
      endpoint: "file://",
      bucket: "data",
      credentials: { basePath: "./storage" },
      isDefault: true,
    },
  ],
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
  mode: "standalone",
  port: 3000,
  logLevel: "detailed",
});

// Start orchestrator
await orchestrator.start();

// Create and start HTTP server
const server = orchestrator.createServer();
await server.listen(3000, () => {
  console.log("Orchestrator ready on http://localhost:3000");
});
```

See the [orchestrator-setup example](../examples/orchestrator-setup) for more configuration options.

### 6. Start the Orchestrator

```bash
# Run your orchestrator service
npx tsx orchestrator.ts

# The orchestrator will start on http://localhost:3000
```

### 7. Create and Start a Worker Service

**Create a new worker project:**

```bash
# In a separate directory
mkdir my-worker && cd my-worker
npm init -y
npm install @pipeweave/sdk typescript tsx

# Create worker.ts
cat > worker.ts << 'EOF'
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: process.env.PIPEWEAVE_ORCHESTRATOR_URL!,
  serviceId: "my-service",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
});

worker.register("hello", async (ctx) => {
  ctx.log.info(`Processing: ${ctx.input.name}`);
  return { message: `Hello, ${ctx.input.name}!` };
});

worker.listen(8080);
EOF

# Start the worker
PIPEWEAVE_ORCHESTRATOR_URL=http://localhost:3000 \
PIPEWEAVE_SECRET_KEY=your-secret-key \
npx tsx worker.ts
```

The worker will automatically register its tasks with the orchestrator.

### 8. Start the UI Dashboard (Optional)

```bash
# In the pipeweave repo root
cd packages/ui
npm run dev

# The dashboard will start on http://localhost:4000
```

### 9. Test Your Setup

```bash
# List registered services
npx @pipeweave/cli services --url http://localhost:3000

# Queue a test task
npx @pipeweave/cli trigger my-pipeline \
  -i '{"name": "World"}' \
  --url http://localhost:3000

# Check run status
npx @pipeweave/cli status <run-id> --url http://localhost:3000

# Or view in the dashboard
open http://localhost:4000
```

## Development Workflow

**Start everything in development mode:**

```bash
# Terminal 1: Start your orchestrator
npx tsx orchestrator.ts

# Terminal 2: Start UI
cd packages/ui && npm run dev

# Terminal 3: Start your worker service
cd path/to/your/worker
npm run dev

# Terminal 4: Use CLI to trigger pipelines
npx @pipeweave/cli trigger <pipeline-id> -i '{...}'
```

## Common Commands

```bash
# Build all packages
npm run build

# Build only core packages (shared, sdk, orchestrator, cli)
npm run build:packages

# Run all tests
npm test

# Type check all packages
npm run typecheck

# Lint all code
npm run lint

# Format all code
npm run format

# Clean build artifacts
npm run clean
```

## Next Steps

- Read the [Examples Guide](./examples.md) to learn common patterns
- See [Architecture Overview](./architecture.md) to understand how PipeWeave works
- Check the [Configuration Guide](./configuration.md) for production settings
- Review the [Deployment Guide](./deployment.md) for production deployment

## Troubleshooting

### Database Connection Issues

```bash
# Test database connection
psql -h localhost -U pipeweave -d pipeweave

# Check if migrations ran
npx @pipeweave/cli db status --url $DATABASE_URL
```

### Worker Registration Fails

- Verify `PIPEWEAVE_SECRET_KEY` matches between orchestrator and worker
- Check orchestrator is accessible from worker at `PIPEWEAVE_ORCHESTRATOR_URL`
- Review orchestrator logs for authentication errors

### Storage Access Issues

- Local filesystem: Ensure `basePath` directory exists and has write permissions
- MinIO: Verify bucket exists and credentials are correct
- S3/GCS: Check IAM permissions and network access

For more help, see our [GitHub Issues](https://github.com/pipeweave/pipeweave/issues).
