import type { Database } from '../db/index.js';

// ============================================================================
// Types
// ============================================================================

export interface TaskNode {
  taskId: string;
  allowedNext: string[];
  serviceId: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  entryTasks: string[];
  endTasks: string[];
  graph: Map<string, TaskNode>;
}

export interface DAGAnalysis {
  entryNodes: string[];
  endNodes: string[];
  hasCycles: boolean;
  cycles: string[][];
  disconnected: string[][];
  maxDepth: number;
}

// ============================================================================
// Pipeline Validator
// ============================================================================

export class PipelineValidator {
  constructor(private db: Database) {}

  /**
   * Validate a pipeline defined by a set of task IDs
   */
  async validatePipeline(taskIds: string[]): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Load task definitions from database
    const tasks = await this.loadTasks(taskIds);
    const taskMap = new Map<string, TaskNode>(tasks.map((t) => [t.taskId, t]));

    // Check that all task IDs exist
    const missingTasks = taskIds.filter((id) => !taskMap.has(id));
    if (missingTasks.length > 0) {
      errors.push(`Tasks not found: ${missingTasks.join(', ')}`);
      return {
        valid: false,
        errors,
        warnings,
        entryTasks: [],
        endTasks: [],
        graph: taskMap,
      };
    }

    // Validate that all allowedNext references exist
    for (const task of tasks) {
      for (const nextId of task.allowedNext) {
        if (!taskMap.has(nextId)) {
          errors.push(`Task '${task.taskId}' references non-existent task '${nextId}' in allowedNext`);
        }
      }
    }

    // Build dependency graph and analyze
    const analysis = this.analyzeDAG(taskMap);

    // Check for cycles
    if (analysis.hasCycles) {
      for (const cycle of analysis.cycles) {
        errors.push(`Cycle detected: ${cycle.join(' -> ')}`);
      }
    }

    // Check for disconnected subgraphs
    if (analysis.disconnected.length > 1) {
      warnings.push(
        `Pipeline contains ${analysis.disconnected.length} disconnected subgraphs. ` +
          `Only the first subgraph will be executed.`
      );
    }

    // Check for no entry tasks
    if (analysis.entryNodes.length === 0) {
      errors.push('Pipeline has no entry tasks (tasks with no predecessors)');
    }

    // Check for no end tasks
    if (analysis.endNodes.length === 0) {
      warnings.push('Pipeline has no explicit end tasks (all tasks have allowedNext)');
    }

    // Warn about max depth
    if (analysis.maxDepth > 20) {
      warnings.push(`Pipeline depth is ${analysis.maxDepth}, which may cause long execution times`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      entryTasks: analysis.entryNodes,
      endTasks: analysis.endNodes,
      graph: taskMap,
    };
  }

  /**
   * Analyze DAG structure
   */
  private analyzeDAG(graph: Map<string, TaskNode>): DAGAnalysis {
    const allTaskIds = Array.from(graph.keys());

    // Find entry nodes (no incoming edges)
    const hasIncoming = new Set<string>();
    for (const task of graph.values()) {
      for (const nextId of task.allowedNext) {
        hasIncoming.add(nextId);
      }
    }
    const entryNodes = allTaskIds.filter((id) => !hasIncoming.has(id));

    // Find end nodes (no outgoing edges)
    const endNodes = allTaskIds.filter((id) => {
      const task = graph.get(id);
      return task && task.allowedNext.length === 0;
    });

    // Detect cycles using DFS
    const { hasCycles, cycles } = this.detectCycles(graph);

    // Find disconnected subgraphs
    const disconnected = this.findDisconnectedSubgraphs(graph);

    // Calculate max depth
    const maxDepth = this.calculateMaxDepth(graph, entryNodes);

    return {
      entryNodes,
      endNodes,
      hasCycles,
      cycles,
      disconnected,
      maxDepth,
    };
  }

  /**
   * Detect cycles in the DAG using DFS
   */
  private detectCycles(graph: Map<string, TaskNode>): { hasCycles: boolean; cycles: string[][] } {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const cycles: string[][] = [];

    const dfs = (nodeId: string, path: string[]): boolean => {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        cycles.push([...path.slice(cycleStart), nodeId]);
        return true;
      }

      if (visited.has(nodeId)) {
        return false;
      }

      visited.add(nodeId);
      recursionStack.add(nodeId);

      const node = graph.get(nodeId);
      if (node) {
        for (const nextId of node.allowedNext) {
          if (graph.has(nextId)) {
            dfs(nextId, [...path, nodeId]);
          }
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        dfs(nodeId, []);
      }
    }

    return {
      hasCycles: cycles.length > 0,
      cycles,
    };
  }

