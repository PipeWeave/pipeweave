# @pipeweave/ui

Web-based monitoring dashboard for PipeWeave orchestrators.

## Features

- **Multi-orchestrator support** — Monitor multiple environments (prod, staging, dev) from one UI
- **Real-time updates** — Auto-refresh run status
- **Pipeline visualization** — View DAG structure and task flow
- **Run monitoring** — Track task execution, errors, and progress
- **Pipeline triggering** — Start runs directly from the UI
- **Dead Letter Queue** — View and retry failed tasks
- **Code change tracking** — See which tasks changed between runs
- **Search and filtering** — Find runs by status, pipeline, date

## Quick Start

### Development

```bash
cd packages/ui
npm install
npm run dev
```

Open [http://localhost:4000](http://localhost:4000)

### Production

```bash
npm run build
npm start
```

## Adding Orchestrators

The UI can connect to multiple orchestrators simultaneously:

1. Click the **+** button in the sidebar
2. Enter orchestrator details:
   - **Name:** Display name (e.g., "Production")
   - **URL:** Orchestrator endpoint (e.g., `https://orchestrator.example.com`)
   - **API Key:** Optional authentication token
3. Click **Add**

Orchestrator connections are stored in browser localStorage and persist across sessions.

## Pages

### Dashboard (`/`)

Overview of all connected orchestrators:

- **Recent runs** — Latest pipeline executions with status
- **Active pipelines** — Pipelines ready to trigger
- **Queue statistics** — Pending, running, completed, failed
- **DLQ summary** — Failed tasks requiring attention

### Pipelines (`/pipelines`)

List of all registered pipelines:

- **Pipeline name and ID**
- **Task count and DAG structure**
- **Last run timestamp**
- **Trigger button** with input form

### Runs (`/runs`)

List of all pipeline runs with filtering:

- **Filter by:**
  - Orchestrator
  - Pipeline
  - Status (pending, running, completed, failed)
  - Date range
- **Columns:**
  - Run ID
  - Pipeline name
  - Status with visual indicator
  - Start/end time
  - Duration
  - Code version changes

### Run Detail (`/runs/:id`)

Detailed view of a single pipeline run:

- **Timeline** — Visual execution timeline with task dependencies
- **Task list** — All tasks with status, duration, attempts
- **Input/Output** — View hydrated context and results
- **Logs** — Structured logs from task execution
- **Assets** — Download or preview binary assets
- **Errors** — Stack traces and retry information
- **Code info** — Code version and hash for each task

### Dead Letter Queue (`/dlq`)

Failed tasks after all retries:

- **Filter by:**
  - Orchestrator
  - Pipeline
  - Task type
  - Date range
- **Actions:**
  - View error details
  - Inspect input/context
  - Retry individual items
  - Bulk retry by pipeline or task type
  - Purge old entries

### Task Code History (`/tasks/:id/history`)

Version history for a specific task:

- **Code version timeline**
- **Hash changes**
- **Service version at time of change**
- **Timestamp**

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | HTTP server port |
| `NODE_ENV` | `development` | Environment mode |

### Build-time Configuration

Create a `.env.local` file:

```bash
# Optional: Default orchestrator URLs (comma-separated)
NEXT_PUBLIC_DEFAULT_ORCHESTRATORS=http://localhost:3000,https://orchestrator.example.com
```

## Features

### Real-time Updates

The UI polls orchestrators every 5 seconds (configurable) to refresh:

- Run status changes
- Queue statistics
- DLQ entries

### Code Change Indicators

When viewing runs, the UI highlights tasks with code changes:

- 🔄 **Code changed** — Task code version differs from previous run
- ⚠️ **First run** — Task never executed before

### Pipeline Visualization

The pipeline DAG is rendered using:

- **Entry tasks** — Green indicator
- **End tasks** — Red indicator
- **Join tasks** — Multiple incoming edges
- **Parallel tasks** — Same vertical level

### Triggering Pipelines

1. Navigate to **Pipelines** page
2. Click **Trigger** on the desired pipeline
3. Enter input JSON in the modal
4. Optionally set priority
5. Click **Submit**

The UI validates JSON before submission and shows errors inline.

### Retrying Failed Tasks

From the **Dead Letter Queue** page:

1. Select a DLQ entry
2. Click **Retry**
3. Confirm the action

**Note:** Retrying uses the current code version, not the version that originally failed.

### Downloading Assets

From the **Run Detail** page:

1. Navigate to the **Assets** tab
2. Click **Download** next to any asset
3. Binary assets are downloaded directly
4. JSON/text assets can be previewed inline

## Tech Stack

- **Next.js 14** — React framework with App Router
- **TypeScript** — Type-safe development
- **Tailwind CSS** — Utility-first styling
- **Radix UI** — Accessible component primitives
- **React Query** — Data fetching and caching
- **Zustand** — State management for orchestrator connections

## Development

### Project Structure

```
packages/ui/
├── app/                  # Next.js App Router pages
│   ├── page.tsx         # Dashboard
│   ├── pipelines/       # Pipelines list and detail
│   ├── runs/            # Runs list and detail
│   └── dlq/             # Dead letter queue
├── components/          # React components
│   ├── ui/             # Reusable UI components
│   ├── PipelineDAG.tsx # DAG visualization
│   └── RunTimeline.tsx # Execution timeline
├── lib/                # Utilities and helpers
│   ├── api.ts          # API client
│   ├── store.ts        # Zustand store
│   └── utils.ts        # Helper functions
└── public/             # Static assets
```

### Adding Features

1. **New page:**
   ```bash
   # Create app/my-feature/page.tsx
   ```

2. **New component:**
   ```bash
   # Create components/MyComponent.tsx
   ```

3. **New API endpoint:**
   ```bash
   # Create app/api/my-endpoint/route.ts
   ```

### Styling

The UI uses Tailwind CSS with a custom theme. Colors and spacing follow the design system defined in `tailwind.config.js`.

### State Management

Orchestrator connections are managed via Zustand:

```typescript
import { useOrchestratorStore } from "@/lib/store";

const { orchestrators, addOrchestrator, removeOrchestrator } = useOrchestratorStore();
```

## Deployment

### Vercel

```bash
vercel deploy
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
CMD ["npm", "start"]
```

### Static Export

For hosting on CDN/static hosting:

```bash
npm run build
npm run export
```

The `out/` directory contains static HTML/JS/CSS.

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Accessibility

The UI follows WCAG 2.1 Level AA guidelines:

- Keyboard navigation
- Screen reader support
- Focus indicators
- Semantic HTML
- ARIA labels

## Documentation

For complete documentation, see the [main specification](../../SPEC.md).

## License

MIT
