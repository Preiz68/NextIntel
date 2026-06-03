import path from "node:path";
import { Diagnostic, ExecutionPhase, SeverityLevel } from "../types.js";
import { getRuleSpec } from "./rule-registry.js";
import { calculateSeverityScore, getRuleAuditMetadata, applyContextualScoreOverride, toSeverityLevel } from "./scoring.js";
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
  precomputed: {
    displayLevel: "BLOCKER" | "WARNING" | "INFO";
    severityColor: string;
    scoring: any;
    targetLine: number;
    depPath: string;
    executionGraph: string;
    codeframe: string;
    causeText: string;
    boundaryLabel: string;
    resolved: any;
    spec: any;
    confidence: number;
    mode: string;
    primaryFix?: string;
    architectureFix?: string;
    alternativesFix?: string[];
  };
}

interface GroupedDiagnostic {
  file: string;
  rules: GroupedRule[];
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

function getFileRank(filePath: string): number {
  const base = path.basename(filePath).toLowerCase();
  // Layouts first
  if (base.includes("layout.")) {
    return 1;
  }
  // Pages and Templates
  if (base.includes("page.") || base.includes("template.")) {
    return 2;
  }
  // Route / special files
  if (
    base.includes("loading.") ||
    base.includes("error.") ||
    base.includes("not-found.") ||
    base.includes("global-error.") ||
    base.includes("default.") ||
    base.includes("route.") ||
    base.includes("middleware.")
  ) {
    return 3;
  }
  // Components
  if (
    filePath.toLowerCase().includes("/components/") ||
    base.endsWith(".tsx") ||
    base.endsWith(".jsx")
  ) {
    return 4;
  }
  // Utilities, actions, handlers, etc.
  return 5;
}

function getFixPriority(file: string, displayLevel: "BLOCKER" | "WARNING" | "INFO"): number {
  const fileRank = getFileRank(file); // 1 = layout, 2 = page, 3 = special, 4 = component, 5 = utility/other
  let base = 0;
  if (displayLevel === "BLOCKER") {
    base = 0; // priority 1-5
  } else if (displayLevel === "WARNING") {
    base = 5; // priority 6-10
  } else {
    base = 10; // priority 11-15
  }
  return base + fileRank;
}

function getIssueCategory(ruleId: string, level: SeverityLevel, context?: { fetchCount?: number; isWaterfall?: boolean; layoutDepth?: number }): string {
  return getRuleAuditMetadata(ruleId, level, context).category;
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
      const targetLine = lineDetails[0]?.line ?? 1;

      const spec = getRuleSpec(ruleId);
      const affects = Array.from(affectsSet);

      const fileMeta = buildFileMeta(filePath);
      const nodeCtx = buildNodeContext(ruleId, affects);

      const resolved = resolveBoundary(fileMeta, nodeCtx);
      const confidence = spec?.confidence ?? 1.0;
      const mode = spec?.detectionMode ?? "deterministic";

      // Build dependency trace
      const depPath = buildDependencyPath(filePath, ruleId, affects);
      const propagationDepth = depPath.split("\n").filter(line => line.includes("→ imports") || line.includes("→ exports")).length + 1;

      const isGuarded = diags.some(d => d.isGuarded);
      const scoring = spec
        ? calculateSeverityScore(ruleId, resolved.phase, confidence, propagationDepth, isGuarded)
        : { score: 5.0, level: "MEDIUM" as const, impactScores: { hydration: 5, rendering: 5, bundle: 3, security: 3, cache: 3, runtime: 5 } };

      if (spec) {
        let finalScore = scoring.score;
        if (ruleId === "RO-005") {
          finalScore = applyContextualScoreOverride(ruleId, finalScore, {
            fetchCount: diags[0]?.fetchCount,
            isWaterfall: diags[0]?.isWaterfall,
          });
        } else if (ruleId === "RO-006") {
          finalScore = applyContextualScoreOverride(ruleId, finalScore, {
            isCriticalLayoutPath: (diags[0] as any)?.isCriticalLayoutPath,
          });
        } else if (ruleId === "DYNAMIC_LAYOUT_IMPACT") {
          const normFile = filePath.replace(/\\/g, "/");
          const appIdx = normFile.indexOf("/app/");
          let layoutDepth = 0;
          if (appIdx !== -1) {
            const relPath = normFile.substring(appIdx + 5);
            const segments = relPath.split("/").filter(s => s.length > 0);
            layoutDepth = segments.slice(0, -1).filter(
              s => !s.startsWith("(") && !s.startsWith("@")
            ).length;
          }
          finalScore = applyContextualScoreOverride(ruleId, finalScore, { layoutDepth });
        }
        scoring.score = finalScore;
        scoring.level = toSeverityLevel(finalScore);
      }

      const displayLevel =
        scoring.level === "CRITICAL" ? "BLOCKER" :
        (scoring.level === "HIGH" || scoring.level === "MEDIUM") ? "WARNING" :
        "INFO";

      const severityColor =
        displayLevel === "BLOCKER" ? "\x1b[31m" :
        displayLevel === "WARNING" ? "\x1b[33m" :
        "\x1b[36m";

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
        for (let i = 0; i < rawTracePaths.length; i++) {
          const item = rawTracePaths[i]!;
          let foundPath = item;
          if (i === 0) {
            foundPath = filePath;
          } else {
            for (const key of nodes.keys()) {
              if (key.endsWith("/" + item) || key.endsWith("\\" + item) || key === item) {
                foundPath = key;
                break;
              }
            }
            if (foundPath === item) {
              for (const key of nodes.keys()) {
                if (key.endsWith(item)) {
                  foundPath = key;
                  break;
                }
              }
            }
          }
          tracePaths.push(foundPath);
        }
      }
      if (tracePaths.length === 0) {
        tracePaths.push(filePath);
        if (affects.length > 0) {
          tracePaths.push(affects[0]!);
        }
      }

