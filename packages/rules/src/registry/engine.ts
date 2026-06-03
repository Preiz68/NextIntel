/**
 * engine.ts
 *
 * NextIntel Rule Engine
 */

import { Rule, RuleContext, Diagnostic, ExecutionOwnership, RuntimeEnvironment } from "../types.js";
import { KnowledgeRegistry } from "../knowledge/registry.js";
import { getRuleSpec } from "./rule-registry.js";
import { deduplicateDiagnostics as runDeduplication } from "./diagnostic-deduper.js";
import { TaintEngine, ExecutionSimulator } from "engine";
import path from "node:path";
import { buildSemanticIR } from "./semantic-ir.js";
import { calculateSeverityScore, toDiagnosticSeverity, applyContextualScoreOverride, toSeverityLevel } from "./scoring.js";
import { resolveBoundary } from "./boundary-resolver.js";

// Export new modules so consumers can use them
export { buildSemanticIR } from "./semantic-ir.js";
export { RULE_REGISTRY, getRuleSpec, requireRuleSpec } from "./rule-registry.js";
export { calculateSeverityScore, toSeverityLevel, toDiagnosticSeverity, applyContextualScoreOverride } from "./scoring.js";
export { resolveBoundary, phaseMetadata } from "./boundary-resolver.js";
export { renderGroupedDiagnostics } from "./formatter.js";
export type { FileMeta, NodeContext, BoundaryResolution } from "./boundary-resolver.js";
export type { ScoringResult } from "./scoring.js";

// Global cache for current run, used by formatter and root cause analyses
let lastGraphNodes: Map<string, any> | null = null;
let lastGraph: any = null;
let lastAnalyses: any[] | null = null;

export function getLastGraph() {
  return lastGraph;
}

export function getLastGraphNodes() {
  return lastGraphNodes;
}

export function getLastAnalyses() {
  return lastAnalyses;
}

export const resolvedOwnerships = new Map<string, ExecutionOwnership>();
export const resolvedRuntimes = new Map<string, RuntimeEnvironment>();

export class RuleEngine {
  private rules: Rule[] = [];
  private readonly knowledgeRegistry: KnowledgeRegistry = new KnowledgeRegistry();

  registerRule(rule: Rule) {
    this.rules.push(rule);
  }

