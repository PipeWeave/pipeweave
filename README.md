# PipeWeave

**A lightweight, debuggable task orchestration framework for serverless architectures**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- **Local debuggability** — Set breakpoints in your IDE and step through task handlers
- **Serverless-first** — Deploy tasks anywhere (Cloud Run, Lambda, Kubernetes, bare metal)
- **Programmatic pipeline definition** — Define workflows in code with dynamic routing
- **Simple data passing** — Single hydrated context per task with automatic S3 persistence
- **Reliable execution** — Heartbeat monitoring, automatic retries, timeout handling

## Packages

| Package | Description |
| ------- | ----------- |
| [`@pipeweave/sdk`](./sdks/nodejs) | Worker SDK for Node.js — [docs](./sdks/nodejs/README.md) |
| [`@pipeweave/orchestrator`](./packages/orchestrator) | Task execution engine — [docs](./packages/orchestrator/README.md) |
| [`@pipeweave/cli`](./packages/cli) | Command line interface — [docs](./packages/cli/README.md) |
| [`@pipeweave/ui`](./packages/ui) | Web monitoring dashboard — [docs](./packages/ui/README.md) |
| [`@pipeweave/shared`](./packages/shared) | Shared types and utilities — [docs](./packages/shared/README.md) |

## Quick Start

### Installation

```bash
npm install @pipeweave/sdk
```

### Define Tasks

```typescript
import { createWorker, TaskResult } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: "http://localhost:3000",
  serviceId: "my-service",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
});

// Simple task
worker.register("process", async (ctx) => {
  const { data } = ctx.input;
  return { processed: true, result: data.toUpperCase() };
});

// Task with programmatic next selection
worker.register(
  "router",
  {
    allowedNext: ["path-a", "path-b"],
  },
  async (ctx): Promise<TaskResult> => {
    if (ctx.input.fast) {
      return { output: { routed: true }, runNext: ["path-a"] };
    }
    return { output: { routed: true }, runNext: ["path-b"] };
  }
);

// Idempotent task
worker.register(
  "payment",
  {
    idempotencyKey: (input, codeVersion) => `v${codeVersion}-${input.orderId}`,
    retries: 3,
  },
  async (ctx) => {
    ctx.log.info(`Processing payment v${ctx.codeVersion}`);
    return { success: true };
  }
);

worker.listen(8080);
```

### Local Testing

```typescript
import { runLocal } from "@pipeweave/sdk";

const result = await runLocal(worker, "process", {
  input: { data: "hello" },
});

console.log(result.output); // { processed: true, result: 'HELLO' }
```

## Project Structure

```
pipeweave/
├── packages/
│   ├── shared/          # Shared types, constants, utilities
│   ├── orchestrator/    # Core execution engine
│   ├── cli/             # Command line tool
│   └── ui/              # Next.js web dashboard
├── sdks/
│   └── nodejs/          # Node.js SDK
├── examples/            # Example projects
└── docs/                # Documentation
```

## Setup Guide

### Prerequisites

- **Node.js >= 18** and **npm >= 9**
- **PostgreSQL** (for orchestrator database)
- **S3 or MinIO** (for data storage)

### Architecture Overview

PipeWeave consists of several modules that work together:

1. **[@pipeweave/shared](./packages/shared)** — Shared types, constants, and utilities used by all packages
2. **[@pipeweave/sdk](./sdks/nodejs)** — Node.js SDK for creating worker services that execute tasks
3. **[@pipeweave/orchestrator](./packages/orchestrator)** — Core execution engine that manages pipelines and coordinates workers
4. **[@pipeweave/cli](./packages/cli)** — Command-line tool for triggering pipelines and managing the system
5. **[@pipeweave/ui](./packages/ui)** — Web dashboard for monitoring pipeline runs and task execution

### How They Work Together

```mermaid
graph TB
    Worker["Workers<br/>@pipeweave/sdk"]
    Orch["Orchestrator<br/>@pipeweave/orchestrator"]
    CLI["CLI<br/>@pipeweave/cli"]
    UI["Dashboard<br/>@pipeweave/ui"]
    DB[("PostgreSQL<br/>metadata")]
    S3[("S3/MinIO<br/>task data")]

    Worker -->|"1. Register tasks"| Orch
    Orch -->|"2. Task execution requests"| Worker
    CLI -->|"3. Trigger pipelines<br/>4. Query status"| Orch
    UI -->|"5. Fetch runs & stats"| Orch

    Orch -.->|"6. Store metadata"| DB
    Orch -.->|"7. Store task I/O"| S3
    Worker -.->|"8. Direct access"| S3
```