      const executionGraph = generateExecutionGraph(tracePaths, resolvedOwnerships, resolvedRuntimes);
      const codeframe = generateCodeFrame(filePath, targetLine, affects);

      const affectsStr = affects.length > 0 ? affects.join(", ") : "the affected symbol";
      const causeText = (ruleId === "CC-RUNTIME-LEAK-001" && diags[0]?.message)
        ? diags[0].message
        : (spec
            ? (affects.length > 0
                ? `'${affectsStr}' — ${spec.message.cause.charAt(0).toLowerCase()}${spec.message.cause.slice(1)}`
                : spec.message.cause)
            : "Evaluation failed.");

      const boundaryLabel = spec?.boundary ?? "UNKNOWN_BOUNDARY";

      rulesList.push({
        ruleId,
        lines: Array.from(linesSet).sort((a, b) => a - b),
        message: spec?.name ?? diags[0]!.message,
        affects,
        lineDetails,
        diagnostics: diags,
        precomputed: {
          displayLevel,
          severityColor,
          scoring,
          targetLine,
          depPath,
          executionGraph,
          codeframe,
          causeText,
          boundaryLabel,
          resolved,
          spec,
          confidence,
          mode,
          primaryFix: spec?.fix?.primary,
          architectureFix: spec?.fix?.architecture,
          alternativesFix: spec?.fix?.alternatives,
        }
      });
    }

    rulesList.sort((a, b) => a.ruleId.localeCompare(b.ruleId));
    groupedDiagnostics.push({ file: filePath, rules: rulesList });
  }

  // Sort groupedDiagnostics dynamically by risk ranking (layouts first)
  groupedDiagnostics.sort((a, b) => {
    const rankA = getFileRank(a.file);
    const rankB = getFileRank(b.file);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return a.file.localeCompare(b.file);
  });