  run(context: Omit<RuleContext, "knowledgeRegistry">): Diagnostic[] {
    lastGraphNodes = context.nodes;
    lastGraph = context.graph;
    lastAnalyses = context.analyses;

    // Propagate execution environments in the dependency graph
    propagateRuntimeContexts(context.graph, context.nodes, context.analyses);

    // Propagate taints using the TaintEngine
    const directTaintsMap = new Map<string, any>();
    for (const a of context.analyses) {
      directTaintsMap.set(a.filePath, a.taints || []);
    }
    const taintEngine = new TaintEngine(
      context.analyses.map((a) => a.filePath),
      context.graph,
      context.nodes,
      directTaintsMap,
      context.analyses
    );
    const propagatedTaints = taintEngine.propagate();
    for (const a of context.analyses) {
      const summary = propagatedTaints.get(a.filePath);
      if (summary) {
        a.taintState = summary.overallState;
        a.taints = summary.taints;
      }
    }

    // Run Execution Simulator
    const simulator = new ExecutionSimulator();
    const simResults = simulator.simulate(context.analyses);
    for (const a of context.analyses) {
      const res = simResults.get(a.filePath);
      if (res) {
        a.simulationFindings = [
          ...(a.simulationFindings || []),
          ...res.findings
        ];
      }
    }

    const semanticIR = buildSemanticIR(context.graph, context.nodes, context.analyses);
    const fullContext: RuleContext = { ...context, knowledgeRegistry: this.knowledgeRegistry, semanticIR };
    const allDiagnostics: Diagnostic[] = [];

    for (const rule of this.rules) {
      try {
        const diagnostics = rule.run(fullContext);
        allDiagnostics.push(...diagnostics);
      } catch (err: any) {
        console.error(`[RuleEngine] Error running rule ${rule.id}:`, err.message);
      }
    }

    // Deduplicate and collapse propagated diagnostics
    const collapsed = runDeduplication(allDiagnostics, (d) => resolveRootCause(d.file, d.id || d.ruleId, context.graph, context.nodes, d));

    // Normalize and dynamically set diagnostic severity using severity gating scores
    for (const d of collapsed) {
      const node = context.nodes.get(d.file);
      const kind = node?.semanticKind ?? "unknown";

      const fileMeta = {
        kind,
        isClientComponent: node?.isClientComponent === true || kind === "client-component" || kind === "client-util",
        isServerComponent: node?.isServerComponent === true || kind === "server-component" || kind === "server-util",
        isServerAction: kind === "server-action" || d.file.toLowerCase().includes("action"),
        filePath: d.file,
      };

      const affects = d.message ? extractAffects(d.message) : [];
      const nodeCtx = {
        isHydrationSensitive: d.id === "HY-RENDER-BROWSER-API-001" || affects.some(a => ["localstorage", "sessionstorage", "window", "navigator", "document"].includes(a.toLowerCase())),
        isClientToServerImport: d.id === "CC-SERVER-IMPORT-001" || d.id === "CC-RUNTIME-LEAK-001",
      };

      const resolved = resolveBoundary(fileMeta, nodeCtx);
      const spec = getRuleSpec(d.id || d.ruleId);
      const confidence = spec?.confidence ?? 1.0;

      const depPath = buildDependencyPath(d.file, d.id || d.ruleId, affects);
      const propagationDepth = depPath.split("\n").filter(line => line.includes("→ imports") || line.includes("→ exports")).length + 1;

      let scoreLookupId = d.id || d.ruleId;
      if (scoreLookupId === "DF-005" && (d as any).waterfallTier) {
        scoreLookupId = `DF-005-${(d as any).waterfallTier}`;
      } else if (scoreLookupId === "DYNAMIC_RENDER_TRIGGER-004" && (d as any).analyticsExclusion) {
        scoreLookupId = "DYNAMIC_RENDER_TRIGGER-004-ANALYTICS";
      }

      const scoring = calculateSeverityScore(scoreLookupId, resolved.phase, confidence, propagationDepth, d.isGuarded);
      
      // Apply context-aware overrides for rules whose severity scales with runtime metadata
      let finalScore = scoring.score;
      const constraintId = d.id || d.ruleId;

      if (constraintId === "RO-005") {
        // RO-005: info/warning/high depends on fetch count and waterfall pattern
        finalScore = applyContextualScoreOverride(constraintId, finalScore, {
          fetchCount: d.fetchCount,
          isWaterfall: d.isWaterfall,
        });
      } else if (constraintId === "RO-006") {
        // RO-006: auth/session/tenant layout awaits are downgraded to info
        finalScore = applyContextualScoreOverride(constraintId, finalScore, {
          isCriticalLayoutPath: (d as any).isCriticalLayoutPath,
        });
      } else if (constraintId === "DYNAMIC_LAYOUT_IMPACT") {
        // DYNAMIC_LAYOUT_IMPACT: severity scales with layout depth
        // Root layout (depth 0) = affects whole app; nested = only affects subtree
        const normFile = d.file.replace(/\\/g, "/");
        const appIdx = normFile.indexOf("/app/");
        let layoutDepth = 0;
        if (appIdx !== -1) {
          const relPath = normFile.substring(appIdx + 5);
          const segments = relPath.split("/").filter(s => s.length > 0);
          // Count meaningful path segments before the layout file (exclude route groups)
          layoutDepth = segments.slice(0, -1).filter(
            s => !s.startsWith("(") && !s.startsWith("@")
          ).length;
        }
        finalScore = applyContextualScoreOverride(constraintId, finalScore, { layoutDepth });
      }

      // Override default static severity with the calculated hard-gated diagnostic severity
      d.severity = toDiagnosticSeverity(toSeverityLevel(finalScore));
    }

    return collapsed;
  }
}

/**
 * Propagate execution contexts across the module graph.
 */