**Data Flow:**

```mermaid
sequenceDiagram
    participant Worker
    participant Orchestrator
    participant S3
    participant DB

    Note over Worker,Orchestrator: 1. Worker Registration
    Worker->>Orchestrator: 1.1 Register tasks with code hashes
    Orchestrator->>DB: 1.2 Store task definitions

    Note over Orchestrator,DB: 2. Pipeline Trigger
    Orchestrator->>S3: 2.1 Store input data
    Orchestrator->>DB: 2.2 Create pipeline run & queue tasks

    rect rgb(240, 248, 255)
        Note over Orchestrator: Polling Loop (every 1s in standalone mode)
        Orchestrator->>DB: 2.3 Poll for pending tasks
    end

    Note over Worker,S3: 3. Task Execution
    Orchestrator->>Worker: 3.1 Send JWT + S3 path
    Worker->>S3: 3.2 Fetch input directly

    rect rgb(255, 250, 240)
        Note over Worker,Orchestrator: Heartbeat Loop (every 60s default)
        Worker->>Orchestrator: 3.3 Heartbeat (progress)
    end

    Worker->>S3: 3.4 Store output directly
    Worker->>Orchestrator: 3.5 Callback (metadata only)

    Note over Orchestrator,DB: 4. Next Task
    Orchestrator->>DB: 4.1 Queue downstream tasks

    rect rgb(240, 248, 255)
        Note over Orchestrator: Polling Loop continues
        Orchestrator->>DB: 4.2 Poll for next pending tasks
    end
```

### Complete Setup

#### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/pipeweave/pipeweave.git
cd pipeweave

# Install dependencies for all packages
npm install

# Build all packages (builds in dependency order)
npm run build
```

#### 2. Set Up Infrastructure

**PostgreSQL Database:**

```bash
# Using Docker
docker run -d \
  --name pipeweave-db \
  -e POSTGRES_DB=pipeweave \
  -e POSTGRES_USER=pipeweave \
  -e POSTGRES_PASSWORD=pipeweave \
  -p 5432:5432 \
  postgres:15

# Or install PostgreSQL natively and create database
createdb pipeweave
```

**MinIO (S3-compatible storage):**

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

#### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Generate a secure secret key
openssl rand -hex 32

# Edit .env and set your values
# At minimum, configure:
# - DATABASE_URL
# - S3_* variables
# - PIPEWEAVE_SECRET_KEY (use the generated key above)
```

**Required variables:**
- `DATABASE_URL` — PostgreSQL connection string
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` — S3/MinIO credentials
- `PIPEWEAVE_SECRET_KEY` — Shared encryption key (must be same on orchestrator and all workers)

#### 4. Initialize Database

```bash
# Initialize database schema
npx @pipeweave/cli db init --url $DATABASE_URL

# Or if using npm scripts:
npm run build:packages  # Ensure CLI is built
node packages/cli/dist/index.js db init --url $DATABASE_URL
```

#### 5. Start the Orchestrator

```bash
# Development mode (with auto-reload)
npm run dev:orchestrator

# Or production mode
cd packages/orchestrator
npm run build
npm start

# The orchestrator will start on http://localhost:3000
```

#### 6. Create and Start a Worker Service

**Create a new worker project:**

```bash
# In a separate directory
mkdir my-worker && cd my-worker
npm init -y
npm install @pipeweave/sdk

# Create worker.ts
cat > worker.ts << 'EOF'
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: process.env.PIPEWEAVE_ORCHESTRATOR_URL!,
  serviceId: "my-service",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
});

worker.register("hello", async (ctx) => {
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

#### 7. Start the UI Dashboard (Optional)

```bash
# In the pipeweave repo root
npm run dev:ui

# The dashboard will start on http://localhost:4000
```

#### 8. Test Your Setup

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

### Development Workflow

**Start everything in development mode:**

```bash
# Terminal 1: Start orchestrator
npm run dev:orchestrator

# Terminal 2: Start UI
npm run dev:ui

# Terminal 3: Start your worker service
cd path/to/your/worker
npm run dev

# Terminal 4: Use CLI to trigger pipelines
npx @pipeweave/cli trigger <pipeline-id> -i '{...}'
```

**Watch mode for all packages:**

```bash
# Run all packages in dev mode simultaneously
npm run dev
```

### Common Commands

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

## Architecture

For detailed architecture, API reference, and complete specification, see [SPEC.md](./SPEC.md).

## Documentation

See [SPEC.md](./SPEC.md) for the full specification.

## License

MIT © PipeWeave Contributors