  /**
   * Find disconnected subgraphs using BFS
   */
  private findDisconnectedSubgraphs(graph: Map<string, TaskNode>): string[][] {
    const visited = new Set<string>();
    const subgraphs: string[][] = [];

    // Build bidirectional adjacency (for undirected traversal)
    const adjacency = new Map<string, Set<string>>();
    for (const [taskId, task] of graph.entries()) {
      if (!adjacency.has(taskId)) {
        adjacency.set(taskId, new Set());
      }
      for (const nextId of task.allowedNext) {
        adjacency.get(taskId)!.add(nextId);
        if (!adjacency.has(nextId)) {
          adjacency.set(nextId, new Set());
        }
        adjacency.get(nextId)!.add(taskId);
      }
    }

    // BFS to find connected components
    const bfs = (startId: string): string[] => {
      const queue = [startId];
      const component: string[] = [];
      visited.add(startId);

      while (queue.length > 0) {
        const nodeId = queue.shift()!;
        component.push(nodeId);

        const neighbors = adjacency.get(nodeId);
        if (neighbors) {
          for (const neighbor of neighbors) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
      }

      return component;
    };

    for (const taskId of graph.keys()) {
      if (!visited.has(taskId)) {
        const component = bfs(taskId);
        subgraphs.push(component);
      }
    }

    return subgraphs;
  }

  /**
   * Calculate maximum depth from entry nodes
   */
  private calculateMaxDepth(graph: Map<string, TaskNode>, entryNodes: string[]): number {
    const depths = new Map<string, number>();
    const visited = new Set<string>();

    const dfs = (nodeId: string, depth: number): void => {
      if (visited.has(nodeId)) {
        // Update depth if we found a deeper path
        const currentDepth = depths.get(nodeId) ?? 0;
        if (depth > currentDepth) {
          depths.set(nodeId, depth);
        }
        return;
      }

      visited.add(nodeId);
      depths.set(nodeId, depth);

      const node = graph.get(nodeId);
      if (node) {
        for (const nextId of node.allowedNext) {
          if (graph.has(nextId)) {
            dfs(nextId, depth + 1);
          }
        }
      }
    };

    for (const entryId of entryNodes) {
      dfs(entryId, 0);
    }

    return Math.max(...Array.from(depths.values()), 0);
  }

  /**
   * Load task definitions from database
   */
  private async loadTasks(taskIds: string[]): Promise<TaskNode[]> {
    if (taskIds.length === 0) {
      return [];
    }

    const rows = await this.db.manyOrNone<{
      id: string;
      service_id: string;
      allowed_next: string[];
    }>(
      `SELECT id, service_id, allowed_next
       FROM tasks
       WHERE id = ANY($1)`,
      [taskIds]
    );

    return rows.map((row) => ({
      taskId: row.id,
      serviceId: row.service_id,
      allowedNext: row.allowed_next ?? [],
    }));
  }

  /**
   * Validate pipeline structure for creation/update
   */
  async validatePipelineDefinition(
    pipelineId: string,
    name: string,
    entryTaskIds: string[]
  ): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Basic validation
    if (!pipelineId || pipelineId.trim().length === 0) {
      errors.push('Pipeline ID is required');
    }

    if (!name || name.trim().length === 0) {
      errors.push('Pipeline name is required');
    }

    if (!entryTaskIds || entryTaskIds.length === 0) {
      errors.push('At least one entry task is required');
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
        warnings,
        entryTasks: [],
        endTasks: [],
        graph: new Map(),
      };
    }

    // Load entry tasks and build full graph by traversing allowedNext
    const allTaskIds = await this.discoverAllTasks(entryTaskIds);

    // Validate the discovered pipeline
    return await this.validatePipeline(allTaskIds);
  }

  /**
   * Discover all tasks reachable from entry tasks
   */
  private async discoverAllTasks(entryTaskIds: string[]): Promise<string[]> {
    const discovered = new Set<string>(entryTaskIds);
    const queue = [...entryTaskIds];

    while (queue.length > 0) {
      const taskId = queue.shift()!;
      const tasks = await this.loadTasks([taskId]);

      if (tasks.length === 0) {
        continue;
      }

      const task = tasks[0];
      if (task) {
        for (const nextId of task.allowedNext) {
          if (!discovered.has(nextId)) {
            discovered.add(nextId);
            queue.push(nextId);
          }
        }
      }
    }

    return Array.from(discovered);
  }
}
