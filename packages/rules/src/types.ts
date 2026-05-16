import type { FileAnalysis, GraphNode } from "../../engine/src/index.js";
import type { Graph } from "graphlib";

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  file: string;
  line?: number;
  severity: Severity;
  ruleId: string;
  message: string;
  fix?: string;
}

export interface RuleContext {
  analyses: FileAnalysis[];
  graph: Graph;
  nodes: Map<string, GraphNode>;
  edges: any[]; // Using any for now to avoid complex import mapping, but should be GraphEdge[]
}

export interface Rule {
  id: string;
  meta: {
    description: string;
    severity: Severity;
  };
  run(context: RuleContext): Diagnostic[];
}
