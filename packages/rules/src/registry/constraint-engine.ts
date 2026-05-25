import { ExecutionOwnership } from "../types.js";

export interface ConstraintViolation {
  id: string; // e.g. "SC-BROWSER-API-001"
  ruleId: string; // e.g. "no-browser-api-in-server-components"
  file: string;
  line?: number;
  message: string;
  affects: string[];
}

export interface Constraint {
  id: string;
  description: string;
  validate(
    analyses: any[],
    graph: any,
    nodes: Map<string, any>,
    resolvedOwnerships: Map<string, ExecutionOwnership>
  ): ConstraintViolation[];
}

export class ConstraintEngine {
  private constraints: Constraint[] = [];

  registerConstraint(constraint: Constraint) {
    this.constraints.push(constraint);
  }

  validateAll(
    analyses: any[],
    graph: any,
    nodes: Map<string, any>,
    resolvedOwnerships: Map<string, ExecutionOwnership>
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];
    for (const constraint of this.constraints) {
      try {
        violations.push(...constraint.validate(analyses, graph, nodes, resolvedOwnerships));
      } catch (err: any) {
        console.error(`[ConstraintEngine] Error in constraint ${constraint.id}:`, err.message);
      }
    }
    return violations;
  }
}

// ─── Default Invariants ───────────────────────────────────────────────────────

export const ServerComponentBrowserAPIConstraint: Constraint = {
  id: "SC-BROWSER-API-001",
  description: "Server Components and Server modules may not evaluate Browser-only APIs.",
  validate(analyses, graph, nodes, resolvedOwnerships) {
    const violations: ConstraintViolation[] = [];
    for (const a of analyses) {
      if (a.runtimeType === "SERVER_COMPONENT") {
        for (const b of a.browserAPIs || []) {
          violations.push({
            id: "SC-BROWSER-API-001",
            ruleId: "no-browser-api-in-server-components",
            file: a.filePath,
            line: b.line,
            message: `Browser API '${b.api}' is used in a Server Component context.`,
            affects: [b.api],
          });
        }
      }
    }
    return violations;
  },
};

export const ClientComponentServerImportConstraint: Constraint = {
  id: "CC-SERVER-IMPORT-001",
  description: "Client Components may not statically import Server Component modules.",
  validate(analyses, graph, nodes, resolvedOwnerships) {
    const violations: ConstraintViolation[] = [];
    if (graph) {
      const edges = graph.edges() || [];
      for (const edge of edges) {
        const source = edge.v;
        const target = edge.w;

        const sourceOwn = resolvedOwnerships.get(source);
        const targetOwn = resolvedOwnerships.get(target);

        if (
          (sourceOwn === "client-entry" || sourceOwn === "client-only") &&
          (targetOwn === "server-entry" || targetOwn === "server-only")
        ) {
          violations.push({
            id: "CC-SERVER-IMPORT-001",
            ruleId: "no-client-import-server-only",
            file: source,
            line: 1,
            message: `Client Component imports Server Component '${target}'`,
            affects: [target],
          });
        }
      }
    }
    return violations;
  },
};
