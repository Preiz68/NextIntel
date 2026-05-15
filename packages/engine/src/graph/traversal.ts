import { Graph } from "graphlib";
import type {
  GraphNode,
  GraphSummary,
  PathResult,
  TraversalOptions,
} from "./types.js";
import { detectCycles } from "./detectCycles.js";

// ─── Core traversal ───────────────────────────────────────────────────────────

/**
 * BFS from `startId` following outbound edges (A imports B).
 * Returns nodes in visit order.
 */
export function bfs(
  graph: Graph,
  startId: string,
  options: TraversalOptions = {},
): string[] {
  const { maxDepth = 0, direction = "outbound" } = options;
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: startId, depth: 0 },
  ];
  const result: string[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);

    if (maxDepth > 0 && depth >= maxDepth) continue;

    const neighbors =
      direction === "outbound"
        ? (graph.successors(id) ?? [])
        : (graph.predecessors(id) ?? []);

    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }

  return result;
}

/**
 * DFS from `startId`. Returns nodes in visit order.
 */
export function dfs(
  graph: Graph,
  startId: string,
  options: TraversalOptions = {},
): string[] {
  const { maxDepth = 0, direction = "outbound" } = options;
  const visited = new Set<string>();
  const result: string[] = [];

  function visit(id: string, depth: number): void {
    if (visited.has(id)) return;
    visited.add(id);
    result.push(id);

    if (maxDepth > 0 && depth >= maxDepth) return;

    const neighbors =
      direction === "outbound"
        ? (graph.successors(id) ?? [])
        : (graph.predecessors(id) ?? []);

    for (const neighbor of neighbors) visit(neighbor, depth + 1);
  }

  visit(startId, 0);
  return result;
}

// ─── Path finding ─────────────────────────────────────────────────────────────

/**
 * Find the shortest path between two nodes using BFS.
 */
export function findPath(
  graph: Graph,
  fromId: string,
  toId: string,
): PathResult {
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) {
    return { found: false, path: [] };
  }

  const visited = new Set<string>();
  const parentMap = new Map<string, string | null>();
  const queue: string[] = [fromId];

  parentMap.set(fromId, null);

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === toId) {
      const path: string[] = [];
      let node: string | null = toId;
      while (node !== null) {
        path.unshift(node);
        node = parentMap.get(node) ?? null;
      }
      return { found: true, path };
    }

    if (visited.has(current)) continue;
    visited.add(current);

    for (const neighbor of graph.successors(current) ?? []) {
      if (!visited.has(neighbor)) {
        parentMap.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }

  return { found: false, path: [] };
}

// ─── Dependency queries ───────────────────────────────────────────────────────

/**
 * All files that `fileId` directly or transitively imports.
 */
export function getDependencies(
  graph: Graph,
  fileId: string,
  options?: TraversalOptions,
): string[] {
  return bfs(graph, fileId, { ...options, direction: "outbound" }).slice(1);
}

/**
 * All files that directly or transitively import `fileId`.
 */
export function getDependents(
  graph: Graph,
  fileId: string,
  options?: TraversalOptions,
): string[] {
  return bfs(graph, fileId, { ...options, direction: "inbound" }).slice(1);
}

/**
 * Files with no outbound edges (nothing imported from them that's in the graph).
 */
export function getSinks(graph: Graph): string[] {
  return graph.nodes().filter((n) => (graph.successors(n) ?? []).length === 0);
}

/**
 * Files with no inbound edges — nothing imports them.
 */
export function getEntryPoints(graph: Graph): string[] {
  return graph
    .nodes()
    .filter((n) => (graph.predecessors(n) ?? []).length === 0);
}

/**
 * Return nodes ranked by how many other files import them (inbound degree).
 */
export function getMostImported(
  graph: Graph,
  topN = 10,
): { id: string; count: number }[] {
  return graph
    .nodes()
    .map((id) => ({ id, count: (graph.predecessors(id) ?? []).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

export function summarizeGraph(
  graph: Graph,
  nodes: Map<string, GraphNode>,
): GraphSummary {
  const cycles = detectCycles(graph);

  const clientNodes: string[] = [];
  const serverNodes: string[] = [];

  for (const [id, node] of nodes.entries()) {
    if (node.isClientComponent) clientNodes.push(id);
    if (node.isServerComponent) serverNodes.push(id);
  }

  return {
    totalNodes: graph.nodeCount(),
    totalEdges: graph.edgeCount(),
    entryPoints: getEntryPoints(graph),
    sinks: getSinks(graph),
    cycles,
    mostImported: getMostImported(graph),
    clientNodes,
    serverNodes,
  };
}

// ─── ASCII visualiser ─────────────────────────────────────────────────────────

/**
 * Print an ASCII dependency tree rooted at `startId`.
 *
 * A node is only flagged (↩ circular) if it appears in the *current DFS path*,
 * not merely if it has been visited anywhere in the tree. This matches the
 * actual definition of a back-edge / cycle.
 *
 * Nodes visited via a different branch are printed normally (they are shared
 * dependencies, not cycles) but are not expanded a second time to avoid
 * infinite recursion and keep the output readable.
 */
export function toAsciiTree(
  graph: Graph,
  startId: string,
  nodes: Map<string, GraphNode>,
  options: TraversalOptions & { labels?: "full" | "basename" } = {},
): string {
  const { maxDepth = 0, labels = "basename" } = options;
  const lines: string[] = [];

  // globally-seen prevents re-expanding a shared dependency in a second branch,
  // keeping output finite without false circular labels.
  const globalSeen = new Set<string>();
  // currentPath tracks the live DFS stack — only these trigger (↩ circular).
  const currentPath = new Set<string>();

  function label(id: string): string {
    if (labels === "full") return id;
    return id.split("/").pop() ?? id;
  }

  function walk(id: string, depth: number, prefix: string): void {
    const node = nodes.get(id);
    const tag = node?.isClientComponent
      ? " [client]"
      : node?.isServerComponent
        ? " [server]"
        : "";

    // Back-edge: this node is on the current DFS path → real cycle.
    if (currentPath.has(id)) {
      lines.push(`${prefix}${label(id)}${tag} (↩ circular)`);
      return;
    }

    lines.push(`${prefix}${label(id)}${tag}`);

    // Already fully expanded in another branch — don't re-expand.
    if (globalSeen.has(id)) return;
    globalSeen.add(id);

    if (maxDepth > 0 && depth >= maxDepth) return;

    currentPath.add(id);

    const successors = graph.successors(id) ?? [];
    for (const successor of successors) {
      lines.push(`${prefix}↓`);
      walk(successor, depth + 1, prefix + "   ");
    }

    currentPath.delete(id);
  }

  walk(startId, 0, "");
  return lines.join("\n");
}
