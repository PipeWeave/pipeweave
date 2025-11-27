import type { TaskNode } from './validator.js';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionLevel {
  level: number;
  tasks: string[];
  type: 'entry' | 'parallel' | 'join' | 'end';
  waitsFor?: string[]; // For join tasks - which tasks must complete first
}

export interface ExecutionPlan {
  levels: ExecutionLevel[];
  totalTasks: number;
  maxParallelism: number;
  estimatedSteps: number;
}

export interface DependencyInfo {
  taskId: string;
  predecessors: string[];
  successors: string[];
  level: number;
}

// ============================================================================
// Pipeline Graph Analyzer
// ============================================================================

export class PipelineGraph {
  private graph: Map<string, TaskNode>;
  private reverseGraph: Map<string, Set<string>>; // task -> predecessors

  constructor(graph: Map<string, TaskNode>) {
    this.graph = graph;
    this.reverseGraph = this.buildReverseGraph();
  }

  /**
   * Build reverse graph (successor -> predecessors)
   */
  private buildReverseGraph(): Map<string, Set<string>> {
    const reverse = new Map<string, Set<string>>();

    // Initialize with empty sets
    for (const taskId of this.graph.keys()) {
      if (!reverse.has(taskId)) {
        reverse.set(taskId, new Set());
      }
    }

    // Build reverse edges
    for (const [taskId, task] of this.graph.entries()) {
      for (const nextId of task.allowedNext) {
        if (!reverse.has(nextId)) {
          reverse.set(nextId, new Set());
        }
        reverse.get(nextId)!.add(taskId);
      }
    }

    return reverse;
  }

  /**
   * Perform topological sort and generate execution plan
   */
  topologicalSort(entryTasks: string[]): ExecutionPlan {
    const levels: ExecutionLevel[] = [];
    const inDegree = new Map<string, number>();
    const taskLevels = new Map<string, number>();

    // Calculate in-degrees
    for (const taskId of this.graph.keys()) {
      const predecessors = this.reverseGraph.get(taskId) ?? new Set();
      inDegree.set(taskId, predecessors.size);
    }

    // BFS level-order traversal
    let currentLevel = 0;
    let queue = entryTasks.filter((id) => this.graph.has(id));
    const processed = new Set<string>();

    while (queue.length > 0) {
      const levelTasks: string[] = [];
      const nextQueue: string[] = [];

      for (const taskId of queue) {
        if (processed.has(taskId)) {
          continue;
        }

        processed.add(taskId);
        levelTasks.push(taskId);
        taskLevels.set(taskId, currentLevel);

        // Reduce in-degree for successors
        const task = this.graph.get(taskId);
        if (task) {
          for (const nextId of task.allowedNext) {
            const degree = inDegree.get(nextId) ?? 0;
            const newDegree = degree - 1;
            inDegree.set(nextId, newDegree);

            // If all predecessors processed, add to next level
            if (newDegree === 0 && !processed.has(nextId)) {
              nextQueue.push(nextId);
            }
          }
        }
      }

      if (levelTasks.length > 0) {
        // Determine level type
        let type: 'entry' | 'parallel' | 'join' | 'end' = 'parallel';
        if (currentLevel === 0) {
          type = 'entry';
        } else {
          // Check if any task is a join (multiple predecessors)
          const hasJoin = levelTasks.some((taskId) => {
            const predecessors = this.reverseGraph.get(taskId) ?? new Set();
            return predecessors.size > 1;
          });

          if (hasJoin) {
            type = 'join';
          }

          // Check if any task is an end task
          const hasEnd = levelTasks.some((taskId) => {
            const task = this.graph.get(taskId);
            return task && task.allowedNext.length === 0;
          });

          if (hasEnd && nextQueue.length === 0) {
            type = 'end';
          }
        }

        // For join tasks, identify what they wait for
        const waitsFor: string[] = [];
        if (type === 'join') {
          for (const taskId of levelTasks) {
            const predecessors = this.reverseGraph.get(taskId) ?? new Set();
            if (predecessors.size > 1) {
              waitsFor.push(...Array.from(predecessors));
            }
          }
        }

        levels.push({
          level: currentLevel,
          tasks: levelTasks,
          type,
          waitsFor: waitsFor.length > 0 ? Array.from(new Set(waitsFor)) : undefined,
        });
      }

      queue = nextQueue;
      currentLevel++;
    }

    // Calculate max parallelism
    const maxParallelism = Math.max(...levels.map((l) => l.tasks.length), 0);

    return {
      levels,
      totalTasks: processed.size,
      maxParallelism,
      estimatedSteps: levels.length,
    };
  }

