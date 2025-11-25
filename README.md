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

## Development

### Prerequisites

- Node.js >= 18
- npm >= 9

### Setup

```bash
# Clone the repository
git clone https://github.com/pipeweave/pipeweave.git
cd pipeweave

# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test
```

### Development Commands

```bash
# Build all packages
npm run build

# Run in development mode
npm run dev

# Run orchestrator in dev mode
npm run dev:orchestrator

# Run UI in dev mode
npm run dev:ui

# Type check
npm run typecheck

# Lint
npm run lint

# Format code
npm run format
```

## Architecture

For detailed architecture, API reference, and complete specification, see [SPEC.md](./SPEC.md).

## Documentation

See [SPEC.md](./SPEC.md) for the full specification.

## License

MIT © PipeWeave Contributors
