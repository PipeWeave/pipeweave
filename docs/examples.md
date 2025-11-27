# Examples and Patterns

This guide shows common patterns and real-world examples for using PipeWeave.

## Table of Contents

- [Simple Task](#simple-task)
- [Task with Retries](#task-with-retries)
- [Idempotent Tasks](#idempotent-tasks)
- [Pipeline with Routing](#pipeline-with-routing)
- [Parallel Processing](#parallel-processing)
- [Error Handling](#error-handling)
- [Working with Large Files](#working-with-large-files)
- [Progress Reporting](#progress-reporting)
- [Real-World Examples](#real-world-examples)

## Simple Task

Basic task that processes input and returns output:

```typescript
import { createWorker } from "@pipeweave/sdk";

const worker = createWorker({
  orchestratorUrl: process.env.PIPEWEAVE_ORCHESTRATOR_URL!,
  serviceId: "data-processor",
  secretKey: process.env.PIPEWEAVE_SECRET_KEY!,
});

// Simple transformation task
worker.register("uppercase", async (ctx) => {
  const { text } = ctx.input;
  ctx.log.info(`Processing text: ${text}`);

  return {
    result: text.toUpperCase(),
    processedAt: new Date().toISOString(),
  };
});

worker.listen(8080);
```

**Triggering:**

```bash
npx @pipeweave/cli trigger uppercase -i '{"text": "hello world"}'
```

## Task with Retries

Task that handles transient failures with exponential backoff:

```typescript
worker.register(
  "fetch-api-data",
  {
    retries: 5,
    retryBackoff: "exponential",
    retryDelayMs: 1000,      // Start with 1s
    maxRetryDelayMs: 60000,  // Cap at 60s
    timeoutMs: 30000,        // 30s timeout per attempt
  },
  async (ctx) => {
    const { apiUrl } = ctx.input;

    ctx.log.info(`Fetching from ${apiUrl} (attempt ${ctx.attempt})`);

    // Fetch from external API
    const response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(25000),
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json();

    return {
      data,
      fetchedAt: new Date().toISOString(),
    };
  }
);
```

**Retry Schedule:**
- Attempt 1: Immediate
- Attempt 2: After 1s
- Attempt 3: After 2s
- Attempt 4: After 4s
- Attempt 5: After 8s
- Attempt 6: After 16s

## Idempotent Tasks

Ensure tasks run exactly once, even with retries:

```typescript
worker.register(
  "charge-payment",
  {
    // Generate unique key per order and code version
    idempotencyKey: (input, codeVersion) =>
      `payment-v${codeVersion}-${input.orderId}`,
    retries: 3,
    retryBackoff: "exponential",
    retryDelayMs: 2000,
  },
  async (ctx) => {
    const { orderId, amount, currency } = ctx.input;

    ctx.log.info(`Charging $${amount} ${currency} for order ${orderId}`);

    // This will only execute once per order
    // If retried, cached result is returned
    const charge = await stripe.charges.create({
      amount: amount * 100,
      currency,
      source: ctx.input.paymentToken,
      idempotency_key: `order-${orderId}`,
    });

    return {
      chargeId: charge.id,
      status: charge.status,
      chargedAt: new Date(charge.created * 1000).toISOString(),
    };
  }
);
```

**Key Points:**
- Include `codeVersion` in idempotency key to bust cache on code changes
- Idempotent results are cached for 24 hours by default
- Failed tasks are not cached (only successful completions)

## Pipeline with Routing

Dynamic routing based on task output:

```typescript
// Step 1: Fetch user data
worker.register(
  "fetch-user",
  { allowedNext: ["check-eligibility"] },
  async (ctx) => {
    const user = await db.users.findOne(ctx.input.userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        accountType: user.accountType,
        createdAt: user.createdAt,
      },
    };
  }
);

// Step 2: Check eligibility and route
worker.register(
  "check-eligibility",
  {
    allowedNext: [
      "premium-flow",
      "standard-flow",
      "trial-flow",
      "reject-flow",
    ],
  },
  async (ctx): Promise<TaskResult> => {
    const { user } = ctx.upstream["fetch-user"].output;

    // Premium users get special treatment
    if (user.accountType === "premium") {
      return {
        output: { eligible: true, tier: "premium" },
        runNext: ["premium-flow"],
      };
    }

    // Standard users
    if (user.accountType === "standard") {
      return {
        output: { eligible: true, tier: "standard" },
        runNext: ["standard-flow"],
      };
    }

    // Trial users
    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    if (accountAge < 30 * 24 * 60 * 60 * 1000) {
      return {
        output: { eligible: true, tier: "trial" },
        runNext: ["trial-flow"],
      };
    }

    // Not eligible
    return {
      output: { eligible: false, reason: "expired_trial" },
      runNext: ["reject-flow"],
    };
  }
);

// Step 3a: Premium flow
worker.register(
  "premium-flow",
  { allowedNext: [] },
  async (ctx) => {
    ctx.log.info("Processing premium user");
    // ... premium logic
    return { status: "processed", tier: "premium" };
  }
);

// Step 3b: Standard flow
worker.register(
  "standard-flow",
  { allowedNext: [] },
  async (ctx) => {
    ctx.log.info("Processing standard user");
    // ... standard logic
    return { status: "processed", tier: "standard" };
  }
);

// Step 3c: Trial flow
worker.register(
  "trial-flow",
  { allowedNext: [] },
  async (ctx) => {
    ctx.log.info("Processing trial user");
    // ... trial logic
    return { status: "processed", tier: "trial" };
  }
);

// Step 3d: Rejection flow
worker.register(
  "reject-flow",
  { allowedNext: [] },
  async (ctx) => {
    const { reason } = ctx.upstream["check-eligibility"].output;
    ctx.log.info(`Rejecting user: ${reason}`);
    // ... send rejection email
    return { status: "rejected", reason };
  }
);
```

## Parallel Processing

Process items in parallel using task concurrency:

```typescript
// Step 1: Split data into chunks
worker.register(
  "split-work",
  { allowedNext: ["process-chunk"] },
  async (ctx) => {
    const { items } = ctx.input;
    const chunkSize = 100;

    // Create chunks
    const chunks = [];
    for (let i = 0; i < items.length; i += chunkSize) {
      chunks.push(items.slice(i, i + chunkSize));
    }

    // Queue parallel tasks
    for (const chunk of chunks) {
      await ctx.queue("process-chunk", {
        items: chunk,
        chunkIndex: chunks.indexOf(chunk),
      });
    }

    return {
      totalChunks: chunks.length,
      totalItems: items.length,
    };
  }
);

// Step 2: Process chunks in parallel
worker.register(
  "process-chunk",
  {
    concurrency: 10,  // Process up to 10 chunks simultaneously
    allowedNext: ["aggregate-results"],
  },
  async (ctx) => {
    const { items, chunkIndex } = ctx.input;

    ctx.log.info(`Processing chunk ${chunkIndex} with ${items.length} items`);

    const results = [];
    for (const item of items) {
      // Process each item
      const result = await processItem(item);
      results.push(result);

      // Report progress
      await ctx.heartbeat(
        results.length / items.length,
        `Processed ${results.length}/${items.length}`
      );
    }

    return {
      chunkIndex,
      processedCount: results.length,
      results,
    };
  }
);

// Step 3: Aggregate results (join task)
worker.register(
  "aggregate-results",
  { allowedNext: [] },
  async (ctx) => {
    // Collect all chunk results
    const allResults = [];

    for (const [taskId, ref] of Object.entries(ctx.upstream)) {
      if (taskId.startsWith("process-chunk")) {
        allResults.push(...ref.output.results);
      }
    }

    ctx.log.info(`Aggregated ${allResults.length} total results`);

    return {
      totalProcessed: allResults.length,
      summary: generateSummary(allResults),
    };
  }
);
```

## Error Handling

Graceful error handling with custom error codes:

```typescript
worker.register("validate-and-process", async (ctx) => {
  const { data } = ctx.input;

  try {
    // Validation
    if (!data.email) {
      throw new TaskError("Missing required field: email", "VALIDATION_ERROR");
    }

    if (!data.email.includes("@")) {
      throw new TaskError("Invalid email format", "VALIDATION_ERROR");
    }

    // Processing
    try {
      const result = await externalApi.process(data);
      return { success: true, result };
    } catch (apiError) {
      // Wrap API errors
      throw new TaskError(
        `API error: ${apiError.message}`,
        "EXTERNAL_API_ERROR",
        { originalError: apiError }
      );
    }
  } catch (error) {
    ctx.log.error("Task failed", { error });

    // Re-throw to fail the task
    throw error;
  }
});

// Custom error class
class TaskError extends Error {
  constructor(
    message: string,
    public code: string,
    public metadata?: any
  ) {
    super(message);
    this.name = "TaskError";
  }
}
```

## Working with Large Files

Upload and download large files using storage assets:

```typescript
worker.register("process-video", async (ctx) => {
  const { videoUrl } = ctx.input;

  ctx.log.info(`Downloading video from ${videoUrl}`);

  // Download video to temporary file
  const tempPath = `/tmp/video-${ctx.runId}.mp4`;
  await downloadFile(videoUrl, tempPath);

  // Process video (e.g., transcode)
  ctx.log.info("Transcoding video");
  const outputPath = `/tmp/output-${ctx.runId}.mp4`;
  await transcodeVideo(tempPath, outputPath);

  // Upload result as asset
  ctx.log.info("Uploading processed video");
  const assetPath = await ctx.uploadAsset(
    "processed-video",
    outputPath,
    "video/mp4"
  );

  // Cleanup
  await fs.unlink(tempPath);
  await fs.unlink(outputPath);

  return {
    processedVideoPath: assetPath,
    duration: 120, // seconds
    size: 15728640, // bytes
  };
});

// Access asset in downstream task
worker.register("upload-to-cdn", async (ctx) => {
  const { processedVideoPath } = ctx.upstream["process-video"].output;

  // Download asset from storage
  const videoData = await ctx.storage.getObject(processedVideoPath);

  // Upload to CDN
  const cdnUrl = await cdnApi.upload(videoData);

  return {
    cdnUrl,
    uploadedAt: new Date().toISOString(),
  };
});
```

## Progress Reporting

Report progress during long-running tasks:

```typescript
worker.register(
  "batch-import",
  {
    heartbeatIntervalMs: 30000, // Heartbeat every 30s
    timeoutMs: 3600000,         // 1 hour timeout
  },
  async (ctx) => {
    const { records } = ctx.input;
    const total = records.length;

    ctx.log.info(`Importing ${total} records`);

    const imported = [];
    const failed = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      try {
        // Import record
        await db.insert(record);
        imported.push(record.id);
      } catch (error) {
        failed.push({ id: record.id, error: error.message });
      }

      // Report progress every 100 records
      if ((i + 1) % 100 === 0) {
        const progress = (i + 1) / total;
        await ctx.heartbeat(
          progress,
          `Imported ${i + 1}/${total} records`
        );
      }
    }

    // Final heartbeat
    await ctx.heartbeat(1.0, "Import complete");

    return {
      total,
      imported: imported.length,
      failed: failed.length,
      failedRecords: failed,
    };
  }
);
```

## Real-World Examples

### Example 1: User Onboarding Pipeline

```typescript
// 1. Create user account
worker.register(
  "create-account",
  { allowedNext: ["send-welcome-email", "setup-workspace"] },
  async (ctx) => {
    const user = await db.users.create({
      email: ctx.input.email,
      name: ctx.input.name,
    });

    return { userId: user.id, email: user.email };
  }
);

// 2a. Send welcome email (parallel with 2b)
worker.register(
  "send-welcome-email",
  {
    allowedNext: ["track-onboarding"],
    retries: 3,
    retryBackoff: "exponential",
  },
  async (ctx) => {
    const { email } = ctx.upstream["create-account"].output;

    await emailService.send({
      to: email,
      template: "welcome",
      data: { name: ctx.input.name },
    });

    return { emailSent: true };
  }
);

// 2b. Setup workspace (parallel with 2a)
worker.register(
  "setup-workspace",
  { allowedNext: ["track-onboarding"] },
  async (ctx) => {
    const { userId } = ctx.upstream["create-account"].output;

    // Create default workspace
    const workspace = await db.workspaces.create({
      ownerId: userId,
      name: "My Workspace",
    });

    return { workspaceId: workspace.id };
  }
);

// 3. Track onboarding completion (join task)
worker.register(
  "track-onboarding",
  { allowedNext: [] },
  async (ctx) => {
    const { userId } = ctx.upstream["create-account"].output;

    await analytics.track(userId, "onboarding_completed", {
      emailSent: ctx.upstream["send-welcome-email"].output.emailSent,
      workspaceCreated: true,
    });

    return { completed: true };
  }
);
```

### Example 2: Data Processing Pipeline

```typescript
// 1. Fetch data from API
worker.register(
  "fetch-data",
  {
    allowedNext: ["validate-data"],
    retries: 5,
    retryBackoff: "exponential",
  },
  async (ctx) => {
    const response = await fetch(ctx.input.apiUrl);
    const data = await response.json();

    return { records: data.items, fetchedAt: Date.now() };
  }
);

// 2. Validate data
worker.register(
  "validate-data",
  { allowedNext: ["transform-data", "handle-invalid-data"] },
  async (ctx): Promise<TaskResult> => {
    const { records } = ctx.upstream["fetch-data"].output;

    const valid = [];
    const invalid = [];

    for (const record of records) {
      if (isValid(record)) {
        valid.push(record);
      } else {
        invalid.push(record);
      }
    }

    // Route based on validation results
    if (invalid.length > 0) {
      return {
        output: { valid, invalid },
        runNext: ["transform-data", "handle-invalid-data"],
      };
    }

    return {
      output: { valid, invalid },
      runNext: ["transform-data"],
    };
  }
);

// 3a. Transform valid data
worker.register(
  "transform-data",
  { allowedNext: ["load-data"] },
  async (ctx) => {
    const { valid } = ctx.upstream["validate-data"].output;

    const transformed = valid.map(record => ({
      ...record,
      processedAt: new Date().toISOString(),
      // ... transformation logic
    }));

    return { records: transformed };
  }
);

// 3b. Handle invalid data (conditional)
worker.register(
  "handle-invalid-data",
  { allowedNext: [] },
  async (ctx) => {
    const { invalid } = ctx.upstream["validate-data"].output;

    // Log to DLQ or alert system
    ctx.log.warn(`Found ${invalid.length} invalid records`);

    await alerting.notify({
      level: "warning",
      message: `Data validation failed for ${invalid.length} records`,
      data: invalid,
    });

    return { handled: invalid.length };
  }
);

// 4. Load data into database
worker.register(
  "load-data",
  {
    allowedNext: [],
    idempotencyKey: (input, version) =>
      `load-${version}-${input.pipelineRunId}`,
  },
  async (ctx) => {
    const { records } = ctx.upstream["transform-data"].output;

    await db.batchInsert(records);

    return {
      loaded: records.length,
      loadedAt: new Date().toISOString(),
    };
  }
);
```

### Example 3: E-commerce Order Processing

```typescript
// 1. Validate order
worker.register(
  "validate-order",
  { allowedNext: ["check-inventory", "process-payment"] },
  async (ctx) => {
    const order = ctx.input;

    // Validation logic
    if (!order.items || order.items.length === 0) {
      throw new Error("Order has no items");
    }

    return { orderId: order.id, valid: true };
  }
);

// 2a. Check inventory (parallel with payment)
worker.register(
  "check-inventory",
  { allowedNext: ["fulfill-order"] },
  async (ctx) => {
    const { items } = ctx.input;

    for (const item of items) {
      const available = await inventory.check(item.sku, item.quantity);
      if (!available) {
        throw new Error(`Insufficient inventory for ${item.sku}`);
      }
    }

    // Reserve inventory
    await inventory.reserve(ctx.input.orderId, items);

    return { inventoryReserved: true };
  }
);

// 2b. Process payment (parallel with inventory)
worker.register(
  "process-payment",
  {
    allowedNext: ["fulfill-order"],
    idempotencyKey: (input, version) =>
      `payment-v${version}-${input.orderId}`,
    retries: 3,
  },
  async (ctx) => {
    const { orderId, amount, paymentMethod } = ctx.input;

    const charge = await paymentGateway.charge({
      amount,
      source: paymentMethod,
      idempotency_key: `order-${orderId}`,
    });

    return {
      chargeId: charge.id,
      paid: true,
    };
  }
);

// 3. Fulfill order (join task)
worker.register(
  "fulfill-order",
  { allowedNext: ["send-confirmation"] },
  async (ctx) => {
    const { orderId } = ctx.upstream["validate-order"].output;
    const { chargeId } = ctx.upstream["process-payment"].output;

    // Create shipment
    const shipment = await shipping.create({
      orderId,
      items: ctx.input.items,
      address: ctx.input.shippingAddress,
    });

    return {
      shipmentId: shipment.id,
      trackingNumber: shipment.trackingNumber,
    };
  }
);

// 4. Send confirmation
worker.register(
  "send-confirmation",
  { allowedNext: [] },
  async (ctx) => {
    const { orderId } = ctx.upstream["validate-order"].output;
    const { trackingNumber } = ctx.upstream["fulfill-order"].output;

    await emailService.send({
      to: ctx.input.customerEmail,
      template: "order-confirmation",
      data: {
        orderId,
        trackingNumber,
        items: ctx.input.items,
      },
    });

    return { confirmationSent: true };
  }
);
```

## Testing Patterns

### Local Testing

```typescript
import { runLocal } from "@pipeweave/sdk";

describe("Task: uppercase", () => {
  it("should convert text to uppercase", async () => {
    const result = await runLocal(worker, "uppercase", {
      input: { text: "hello world" },
    });

    expect(result.output.result).toBe("HELLO WORLD");
  });
});
```

### Integration Testing

```typescript
describe("Pipeline: user-onboarding", () => {
  it("should complete full onboarding flow", async () => {
    const runId = await triggerPipeline("user-onboarding", {
      email: "test@example.com",
      name: "Test User",
    });

    // Wait for completion
    const result = await waitForCompletion(runId, 30000);

    expect(result.status).toBe("completed");
    expect(result.tasks).toHaveLength(4);
    expect(result.tasks.every(t => t.status === "completed")).toBe(true);
  });
});
```

## Next Steps

- See [Architecture Guide](./architecture.md) for system internals
- See [Configuration Guide](./configuration.md) for tuning options
- Check [SPEC.md](../SPEC.md) for complete API reference
