import type { SemanticKind, RuntimeContext, RenderingSemantics } from "../classifier/types.js";

export interface GraphNode {
  id: string;
  filePath: string;
  isClientComponent: boolean;
  isServerComponent: boolean;
  hasDefaultExport: boolean;
  
  // Semantic framework properties
  semanticKind: SemanticKind;
  runtime: RuntimeContext;
  renderingMode: RenderingSemantics["mode"];
  isHydrationBoundary: boolean;
  
  // Note: we preserve 'kind' for backwards compatibility, but map it from semanticKind where possible
  kind: "page" | "component" | "hook" | "util" | "action" | "unknown";
}

export interface GraphEdge {
  from: string;
  to: string;
  importedNames: string[];
  isTypeOnly: boolean;
}

export interface CycleReport {
  hasCycles: boolean;
  cycles: string[][];
}

export interface PathResult {
  found: boolean;
  path: string[];
}

export interface GraphSummary {
  totalNodes: number;
  totalEdges: number;
  entryPoints: string[];
  sinks: string[];
  cycles: CycleReport;
  mostImported: { id: string; count: number }[];
  clientNodes: string[];
  serverNodes: string[];
}

export interface TraversalOptions {
  maxDepth?: number;
  direction?: "inbound" | "outbound";
}
