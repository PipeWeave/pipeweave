# @pipeweave/cli

Command-line interface for PipeWeave — trigger pipelines, manage databases, and monitor services.

## Installation

```bash
npm install -g @pipeweave/cli
```

Or use via npx:

```bash
npx @pipeweave/cli <command>
```

## Quick Start

```bash
# Initialize a new project
pipeweave init --name my-service

# Initialize database
pipeweave db init --url $DATABASE_URL

# List registered services
pipeweave services --url http://localhost:3000

# Trigger a pipeline
pipeweave trigger pdf-processor -i '{"pdfUrl": "https://..."}' --wait

# View run status
pipeweave status prun_abc123

# Manage dead letter queue
pipeweave dlq list
```

## Commands

### Project Management

#### `pipeweave init`

Create a new PipeWeave service project.

```bash
pipeweave init --name my-service
```

**Options:**
- `--name` — Service name (required)
- `--template` — Template to use (default: `basic`)

### Service Management

#### `pipeweave services`

List all registered services.

```bash
pipeweave services --url http://localhost:3000
```

**Output:**
```
Services:
  • pdf-processor (v1.2.0) — 3 tasks, last seen 2m ago
  • email-sender (v1.0.1) — 2 tasks, last seen 5m ago
```

### Pipeline Operations

#### `pipeweave trigger`

Trigger a pipeline execution.

```bash
pipeweave trigger <pipeline-id> [options]
```

**Options:**
- `-i, --input <json>` — Pipeline input as JSON string
- `-f, --file <path>` — Read input from file
- `-w, --wait` — Wait for pipeline to complete
- `-p, --priority <number>` — Override priority (default: 100)
- `--url <url>` — Orchestrator URL

**Examples:**

```bash
# Trigger with inline JSON
pipeweave trigger pdf-processor -i '{"pdfUrl": "https://example.com/doc.pdf"}'

# Trigger with input from file
pipeweave trigger pdf-processor -f input.json

# Trigger and wait for completion
pipeweave trigger pdf-processor -i '{"pdfUrl": "..."}' --wait

# Trigger with high priority
pipeweave trigger urgent-task -i '{}' -p 10
```

#### `pipeweave dry-run`

Validate a pipeline without executing it.

```bash
pipeweave dry-run <pipeline-id> [options]
```

**Options:**
- `-i, --input <json>` — Pipeline input as JSON string
- `-f, --file <path>` — Read input from file
- `--url <url>` — Orchestrator URL

**Output:**
```
✓ Pipeline 'pdf-processor' validated

Execution plan:
  1. download (entry)
  2. extract-text, extract-tables (parallel)
  3. summarize (join, waits for: extract-text, extract-tables)
  4. notify, archive (parallel, end)

Warnings:
  - Task 'extract-tables' has concurrency limit of 2
```

#### `pipeweave status`

Get the status of a pipeline run.

```bash
pipeweave status <run-id> [options]
```

**Options:**
- `--url <url>` — Orchestrator URL
- `--watch` — Continuously watch for updates

**Examples:**

```bash
# Check status once
pipeweave status prun_abc123

# Watch status in real-time
pipeweave status prun_abc123 --watch
```

### Dead Letter Queue

#### `pipeweave dlq list`

List all failed tasks in the dead letter queue.

```bash
pipeweave dlq list [options]
```

**Options:**
- `--url <url>` — Orchestrator URL
- `--pipeline <id>` — Filter by pipeline
- `--limit <number>` — Max results (default: 50)

**Output:**
```
Dead Letter Queue (5 items):

  1. dlq_abc123
     Task: process-document (v3)
     Pipeline: pdf-processor (prun_def456)
     Failed: 2024-01-15 10:30:00
     Error: Connection timeout after 3 retries

  2. dlq_xyz789
     Task: send-email (v2)
     Failed: 2024-01-15 09:15:00
     Error: Invalid email address
```

#### `pipeweave dlq show`

Show details of a DLQ entry.

```bash
pipeweave dlq show <dlq-id>
```