export function propagateRuntimeContexts(
  graph: any,
  nodes: Map<string, any>,
  analyses: any[]
) {
  resolvedOwnerships.clear();
  resolvedRuntimes.clear();

  // Synchronize node.semanticKind with statically analyzed semanticKind if node has generic "util"
  for (const a of analyses) {
    const node = nodes.get(a.filePath);
    if (node && node.semanticKind === "util" && a.semanticKind && a.semanticKind !== "util") {
      node.semanticKind = a.semanticKind;
    }
  }

  // 1. Initialize explicit ownerships based on direct files
  for (const nodePath of nodes.keys()) {
    const node = nodes.get(nodePath);
    const kind = node?.semanticKind ?? "unknown";
    const analysis = analyses.find((a) => a.filePath === nodePath);

    let ownership: ExecutionOwnership = "server-only";
    let runtime: RuntimeEnvironment = "node";

    if (node?.isClientComponent || kind === "client-component") {
      ownership = "client-entry";
      runtime = "browser";
    } else if (kind === "server-action" || nodePath.toLowerCase().includes("action")) {
      ownership = "action-runtime";
      runtime = "node";
    } else if (kind === "page" || kind === "layout" || node?.isServerComponent || kind === "server-component") {
      ownership = "server-entry";
      runtime = analysis?.isEdgeRuntime ? "edge" : "node";
    }

    if (analysis?.isEdgeRuntime) {
      ownership = "edge-runtime";
      runtime = "edge";
    }

    resolvedOwnerships.set(nodePath, ownership);
    resolvedRuntimes.set(nodePath, runtime);
  }

  // 2. BFS from client entries to find client subgraphs
  const visitedFromClient = new Set<string>();
  const qClient: string[] = [];
  for (const [nodePath, own] of resolvedOwnerships.entries()) {
    if (own === "client-entry") {
      qClient.push(nodePath);
      visitedFromClient.add(nodePath);
    }
  }

  while (qClient.length > 0) {
    const curr = qClient.shift()!;
    const successors = graph?.successors(curr) || [];
    for (const succ of successors) {
      if (!visitedFromClient.has(succ)) {
        const succNode = nodes.get(succ);
        const succAnalysis = analyses.find((a: any) => a.filePath === succ);

        const isStaticallyServer =
          !!(succNode?.isServerComponent ||
          succNode?.semanticKind === "server-component" ||
          succNode?.semanticKind === "server-util" ||
          succNode?.semanticKind === "server-action" ||
          succNode?.isServerAction ||
          (succAnalysis?.executionModel?.usesServerApis && succAnalysis.executionModel.usesServerApis.length > 0) ||
          (succAnalysis?.imports && succAnalysis.imports.some((imp: string) => imp === "server-only" || imp.includes("server-only"))));

        if (isStaticallyServer) {
          continue; // Block client propagation
        }

        visitedFromClient.add(succ);
        qClient.push(succ);
      }
    }
  }

  // 3. BFS from server entries, blocking when crossing into client-entry components
  const visitedFromServer = new Set<string>();
  const qServer: string[] = [];
  for (const [nodePath, own] of resolvedOwnerships.entries()) {
    if (own === "server-entry" || own === "action-runtime") {
      qServer.push(nodePath);
      visitedFromServer.add(nodePath);
    }
  }

  while (qServer.length > 0) {
    const curr = qServer.shift()!;
    const successors = graph?.successors(curr) || [];
    for (const succ of successors) {
      const succOwn = resolvedOwnerships.get(succ);
      if (succOwn === "client-entry") {
        continue; // boundary crossed, don't traverse further in server BFS
      }
      if (!visitedFromServer.has(succ)) {
        visitedFromServer.add(succ);
        qServer.push(succ);
      }
    }
  }

  // 3b. BFS from edge entries
  const visitedFromEdge = new Set<string>();
  const qEdge: string[] = [];
  for (const nodePath of nodes.keys()) {
    const analysis = analyses.find((a) => a.filePath === nodePath);
    if (analysis?.isEdgeRuntime || resolvedOwnerships.get(nodePath) === "edge-runtime") {
      qEdge.push(nodePath);
      visitedFromEdge.add(nodePath);
    }
  }

  while (qEdge.length > 0) {
    const curr = qEdge.shift()!;
    const successors = graph?.successors(curr) || [];
    for (const succ of successors) {
      const succOwn = resolvedOwnerships.get(succ);
      if (succOwn === "client-entry") {
        continue;
      }
      if (!visitedFromEdge.has(succ)) {
        visitedFromEdge.add(succ);
        qEdge.push(succ);
      }
    }
  }

  // 4. Reconcile utility modules and mark them with propagated runtimes
  for (const nodePath of nodes.keys()) {
    const originalOwn = resolvedOwnerships.get(nodePath);
    if (originalOwn !== "client-entry" && originalOwn !== "server-entry" && originalOwn !== "action-runtime" && originalOwn !== "edge-runtime") {
      const c = visitedFromClient.has(nodePath);
      const s = visitedFromServer.has(nodePath);
      const e = visitedFromEdge.has(nodePath);

      if (c && !s) {
        resolvedOwnerships.set(nodePath, "client-only");
        resolvedRuntimes.set(nodePath, "browser");
      } else if (s && !c) {
        resolvedOwnerships.set(nodePath, "server-only");
        resolvedRuntimes.set(nodePath, e ? "edge" : "node");
      } else if (c && s) {
        resolvedOwnerships.set(nodePath, "shared-isomorphic");
        resolvedRuntimes.set(nodePath, "shared");
      } else {
        resolvedOwnerships.set(nodePath, "server-only");
        resolvedRuntimes.set(nodePath, e ? "edge" : "node");
      }
    } else if (originalOwn === "edge-runtime") {
      resolvedRuntimes.set(nodePath, "edge");
    }
  }

  // Reflow resolved contexts back into the analyses' execution models
  for (const nodePath of nodes.keys()) {
    const node = nodes.get(nodePath);
    const isOriginalUtil = node && (
      node.semanticKind === "util" ||
      node.semanticKind === "client-util" ||
      node.semanticKind === "server-util" ||
      node.semanticKind === "shared-util" ||
      node.semanticKind === "mixed-runtime-util"
    );

    if (isOriginalUtil) {
      if (node.semanticKind === "client-util" || node.semanticKind === "server-util") {
        continue;
      }

      const own = resolvedOwnerships.get(nodePath);
      let newKind: "client-util" | "server-util" | "shared-util" | "mixed-runtime-util" = "server-util";

      if (own === "client-only" || own === "client-entry") {
        newKind = "client-util";
      } else if (own === "server-only" || own === "server-entry" || own === "action-runtime" || own === "edge-runtime") {
        newKind = "server-util";
      } else if (own === "shared-isomorphic") {
        const a = analyses.find((x: any) => x.filePath === nodePath);
        const usesBrowser = a?.executionModel?.usesBrowserApis && a.executionModel.usesBrowserApis.length > 0;
        const usesServer = a?.executionModel?.usesServerApis && a.executionModel.usesServerApis.length > 0;

        if (usesBrowser || usesServer) {
          newKind = "mixed-runtime-util";
        } else {
          newKind = "shared-util";
        }
      }

      node.semanticKind = newKind;
    }
  }

  for (const a of analyses) {
    const own = resolvedOwnerships.get(a.filePath);
    if (own === "client-only" || own === "client-entry") {
      a.executionModel.componentType = "client";
    } else if (own === "server-only" || own === "server-entry" || own === "edge-runtime") {
      a.executionModel.componentType = "server";
    } else if (own === "shared-isomorphic") {
      a.executionModel.componentType = "mixed";
    }

    const rt = resolvedRuntimes.get(a.filePath);
    if (rt) {
      a.runtime = rt === "browser" ? "client" : rt === "shared" ? "server" : rt as any;
      a.executionModel.runtime = rt as any;
    }

    const node = nodes.get(a.filePath);
    if (node) {
      a.semanticKind = node.semanticKind;
    }
  }
}

