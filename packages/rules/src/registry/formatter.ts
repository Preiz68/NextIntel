import path from "node:path";
import { Diagnostic, ExecutionPhase } from "../types.js";
import { getRuleSpec } from "./rule-registry.js";
import { calculateSeverityScore } from "./scoring.js";
import { resolveBoundary, phaseMetadata, FileMeta, NodeContext } from "./boundary-resolver.js";
import { generateExecutionGraph } from "./execution-graph-generator.js";
import { generateCodeFrame } from "./codeframe-generator.js";
import { resolvedOwnerships, resolvedRuntimes, getLastGraph, getLastGraphNodes, buildDependencyPath } from "./engine.js";

interface LineDetail {
  line: number;
  affects: string[];
}

interface GroupedRule {
  ruleId: string;
  lines: number[];
  message: string;
  affects: string[];
  lineDetails: LineDetail[];
  diagnostics: Diagnostic[];
}

interface GroupedDiagnostic {
  file: string;
  rules: GroupedRule[];
}

function extractAffects(msg: string): string[] {
  const matches = [...msg.matchAll(/'([^']+)'/g)];
  return matches.length > 0 ? matches.map((m) => m[1]!) : [];
}

function buildFileMeta(filePath: string): FileMeta {
  const nodes = getLastGraphNodes();
  const node = nodes?.get(filePath);
  const kind: string = node?.semanticKind ?? "unknown";

  return {
    kind,
    isClientComponent: node?.isClientComponent === true || kind === "client-component" || kind === "client-util",
    isServerComponent: node?.isServerComponent === true || kind === "server-component" || kind === "server-util",
    isServerAction: kind === "server-action" || filePath.toLowerCase().includes("action"),
    filePath,
  };
}

function buildNodeContext(constraintId: string, affects: string[]): NodeContext {
  const affectsLower = affects.map((a) => a.toLowerCase()).join(" ");

  const hydrationSensitiveApis = ["localstorage", "sessionstorage", "window", "navigator", "document"];
  const isHydrationSensitive =
    constraintId === "HY-RENDER-BROWSER-API-001" ||
    hydrationSensitiveApis.some((api) => affectsLower.includes(api));

  const isClientToServerImport =
    constraintId === "CC-SERVER-IMPORT-001" ||
    constraintId === "CC-RUNTIME-LEAK-001";

  return { isHydrationSensitive, isClientToServerImport };
}

/**
 * renderGroupedDiagnostics()
 * Outputs compiler-native enriched diagnostic blocks.
 */