  /**
   * Get dependency information for a task
   */
  getDependencies(taskId: string): DependencyInfo | null {
    if (!this.graph.has(taskId)) {
      return null;
    }

    const task = this.graph.get(taskId)!;
    const predecessors = Array.from(this.reverseGraph.get(taskId) ?? new Set<string>());
    const successors = task.allowedNext;

    // Calculate level (max level of predecessors + 1)
    let level = 0;
    if (predecessors.length > 0) {
      // BFS to find level
      const visited = new Set<string>();
      const queue: Array<{ id: string; depth: number }> = predecessors.map((id: string) => ({ id, depth: 1 }));

      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);

        level = Math.max(level, depth);

        const preds = this.reverseGraph.get(id) ?? new Set();
        for (const predId of preds) {
          queue.push({ id: predId as string, depth: depth + 1 });
        }
      }
    }

    return {
      taskId,
      predecessors,
      successors,
      level,
    };
  }

  /**
   * Check if a task is ready to run (all predecessors completed)
   */
  isReadyToRun(taskId: string, completedTasks: Set<string>): boolean {
    const predecessors = this.reverseGraph.get(taskId) ?? new Set();

    // If no predecessors, it's ready
    if (predecessors.size === 0) {
      return true;
    }

    // Check if all predecessors are completed
    for (const predId of predecessors) {
      if (!completedTasks.has(predId)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get next tasks that can run based on completed tasks
   */
  getNextRunnableTasks(completedTasks: Set<string>): string[] {
    const runnable: string[] = [];

    for (const taskId of this.graph.keys()) {
      if (completedTasks.has(taskId)) {
        continue; // Already completed
      }

      if (this.isReadyToRun(taskId, completedTasks)) {
        runnable.push(taskId);
      }
    }

    return runnable;
  }

  /**
   * Get all tasks that depend on a given task (transitive closure)
   */
  getDownstreamTasks(taskId: string): string[] {
    const downstream = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [taskId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const task = this.graph.get(currentId);
      if (task) {
        for (const nextId of task.allowedNext) {
          downstream.add(nextId);
          queue.push(nextId);
        }
      }
    }

    return Array.from(downstream);
  }

  /**
   * Get all tasks that a given task depends on (transitive closure)
   */
  getUpstreamTasks(taskId: string): string[] {
    const upstream = new Set<string>();
    const visited = new Set<string>();
    const queue: string[] = [taskId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) {
        continue;
      }
      visited.add(currentId);

      const predecessors = this.reverseGraph.get(currentId);
      if (predecessors) {
        for (const predId of predecessors) {
          upstream.add(predId as string);
          queue.push(predId as string);
        }
      }
    }

    return Array.from(upstream);
  }

  /**
   * Find join tasks (tasks with multiple predecessors)
   */
  findJoinTasks(): string[] {
    const joinTasks: string[] = [];

    for (const [taskId, predecessors] of this.reverseGraph.entries()) {
      if (predecessors.size > 1) {
        joinTasks.push(taskId);
      }
    }

    return joinTasks;
  }

  /**
   * Get task graph as adjacency list
   */
  getAdjacencyList(): Map<string, string[]> {
    const adj = new Map<string, string[]>();

    for (const [taskId, task] of this.graph.entries()) {
      adj.set(taskId, task.allowedNext);
    }

    return adj;
  }

  /**
   * Get reverse adjacency list (predecessors)
   */
  getReverseAdjacencyList(): Map<string, string[]> {
    const adj = new Map<string, string[]>();

    for (const [taskId, predecessors] of this.reverseGraph.entries()) {
      adj.set(taskId, Array.from(predecessors));
    }

    return adj;
  }
}