#### `pipeweave dlq retry`

Retry a failed task from the DLQ.

```bash
pipeweave dlq retry <dlq-id> [options]
```

**Options:**
- `--url <url>` — Orchestrator URL

**Note:** Retrying uses the current code version, not the version that failed.

#### `pipeweave dlq retry-all`

Retry all failed tasks matching criteria.

```bash
pipeweave dlq retry-all [options]
```

**Options:**
- `--pipeline <id>` — Retry only tasks from this pipeline
- `--task <id>` — Retry only this task type
- `--url <url>` — Orchestrator URL

**Examples:**

```bash
# Retry all DLQ items for a pipeline
pipeweave dlq retry-all --pipeline pdf-processor

# Retry all DLQ items for a specific task
pipeweave dlq retry-all --task download
```

#### `pipeweave dlq purge`

Remove old DLQ entries.

```bash
pipeweave dlq purge [options]
```

**Options:**
- `--older-than <duration>` — Purge entries older than duration (e.g., `7d`, `24h`)
- `--url <url>` — Orchestrator URL

**Examples:**

```bash
# Purge DLQ entries older than 7 days
pipeweave dlq purge --older-than 7d

# Purge DLQ entries older than 24 hours
pipeweave dlq purge --older-than 24h
```

### Database Management

#### `pipeweave db init`

Initialize the database schema.

```bash
pipeweave db init --url <database-url>
```

**Options:**
- `--url <url>` — PostgreSQL connection string (or use `DATABASE_URL` env var)

#### `pipeweave db migrate`

Run database migrations.

```bash
pipeweave db migrate --url <database-url>
```

#### `pipeweave db status`

Show database migration status.

```bash
pipeweave db status --url <database-url>
```

#### `pipeweave db reset`

Reset the database (destructive).

```bash
pipeweave db reset --url <database-url> --yes
```

**Options:**
- `--yes` — Skip confirmation prompt

**Warning:** This command drops all tables and data. Use with caution!

## Environment Variables

The CLI supports the following environment variables:

| Variable | Description |
|----------|-------------|
| `PIPEWEAVE_ORCHESTRATOR_URL` | Default orchestrator URL |
| `PIPEWEAVE_API_TOKEN` | API authentication token |
| `DATABASE_URL` | PostgreSQL connection string (for `db` commands) |

## Configuration File

Create a `.pipeweaverc.json` file in your project root:

```json
{
  "orchestratorUrl": "http://localhost:3000",
  "apiToken": "your-token",
  "defaultPriority": 100
}
```

The CLI reads configuration in this order (later overrides earlier):
1. `.pipeweaverc.json`
2. Environment variables
3. Command-line flags

## Examples

### Typical Workflow

```bash
# 1. Initialize database (first time)
pipeweave db init --url $DATABASE_URL

# 2. Start orchestrator and workers
npm run dev:orchestrator &
npm run dev:worker &

# 3. List registered services
pipeweave services

# 4. Validate pipeline
pipeweave dry-run pdf-processor -i '{"pdfUrl": "https://example.com/doc.pdf"}'

# 5. Trigger pipeline
pipeweave trigger pdf-processor -i '{"pdfUrl": "https://example.com/doc.pdf"}' --wait

# 6. Check for failures
pipeweave dlq list

# 7. Retry failed tasks
pipeweave dlq retry dlq_abc123
```

### Batch Processing

```bash
# Trigger multiple pipelines from a file
cat urls.txt | while read url; do
  pipeweave trigger pdf-processor -i "{\"pdfUrl\": \"$url\"}"
done
```

### Monitoring

```bash
# Watch a pipeline run in real-time
pipeweave status prun_abc123 --watch

# Check queue status
curl http://localhost:3000/api/queue/status
```

## Global Options

All commands support these global options:

- `--url <url>` — Orchestrator URL
- `--token <token>` — API authentication token
- `--json` — Output as JSON
- `--verbose` — Verbose logging
- `--help` — Show help

## Documentation

For complete documentation, see the [main specification](../../SPEC.md).

## License

MIT