export function renderGroupedDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "\x1b[32m✅ No issues found! Your project looks clean.\x1b[0m\n";
  }

  // 1. Group by file -> rule ID
  const fileGroups = new Map<string, Map<string, Diagnostic[]>>();
  for (const d of diagnostics) {
    if (!fileGroups.has(d.file)) fileGroups.set(d.file, new Map());
    const fileMap = fileGroups.get(d.file)!;
    if (!fileMap.has(d.id)) fileMap.set(d.id, []);
    fileMap.get(d.id)!.push(d);
  }

  const groupedDiagnostics: GroupedDiagnostic[] = [];
  for (const [filePath, fileMap] of fileGroups.entries()) {
    const rulesList: GroupedRule[] = [];

    for (const [ruleId, diags] of fileMap.entries()) {
      const lineDetails: LineDetail[] = [];
      const linesSet = new Set<number>();
      const affectsSet = new Set<string>();

      for (const d of diags) {
        if (typeof d.line === "number") {
          linesSet.add(d.line);
          const lineAffects = extractAffects(d.message).map((a) =>
            a.includes("/") || a.includes("\\") ? path.basename(a) : a
          );
          lineAffects.forEach((la) => {
            if (la && la !== "unknown symbols") affectsSet.add(la);
          });
          lineDetails.push({ line: d.line, affects: lineAffects });
        }
      }

      lineDetails.sort((a, b) => a.line - b.line);

      const spec = getRuleSpec(ruleId);
      rulesList.push({
        ruleId,
        lines: Array.from(linesSet).sort((a, b) => a - b),
        message: spec?.name ?? diags[0]!.message,
        affects: Array.from(affectsSet),
        lineDetails,
        diagnostics: diags,
      });
    }

    rulesList.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    groupedDiagnostics.push({ file: filePath, rules: rulesList });
  }

  // 2. Render each violation block
  let output = "";

  for (const group of groupedDiagnostics) {
    output += `\n\x1b[1mFile: ${group.file}\x1b[0m\n`;

    for (const rule of group.rules) {
      const { ruleId, affects, lineDetails, diagnostics: ruleDiags } = rule;
      const spec = getRuleSpec(ruleId);

      const fileMeta = buildFileMeta(group.file);
      const nodeCtx = buildNodeContext(ruleId, affects);

      const resolved = resolveBoundary(fileMeta, nodeCtx);
      const validity = spec?.phaseCorrectness?.[resolved.phase] ?? "invalid";

      const confidence = spec?.confidence ?? 1.0;
      const mode = spec?.detectionMode ?? "deterministic";

      // Build dependency trace
      const depPath = buildDependencyPath(group.file, ruleId, affects);
      const propagationDepth = depPath.split("\n").filter(line => line.includes("→ imports") || line.includes("→ exports")).length + 1;

      const isGuarded = ruleDiags.some(d => d.isGuarded);
      const scoring = spec
        ? calculateSeverityScore(ruleId, resolved.phase, confidence, propagationDepth, isGuarded)
        : { score: 5.0, level: "MEDIUM" as const, impactScores: { hydration: 5, rendering: 5, bundleSize: 3, caching: 3, security: 3, serverLoad: 3 } };

      // Extract raw paths from trace for graph drawing
      const rawTracePaths = depPath
        .split("\n")
        .map((line) => {
          const match = line.match(/(?:\s*→\s*(?:imports|exports|references)\s+)?([^\s(]+)/);
          return match ? match[1]! : "";
        })
        .filter((x) => x !== "");

      // Ensure root file is included at the head of trace paths
      const tracePaths: string[] = [];
      const nodes = getLastGraphNodes();
      if (nodes) {
        for (const item of rawTracePaths) {
          // find matching absolute path in graph node keys
          let foundPath = item;
          for (const key of nodes.keys()) {
            if (key.endsWith(item)) {
              foundPath = key;
              break;
            }
          }
          tracePaths.push(foundPath);
        }
      }
      if (tracePaths.length === 0) {
        tracePaths.push(group.file);
        if (affects.length > 0) {
          tracePaths.push(affects[0]!);
        }
      }

      const executionGraph = generateExecutionGraph(tracePaths, resolvedOwnerships, resolvedRuntimes);

      // Generate codeframe for first target line
      const targetLine = lineDetails[0]?.line ?? 1;
      const codeframe = generateCodeFrame(group.file, targetLine, affects);

      // Build text explanations
      const affectsStr = affects.length > 0 ? affects.join(", ") : "the affected symbol";
      const causeText = (ruleId === "CC-RUNTIME-LEAK-001" && ruleDiags[0]?.message)
        ? ruleDiags[0].message
        : (spec
            ? (affects.length > 0
                ? `'${affectsStr}' — ${spec.message.cause.charAt(0).toLowerCase()}${spec.message.cause.slice(1)}`
                : spec.message.cause)
            : "Evaluation failed.");

      const boundaryLabel = spec?.boundary ?? "UNKNOWN_BOUNDARY";

      // Color scheme
      const levelStr = scoring.level;
      const severityColor =
        levelStr === "CRITICAL" ? "\x1b[31m"
        : levelStr === "HIGH"   ? "\x1b[31m"
        : levelStr === "MEDIUM" ? "\x1b[33m"
        :                          "\x1b[36m";

      const titleSuffix = affects.length > 0 ? ` [${affects.join(", ")}]` : "";
      const ruleName = spec?.name ?? ruleId;

      // Print Violation header with confidence score
      output += `\n  ${severityColor}[${levelStr}]\x1b[0m \x1b[1m${ruleId}: ${ruleName}${titleSuffix}\x1b[0m  (Confidence: ${(confidence * 100).toFixed(0)}% — ${mode}) at ${group.file}:${targetLine}\n`;

      // Print Propagated Targets if any
      const firstDiag = ruleDiags[0];
      if (firstDiag && (firstDiag as any).propagatedTargets && (firstDiag as any).propagatedTargets.length > 0) {
        output += `    \x1b[33mPropagated to:\x1b[0m\n`;
        for (const target of (firstDiag as any).propagatedTargets) {
          output += `      - ${target.file}:${target.line}\n`;
        }
      }

      // Format sequence output
      output += `\n`;
      output += `    Boundary:          ${boundaryLabel}\n`;
      output += `    Execution Phase:   ${resolved.phase} (${validity} in this phase — Stage ${resolved.stageOrder} — ${resolved.stageLabel})\n`;
      output += `    Runtime:           ${resolved.runtime}\n`;

      const lineParts = lineDetails.map((ld) => {
        const filtered = ld.affects.filter((a) => a && a !== "unknown symbols");
        return `${group.file}:${ld.line}${filtered.length > 0 ? ` (${filtered.join(", ")})` : ""}`;
      });
      output += `    Location:          ${lineParts.length > 0 ? lineParts.join(", ") : "N/A"}\n`;

      // ── Impact Scores block ────────────────────────────────────────────────
      const imp = (scoring as any).impactScores;
      if (imp) {
        output += `\n    Impact Scores:\n`;
        output += `      - Rendering:    ${imp.rendering.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Hydration:    ${imp.hydration.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Bundle Size:  ${(imp.bundle || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `      - Security:     ${imp.security.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Cache:        ${(imp.cache || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `      - Runtime:      ${(imp.runtime || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `\n    ${severityColor}Overall Severity:  ${levelStr} (${scoring.score.toFixed(2)})\x1b[0m\n`;
      } else {
        output += `    Severity Rating:   ${levelStr} (${scoring.score.toFixed(2)})\n`;
      }

      output += `\n    Dependency Path:\n`;
      for (const line of depPath.split("\n")) {
        output += `      ${line}\n`;
      }

      const hasProp = firstDiag && (firstDiag as any).propagationImpact;
      if (hasProp) {
        const rootOrigin = (firstDiag as any).rootViolationOrigin;
        const propImpact = (firstDiag as any).propagationImpact;
        output += `\n    ❗ ROOT VIOLATION ORIGIN: ${path.basename(rootOrigin)}\n`;
        output += `    ❗ PROPAGATION IMPACT:    ${path.basename(propImpact)}\n`;
      } else {
        output += `\n    Root Cause:\n`;
        output += `      ${group.file}\n`;
      }

      if (executionGraph) {
        output += `\n    Execution Graph:\n`;
        for (const line of executionGraph.split("\n")) {
          output += `      ${line}\n`;
        }
      }

      if (codeframe) {
        output += `\n    Codeframe Highlight:\n`;
        for (const line of codeframe.split("\n")) {
          output += `      ${line}\n`;
        }
      }

      output += `\n    Impact Analysis:\n`;
      output += `      ${spec?.message.impact ?? "Unknown production risk."}\n`;

      output += `\n    Architectural Reasoning:\n`;
      output += `      Why it matters:\n`;
      output += `        ${spec?.message.ruleExplanation ?? "No reasoning context."}\n`;
      output += `      Boundary compliance:\n`;
      output += `        Violates ${boundaryLabel} — ${causeText}\n`;

      if (spec?.fix) {
        output += `\n    Fix Recommendations:\n`;

        // ── Fix Confidence badge ────────────────────────────────────────────
        const fc = spec.fix.confidence;
        if (fc) {
          const fcColor =
            fc === "HIGH"   ? "\x1b[32m" :   // green
            fc === "MEDIUM" ? "\x1b[33m" :   // yellow
                              "\x1b[31m";    // red for LOW
          output += `      Fix Confidence:  ${fcColor}${fc}\x1b[0m`;
          if (spec.fix.confidenceReason) {
            output += `  \x1b[2m← ${spec.fix.confidenceReason}\x1b[0m`;
          }
          output += `\n`;
        }

        output += `      Primary:\n        ${spec.fix.primary}\n`;
        if (spec.fix.architecture) {
          output += `\n      Architecture:\n        ${spec.fix.architecture}\n`;
        }
        if (spec.fix.alternatives && spec.fix.alternatives.length > 0) {
          output += `\n      Alternatives:\n`;
          for (const alt of spec.fix.alternatives) {
            output += `        - ${alt}\n`;
          }
        }
      }

      if (firstDiag && (firstDiag as any).safeRefactorSuggestion) {
        output += `\n    💡 Safe Refactor Suggestion:\n`;
        const lines = (firstDiag as any).safeRefactorSuggestion.split("\n");
        for (const line of lines) {
          output += `      ${line}\n`;
        }
      }

      output += `\n  \x1b[2m${"─".repeat(65)}\x1b[0m\n`;
    }
  }

  // ── Global Project Score ───────────────────────────────────────────────────
  const graph = getLastGraph();
  const nodes = getLastGraphNodes();
  
  let weightedScoreSum = 0;
  let totalWeight = 0;
  let totalFiles = 0;

  const fileDiagnosticsMap = new Map<string, Diagnostic[]>();
  for (const d of diagnostics) {
    if (!fileDiagnosticsMap.has(d.file)) {
      fileDiagnosticsMap.set(d.file, []);
    }
    fileDiagnosticsMap.get(d.file)!.push(d);
  }

  // Iterate over all nodes in the graph (or fallback to diagnostics if graph is not built)
  const allPaths = nodes ? Array.from(nodes.keys()) : Array.from(fileDiagnosticsMap.keys());
  
  for (const filePath of allPaths) {
    totalFiles++;
    const node = nodes?.get(filePath);
    const kind = node?.semanticKind ?? "unknown";

    // 1. Calculate fileScore
    let fileScore = 0;
    const fileDiags = fileDiagnosticsMap.get(filePath) ?? [];
    for (const d of fileDiags) {
      const spec = getRuleSpec(d.id);
      const affects = extractAffects(d.message);
      const fileMeta = buildFileMeta(filePath);
      const nodeCtx = buildNodeContext(d.id, affects);
      const resolved = spec
        ? phaseMetadata(spec.phases[0]!)
        : resolveBoundary(fileMeta, nodeCtx);
      const confidence = spec?.confidence ?? 1.0;
      const isGuarded = d.isGuarded ?? false;
      const scoring = spec
        ? calculateSeverityScore(d.id, resolved.phase, confidence, 1, isGuarded)
        : { score: 5.0 };
      fileScore += scoring.score;
    }
    fileScore = Math.min(10.0, fileScore);

    // 2. Calculate fileWeight
    let baseRouteImportance = 1.0;
    if (["page", "layout", "template", "loading", "error", "not-found", "global-error", "default", "route-handler", "middleware"].includes(kind)) {
      baseRouteImportance = 1.5;
    } else if (["client-component", "server-component"].includes(kind)) {
      baseRouteImportance = 1.2;
    }

    let inDegree = 0;
    let outDegree = 0;
    if (graph) {
      try {
        inDegree = graph.inDegree(filePath) ?? 0;
        outDegree = graph.outDegree(filePath) ?? 0;
      } catch {}
    }
    const centrality = inDegree + outDegree;
    const centralityWeight = centrality > 0 ? 1 + Math.log(centrality) : 1.0;

    let serverActionExposure = 1.0;
    if (kind === "server-action" || filePath.toLowerCase().includes("action")) {
      serverActionExposure = 1.3;
    } else if (graph) {
      const successors = graph?.successors(filePath) || [];
      const predecessors = graph?.predecessors(filePath) || [];
      const isRelated = [...successors, ...predecessors].some(p => {
        const pNode = nodes?.get(p);
        return pNode?.semanticKind === "server-action" || p.toLowerCase().includes("action");
      });
      if (isRelated) {
        serverActionExposure = 1.3;
      }
    }

    let clientBundleInclusion = 1.0;
    const isClient = node?.isClientComponent === true || kind === "client-component" || kind === "client-util";
    if (isClient) {
      clientBundleInclusion = 1.2;
    }

    const fileWeight = baseRouteImportance * centralityWeight * serverActionExposure * clientBundleInclusion;

    weightedScoreSum += fileScore * fileWeight;
    totalWeight += fileWeight;
  }

  const projectScore = totalWeight > 0 ? (weightedScoreSum / totalWeight) : 0.0;
  
  function classifyProject(score: number): string {
    if (score >= 8.0) return "CRITICAL";
    if (score >= 6.0) return "HIGH";
    if (score >= 4.0) return "MEDIUM";
    return "LOW";
  }

  const projectClass = classifyProject(projectScore);
  const summaryColor =
    projectClass === "CRITICAL" ? "\x1b[31m"
    : projectClass === "HIGH"   ? "\x1b[31m"
    : projectClass === "MEDIUM" ? "\x1b[33m"
    :                             "\x1b[32m";

  output += `\n\x1b[1m=================================================================\x1b[0m\n`;
  output += `\x1b[1m🚀 NextIntel Global Architecture Risk Index\x1b[0m\n`;
  output += `\x1b[1m=================================================================\x1b[0m\n`;
  output += `  Global Project Score:  ${summaryColor}${projectScore.toFixed(2)} / 10.0  (${projectClass})\x1b[0m\n`;
  output += `  Analyzed Modules:      ${totalFiles} files\n`;
  output += `  Risk Weight Model:     Route Importance + Centrality (log-weighted) + Actions + Client Bundle\n`;
  output += `\x1b[1m=================================================================\x1b[0m\n`;

  return output;
}