/**
 * Trace a violation back to the originating dependency module.
 */
export function resolveRootCause(
  filePath: string,
  ruleId: string,
  graph: any,
  nodes: Map<string, any>,
  diagnostic?: any
): string {
  if (ruleId === "CC-SERVER-IMPORT-001" || ruleId === "CC-RUNTIME-LEAK-001") {
    return filePath;
  }
  if (diagnostic?.originFile) {
    return diagnostic.originFile;
  }
  if (!graph || !nodes) return filePath;

  if (ruleId === "CC-SERVER-IMPORT-001") {
    const visited = new Set<string>([filePath]);
    const queue = [filePath];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const successors = graph.successors(curr) || [];
      for (const succ of successors) {
        const succNode = nodes.get(succ);
        const isServerAction =
          succNode?.semanticKind === "server-action" ||
          succNode?.isServerAction ||
          succ.toLowerCase().includes("action");
        if (isServerAction) continue;

        if (succNode?.isServerComponent || succNode?.semanticKind === "server-component") {
          return succ;
        }
        if (!visited.has(succ)) {
          visited.add(succ);
          queue.push(succ);
        }
      }
    }
  }

  if (ruleId === "CC-RUNTIME-LEAK-001") {
    const visited = new Set<string>([filePath]);
    const queue = [filePath];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const successors = graph.successors(curr) || [];
      for (const succ of successors) {
        const succNode = nodes.get(succ);
        const isServerAction =
          succNode?.semanticKind === "server-action" ||
          succNode?.isServerAction ||
          succ.toLowerCase().includes("action");
        if (isServerAction) continue;

        const succAnalysis = lastAnalyses?.find((a: any) => a.filePath === succ);
        const hasServerApi =
          (succAnalysis?.executionModel?.usesServerApis && succAnalysis.executionModel.usesServerApis.length > 0) ||
          succAnalysis?.executionModel?.boundaryViolations?.includes("server APIs in client");
        if (hasServerApi) {
          return succ;
        }
        if (!visited.has(succ)) {
          visited.add(succ);
          queue.push(succ);
        }
      }
    }
  }

  if (ruleId === "RU-001-CRITICAL" || ruleId === "RU-001-HIGH") {
    const visited = new Set<string>([filePath]);
    const queue = [filePath];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const successors = graph.successors(curr) || [];
      for (const succ of successors) {
        const succAnalysis = lastAnalyses?.find((a: any) => a.filePath === succ);
        const hasTaint = succAnalysis?.taints?.some(
          (t: any) => t.type === "NODE_NATIVE_API" || t.type === "PROCESS_ENV"
        );
        if (hasTaint) {
          return succ;
        }
        if (!visited.has(succ)) {
          visited.add(succ);
          queue.push(succ);
        }
      }
    }
  }

  return filePath;
}