function getRuleShortLabel(ruleId: string, affects: string[], message: string): string {
  const id = ruleId.toUpperCase();
  if (id.startsWith("DYNAMIC_LAYOUT_IMPACT")) {
    if (id.includes("COSMETIC")) return "Cosmetic cookie access in root layout";
    if (id.includes("AUTH")) return "Auth/session cookie in root layout";
    if (id.includes("PERSONALIZATION")) return "Personalization cookie in root layout";
    return "Dynamic layout rendering impact";
  }
  if (id.includes("DYNAMIC_RENDER_TRIGGER-003")) {
    return "Dynamic API in root layout";
  }
  if (id.includes("DYNAMIC_RENDER_TRIGGER-004")) {
    return "Missing cache revalidation";
  }
  if (id.includes("LAYOUT_AUTH_GATE")) {
    return "Expected Authentication Boundary";
  }
  if (id.includes("RO-007")) {
    return "Sequential Async Waterfall";
  }
  if (id.includes("RE-003-OPT")) {
    return "Optimization Opportunity: Known finite routes can use generateStaticParams()";
  }
  if (id.includes("RE-003")) {
    return "Missing generateStaticParams()";
  }
  if (id.includes("RO-003")) {
    return "Parallel route slot missing default.tsx fallback";
  }
  if (id.includes("RO-005")) {
    return "Streaming Opportunity: Wrap data fetch in Suspense boundary";
  }
  if (id.includes("CC-RUNTIME-LEAK-001")) {
    return "Server API imported in client component";
  }
  if (id.includes("CC-SERVER-IMPORT-001")) {
    return "Server Component imported in client component";
  }
  if (id.includes("DF-001")) {
    return "Missing explicit cache strategy";
  }
  if (id.includes("DF-005")) {
    return "Sequential fetch waterfall";
  }
  if (id.includes("HY-RENDER-BROWSER-API-001")) {
    return "Browser API accessed during server rendering";
  }
  return message;
}

  let output = "";

  // 2a. ASCII Tree summary grouped by developer categories
  output += `\x1b[1m=========================================\n`;
  output += `🌳 ARCHITECTURE & PERFORMANCE DIAGNOSTIC TREE\n`;
  output += `=========================================\x1b[0m\n`;

  const categories = {
    "🚫 ARCHITECTURAL VIOLATIONS": new Map<string, GroupedRule[]>(),
    "⚠️ PERFORMANCE RISKS": new Map<string, GroupedRule[]>(),
    "💡 OPTIMIZATION OPPORTUNITIES": new Map<string, GroupedRule[]>(),
  };

  for (const group of groupedDiagnostics) {
    for (const rule of group.rules) {
      const normPath = group.file.replace(/\\/g, "/");
      const appIdx = normPath.indexOf("/app/");
      let layoutDepth = 0;
      if (appIdx !== -1) {
        const relPath = normPath.substring(appIdx + 5);
        const segments = relPath.split("/").filter((s) => s.length > 0);
        layoutDepth = segments
          .slice(0, -1)
          .filter((s) => !s.startsWith("(") && !s.startsWith("@")).length;
      }

      const catName = getIssueCategory(
        rule.ruleId,
        rule.precomputed.scoring.level,
        {
          fetchCount: rule.diagnostics[0]?.fetchCount,
          isWaterfall: rule.diagnostics[0]?.isWaterfall,
          layoutDepth,
        }
      ) as keyof typeof categories;

      const catMap = categories[catName] || categories["💡 OPTIMIZATION OPPORTUNITIES"];
      if (!catMap.has(group.file)) {
        catMap.set(group.file, []);
      }
      catMap.get(group.file)!.push(rule);
    }
  }

  const categoryOrder = [
    "🚫 ARCHITECTURAL VIOLATIONS",
    "⚠️ PERFORMANCE RISKS",
    "💡 OPTIMIZATION OPPORTUNITIES"
  ];

  for (const catName of categoryOrder) {
    const catMap = categories[catName as keyof typeof categories];
    if (!catMap || catMap.size === 0) continue;
    let catColor = "\x1b[35m";
    if (catName.includes("VIOLATIONS")) {
      catColor = "\x1b[31m";
    } else if (catName.includes("RISKS")) {
      catColor = "\x1b[33m";
    } else {
      catColor = "\x1b[36m";
    }
    output += `\n\x1b[1m${catColor}=================================\n${catName}\n=================================\x1b[0m\n\n`;

    const files = Array.from(catMap.keys()).sort((a, b) => {
      const rankA = getFileRank(a);
      const rankB = getFileRank(b);
      if (rankA !== rankB) return rankA - rankB;
      return a.localeCompare(b);
    });

    for (const file of files) {
      let displayPath = path.relative(process.cwd(), file).replace(/\\/g, "/");
      if (displayPath.startsWith("stress-test/app/")) {
        displayPath = displayPath.substring("stress-test/app/".length);
      } else if (displayPath.startsWith("stress-test/")) {
        displayPath = displayPath.substring("stress-test/".length);
      }
      output += `\x1b[1m${displayPath}\x1b[0m\n`;
      const rulesList = catMap.get(file)!;
      for (let i = 0; i < rulesList.length; i++) {
        const rule = rulesList[i]!;
        const isLast = i === rulesList.length - 1;
        const prefix = isLast ? " └─ " : " ├─ ";
        
        const shortLabel = getRuleShortLabel(rule.ruleId, rule.affects, rule.message);
        const dl = rule.precomputed.displayLevel;
        let color = "\x1b[36m";
        if (dl === "BLOCKER") {
          color = "\x1b[31m";
        } else if (dl === "WARNING") {
          color = "\x1b[33m";
        }

        output += `${prefix}${color}${shortLabel}\x1b[0m\n`;
      }
      output += `\n`;
    }
  }
  output += `\n`;

  // 2b. Render each violation block
  for (const group of groupedDiagnostics) {
    output += `\n\x1b[1mFile: ${group.file}\x1b[0m\n`;

    for (const rule of group.rules) {
      const { ruleId, affects, lineDetails, diagnostics: ruleDiags, precomputed } = rule;
      const { displayLevel, severityColor, scoring, targetLine, depPath, executionGraph, codeframe, causeText, boundaryLabel, resolved, spec, confidence, mode } = precomputed;
      const validity = spec?.phaseCorrectness?.[resolved.phase] ?? "invalid";

      const titleSuffix = affects.length > 0 ? ` [${affects.join(", ")}]` : "";
      const ruleName = spec?.name ?? ruleId;

      // Print Violation header
      output += `\n  ${severityColor}[${displayLevel}]\x1b[0m \x1b[1m${ruleId}: ${ruleName}${titleSuffix}\x1b[0m  (Confidence: ${(confidence * 100).toFixed(0)}% — ${mode}) at ${group.file}:${targetLine}\n`;

      // Print Propagated Targets if any
      const firstDiag = ruleDiags[0];
      if (firstDiag && (firstDiag as any).propagatedTargets && (firstDiag as any).propagatedTargets.length > 0) {
        output += `    \x1b[33mPropagated to:\x1b[0m\n`;
        for (const target of (firstDiag as any).propagatedTargets) {
          output += `      - ${target.file}:${target.line}\n`;
        }
      }

      const normPath = group.file.replace(/\\/g, "/");
      const appIdx = normPath.indexOf("/app/");
      let layoutDepth = 0;
      if (appIdx !== -1) {
        const relPath = normPath.substring(appIdx + 5);
        const segments = relPath.split("/").filter((s) => s.length > 0);
        layoutDepth = segments
          .slice(0, -1)
          .filter((s) => !s.startsWith("(") && !s.startsWith("@")).length;
      }
      const auditMeta = getRuleAuditMetadata(ruleId, scoring.level, {
        fetchCount: ruleDiags[0]?.fetchCount,
        isWaterfall: ruleDiags[0]?.isWaterfall,
        layoutDepth,
      });

      output += `\n`;
      output += `    Boundary:          ${boundaryLabel}\n`;
      output += `    Execution Phase:   ${resolved.phase} (${validity} in this phase — Stage ${resolved.stageOrder} — ${resolved.stageLabel})\n`;
      output += `    Runtime:           ${resolved.runtime}\n`;
      output += `    Audit Class:       ${auditMeta.category}\n`;
      output += `    Fix Effort:        ${auditMeta.effort} mins\n`;
      output += `    Fix Impact:        ${auditMeta.impact}\n`;

      const lineParts = lineDetails.map((ld) => {
        const filtered = ld.affects.filter((a) => a && a !== "unknown symbols");
        return `${group.file}:${ld.line}${filtered.length > 0 ? ` (${filtered.join(", ")})` : ""}`;
      });
      output += `    Location:          ${lineParts.length > 0 ? lineParts.join(", ") : "N/A"}\n`;

      // Impact Scores
      const imp = scoring.impactScores;
      if (imp) {
        output += `\n    Impact Scores:\n`;
        output += `      - Rendering:    ${imp.rendering.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Hydration:    ${imp.hydration.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Bundle Size:  ${(imp.bundle || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `      - Security:     ${imp.security.toFixed(1).padStart(4)} / 10\n`;
        output += `      - Cache:        ${(imp.cache || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `      - Runtime:      ${(imp.runtime || 0).toFixed(1).padStart(4)} / 10\n`;
        output += `\n    ${severityColor}Overall Severity:  ${displayLevel} (${scoring.score.toFixed(2)})\x1b[0m\n`;
      } else {
        output += `    Severity Rating:   ${displayLevel} (${scoring.score.toFixed(2)})\n`;
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
      if (boundaryLabel === "Streaming Opportunity") {
        output += `      Streaming compliance:\n`;
        output += `        Opportunity — ${causeText}\n`;
      } else {
        output += `      Boundary compliance:\n`;
        output += `        Violates ${boundaryLabel} — ${causeText}\n`;
      }

      if (spec?.fix) {
        output += `\n    Fix Recommendations:\n`;
        const fc = spec.fix.confidence;
        if (fc) {
          const fcColor =
            fc === "HIGH"   ? "\x1b[32m" :
            fc === "MEDIUM" ? "\x1b[33m" :
                              "\x1b[31m";
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

  // 2c. Numbered Fix Order Priority section
  interface FixOrderItem {
    file: string;
    ruleId: string;
    message: string;
    targetLine: number;
    displayLevel: "BLOCKER" | "WARNING" | "INFO";
    primaryFix?: string;
    effort: number;
    impact: "Huge" | "Medium" | "Small";
    roiScore: number;
    severityScore: number;
  }

  const fixOrderItems: FixOrderItem[] = [];
  for (const group of groupedDiagnostics) {
    for (const rule of group.rules) {
      const dl = rule.precomputed.displayLevel;

      const normPath = group.file.replace(/\\/g, "/");
      const appIdx = normPath.indexOf("/app/");
      let layoutDepth = 0;
      if (appIdx !== -1) {
        const relPath = normPath.substring(appIdx + 5);
        const segments = relPath.split("/").filter((s) => s.length > 0);
        layoutDepth = segments
          .slice(0, -1)
          .filter((s) => !s.startsWith("(") && !s.startsWith("@")).length;
      }
      const auditMeta = getRuleAuditMetadata(rule.ruleId, rule.precomputed.scoring.level, {
        fetchCount: rule.diagnostics[0]?.fetchCount,
        isWaterfall: rule.diagnostics[0]?.isWaterfall,
        layoutDepth,
      });

      const impactValue =
        auditMeta.impact === "Huge" ? 10.0 :
        auditMeta.impact === "Medium" ? 5.0 :
        2.0;
      const roiScore = impactValue / auditMeta.effort;

      fixOrderItems.push({
        file: group.file,
        ruleId: rule.ruleId,
        message: rule.message,
        targetLine: rule.precomputed.targetLine,
        displayLevel: dl,
        primaryFix: rule.precomputed.primaryFix,
        effort: auditMeta.effort,
        impact: auditMeta.impact,
        roiScore,
        severityScore: rule.precomputed.scoring.score,
      });
    }
  }

  fixOrderItems.sort((a, b) => {
    if (b.roiScore !== a.roiScore) {
      return b.roiScore - a.roiScore;
    }
    if (b.severityScore !== a.severityScore) {
      return b.severityScore - a.severityScore;
    }
    const rankA = getFileRank(a.file);
    const rankB = getFileRank(b.file);
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    const fileCompare = a.file.localeCompare(b.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }
    return a.targetLine - b.targetLine;
  });

  output += `\n\x1b[1m=========================================\n`;
  output += `🛠️ RECOMMENDED FIX ORDER PRIORITY\n`;
  output += `=========================================\x1b[0m\n`;

  if (fixOrderItems.length === 0) {
    output += `No fixes required.\n`;
  } else {
    fixOrderItems.forEach((item, index) => {
      let emoji = "🔵 [INFO]";
      let color = "\x1b[36m";
      if (item.displayLevel === "BLOCKER") {
        emoji = "🔴 [BLOCKER]";
        color = "\x1b[31m";
      } else if (item.displayLevel === "WARNING") {
        emoji = "🟡 [WARNING]";
        color = "\x1b[33m";
      }

      output += `${index + 1}. ${color}${emoji}\x1b[0m \x1b[1m${item.file}:${item.targetLine}\x1b[0m — ${item.ruleId}\n`;
      output += `   👉 \x1b[2m${item.message}\x1b[0m\n`;
      output += `   📈 \x1b[32mROI Score: ${item.roiScore.toFixed(2)} (Impact: ${item.impact}, Effort: ${item.effort}m)\x1b[0m\n`;
      if (item.primaryFix) {
        output += `   💡 Fix: ${item.primaryFix.trim()}\n`;
      } else {
        output += `   💡 Fix: Review rule specifications for details.\n`;
      }
      output += `\n`;
    });
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

      if (spec) {
        let finalScore = scoring.score;
        if (d.id === "RO-005") {
          finalScore = applyContextualScoreOverride(d.id, finalScore, {
            fetchCount: d.fetchCount,
            isWaterfall: d.isWaterfall,
          });
        } else if (d.id === "RO-006") {
          finalScore = applyContextualScoreOverride(d.id, finalScore, {
            isCriticalLayoutPath: (d as any).isCriticalLayoutPath,
          });
        } else if (d.id === "DYNAMIC_LAYOUT_IMPACT") {
          const normFile = filePath.replace(/\\/g, "/");
          const appIdx = normFile.indexOf("/app/");
          let layoutDepth = 0;
          if (appIdx !== -1) {
            const relPath = normFile.substring(appIdx + 5);
            const segments = relPath.split("/").filter(s => s.length > 0);
            layoutDepth = segments.slice(0, -1).filter(
              s => !s.startsWith("(") && !s.startsWith("@")
            ).length;
          }
          finalScore = applyContextualScoreOverride(d.id, finalScore, { layoutDepth });
        }
        scoring.score = finalScore;
      }

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
