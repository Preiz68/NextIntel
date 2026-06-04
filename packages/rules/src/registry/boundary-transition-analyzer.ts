import { BoundaryTransition, BoundaryType } from "../types.js";

export interface BoundaryTransitionViolation {
  file: string;
  line?: number;
  transition: BoundaryTransition;
  boundary: BoundaryType;
  description: string;
  source: string;
  target: string;
}

/**
 * Checks for illegal runtime boundary transitions within the module dependency graph
 * and symbol access execution paths.
 */
export function analyzeTransitions(
  analyses: any[],
  graph: any,
  nodes: Map<string, any>,
  resolvedOwnerships: Map<string, string>
): BoundaryTransitionViolation[] {
  const violations: BoundaryTransitionViolation[] = [];

  if (graph) {
    const edges = graph.edges() || [];
    for (const edge of edges) {
      const source = edge.v; // importer
      const target = edge.w; // importee

      const sourceOwn = resolvedOwnerships.get(source);
      const targetOwn = resolvedOwnerships.get(target);

      // Client Component statically importing Server Component (CLIENT_RENDER)
      if (
        (sourceOwn === "client-entry" || sourceOwn === "client-only") &&
        (targetOwn === "server-entry" || targetOwn === "server-only" || targetOwn === "action-runtime")
      ) {
        const targetNode = nodes.get(target);
        const isServerActionModule = targetNode?.semanticKind === "server-action";

        if (!isServerActionModule) {
          violations.push({
            file: source,
            transition: "client-to-server",
            boundary: "CLIENT_RENDER",
            description: `Client component statically imports Server component/module.`,
            source,
            target,
          });
        }
      }
    }
  }

  // Verify internal capability usage per file
  for (const a of analyses) {
    const own = resolvedOwnerships.get(a.filePath);

    // Server-only context using browser APIs
    if (
      own === "server-entry" ||
      own === "server-only" ||
      own === "action-runtime" ||
      own === "shared-isomorphic"
    ) {
      for (const b of a.browserAPIs || []) {
        if (b.isGuarded) continue;
        violations.push({
          file: a.filePath,
          line: b.line,
          transition: "server-to-browser-api",
          boundary: "RSC_RENDER",
          description: `Server-evaluated context references browser global '${b.api}'.`,
          source: a.filePath,
          target: b.api,
        });
      }
    }
  }

  return violations;
}