/**
 * Reconstructs the dependency import trace path from graph data.
 */
export function buildDependencyPath(
  filePath: string,
  constraintId: string,
  affects: string[]
): string {
  const fileName = path.basename(filePath);
  const fileNode = lastGraphNodes?.get(filePath);

  const fileLabel =
    fileNode?.semanticKind === "client-util"
      ? "Client Utility Module"
      : fileNode?.semanticKind === "server-util"
        ? "Server Utility Module"
        : fileNode?.semanticKind === "shared-util"
          ? "Shared Utility Module"
          : fileNode?.semanticKind === "mixed-runtime-util"
            ? "Mixed-runtime Utility Module"
            : fileNode?.semanticKind === "util"
              ? "Utility Module"
              : fileNode?.semanticKind === "server-action"
                ? "Server Action Module"
                : fileNode?.isClientComponent
                  ? "Client Component"
                  : fileNode?.isServerComponent
                    ? "Server Component"
                    : "Module";

  if (
    lastGraph &&
    lastGraphNodes &&
    (constraintId === "CC-SERVER-IMPORT-001" ||
      constraintId === "CC-RUNTIME-LEAK-001" ||
      constraintId === "RU-001-CRITICAL" ||
      constraintId === "RU-001-HIGH")
  ) {
    const visited = new Set<string>();
    const parentMap = new Map<string, string>();
    const queue = [filePath];
    let targetNode: string | null = null;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      if (visited.has(curr)) continue;
      visited.add(curr);

      const successors: string[] = lastGraph.successors(curr) ?? [];
      for (const succ of successors) {
        const succNode = lastGraphNodes.get(succ);
        const isServerAction =
          succNode?.semanticKind === "server-action" ||
          succNode?.isServerAction ||
          succ.toLowerCase().includes("action");
        if (isServerAction) continue;

        let isTarget = false;
        if (constraintId === "CC-SERVER-IMPORT-001") {
          isTarget = !!(succNode?.isServerComponent || succNode?.semanticKind === "server-component");
        } else if (constraintId === "CC-RUNTIME-LEAK-001") {
          const succAnalysis = lastAnalyses?.find((a: any) => a.filePath === succ);
          isTarget = !!(
            (succAnalysis?.executionModel?.usesServerApis && succAnalysis.executionModel.usesServerApis.length > 0) ||
            succAnalysis?.executionModel?.boundaryViolations?.includes("server APIs in client")
          );
        } else if (constraintId === "RU-001-CRITICAL" || constraintId === "RU-001-HIGH") {
          const succAnalysis = lastAnalyses?.find((a: any) => a.filePath === succ);
          isTarget = !!(
            succAnalysis?.taints?.some(
              (t: any) => t.type === "NODE_NATIVE_API" || t.type === "PROCESS_ENV"
            )
          );
        }

        if (isTarget) {
          if (!parentMap.has(succ)) {
            parentMap.set(succ, curr);
            targetNode = succ;
          }
        }
        if (!parentMap.has(succ)) {
          parentMap.set(succ, curr);
          queue.push(succ);
        }
      }

      if (targetNode) break;
    }

    if (targetNode) {
      const tracePath: string[] = [];
      let curr: string | null = targetNode;
      while (curr) {
        tracePath.unshift(curr);
        curr = parentMap.get(curr) || null;
      }

      let result = "";
      for (let i = 0; i < tracePath.length; i++) {
        const nodePath = tracePath[i]!;
        const baseName = path.basename(nodePath);
        const nodeData = lastGraphNodes?.get(nodePath);
        const label =
          nodeData?.semanticKind === "client-util"
            ? "Client Utility Module"
            : nodeData?.semanticKind === "server-util"
              ? "Server Utility Module"
              : nodeData?.semanticKind === "shared-util"
                ? "Shared Utility Module"
                : nodeData?.semanticKind === "mixed-runtime-util"
                  ? "Mixed-runtime Utility Module"
                  : nodeData?.semanticKind === "util"
                    ? "Utility Module"
                    : nodeData?.semanticKind === "server-action"
                      ? "Server Action Module"
                      : nodeData?.isClientComponent
                        ? "Client Component"
                        : nodeData?.isServerComponent
                          ? "Server Module"
                          : "Module";

        if (i === 0) {
          result += `${baseName} (${label})`;
        } else {
          result += `\n${"  ".repeat(i)}→ imports ${baseName} (${label})`;
        }
      }

      const suffixSymbols = affects.filter(
        (a) => !tracePath.some((tp) => tp.includes(a))
      );
      if (suffixSymbols.length > 0) {
        result += `\n${"  ".repeat(tracePath.length)}→ exports ${suffixSymbols.join(", ")}() (Server-only API)`;
      }

      return result;
    }
  }

  let result = `${fileName} (${fileLabel})`;
  if (affects.length > 0) {
    const apiKind =
      constraintId.startsWith("SA-") ? "Server Action" :
      constraintId.startsWith("HY-") ? "Browser API" :
      constraintId.startsWith("SC-") && affects.some(a => ["localStorage","window","navigator","document"].includes(a.toLowerCase())) ? "Browser API" :
      "Reference";
    result += `\n  → references ${affects.join(", ")} (${apiKind})`;
  }

  return result;
}

function extractAffects(msg: string): string[] {
  if (!msg) return [];
  const matches = [...msg.matchAll(/'([^']+)'/g)];
  return matches.length > 0
    ? matches
        .map((m) => m[1]!)
        .filter((val) => {
          if (/\.[a-zA-Z0-9]{2,4}$/.test(val)) return false;
          if (val.startsWith("/") || val.startsWith("\\")) return false;
          return true;
        })
    : [];
}
