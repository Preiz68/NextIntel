export { buildGraph } from "./buildGraph.js";
export type { BuildGraphResult } from "./buildGraph.js";

export { detectCycles, getCyclicNodes } from "./detectCycles.js";

export {
  bfs,
  dfs,
  findPath,
  getDependencies,
  getDependents,
  getSinks,
  getEntryPoints,
  getMostImported,
  summarizeGraph,
  toAsciiTree,
} from "./traversal.js";

export type {
  GraphNode,
  GraphEdge,
  CycleReport,
  PathResult,
  GraphSummary,
  TraversalOptions,
} from "./types.js";
