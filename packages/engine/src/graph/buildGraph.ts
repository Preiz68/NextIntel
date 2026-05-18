import { Graph } from "graphlib";
import path from "node:path";
import fs from "node:fs";

import type { SemanticFileAnalysis } from "../classifier/types.js";
import type { GraphEdge, GraphNode } from "./types.js";
import { EXTERNAL_MODULE_PREFIXES, KIND_PATTERNS } from "./constants.js";

// ─── Node classification ──────────────────────────────────────────────────────

function classifyKind(filePath: string): GraphNode["kind"] {
  for (const [kind, patterns] of Object.entries(KIND_PATTERNS)) {
    if (kind === "unknown") continue;
    if (patterns.some((re) => re.test(filePath))) {
      return kind as GraphNode["kind"];
    }
  }
  return "unknown";
}

/**
 * A file is a server component when:
 *   - it is a JSX/TSX file (renders UI), AND
 *   - it does NOT have a "use client" directive.
 *
 * Plain .ts utility files are neither client nor server components.
 */
function inferIsServerComponent(
  filePath: string,
  isClientComponent: boolean,
): boolean {
  if (isClientComponent) return false;
  return /\.[tj]sx$/.test(filePath);
}

// ─── Module specifier → absolute path resolution ──────────────────────────────

function resolveSpecifier(
  specifier: string,
  fromFile: string,
  projectRoot: string,
  knownFiles: Set<string>,
): string | null {
  if (
    !specifier.startsWith(".") &&
    !specifier.startsWith("/") &&
    !specifier.startsWith("@/")
  ) {
    return null;
  }

  if (EXTERNAL_MODULE_PREFIXES.some((p) => specifier.startsWith(p))) {
    return null;
  }

  const base = specifier.startsWith("@/")
    ? path.join(projectRoot, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
    path.join(base, "index.js"),
  ];

  for (const candidate of candidates) {
    const normalized = candidate.split(path.sep).join("/");
    if (knownFiles.has(normalized)) return normalized;
    if (fs.existsSync(candidate)) return candidate.split(path.sep).join("/");
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface BuildGraphResult {
  graph: Graph;
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
}

export function buildGraph(
  analyses: SemanticFileAnalysis[],
  projectRoot: string,
): BuildGraphResult {
  const graph = new Graph({
    directed: true,
    multigraph: false,
    compound: false,
  });
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  const knownFiles = new Set(analyses.map((a) => a.filePath));

  // ── 1. Register all nodes ────────────────────────────────────────────────
  for (const analysis of analyses) {
    const node: GraphNode = {
      id: analysis.filePath,
      filePath: analysis.filePath,
      isClientComponent: analysis.isClientComponent,
      isServerComponent: analysis.isServerComponent,
      hasDefaultExport: analysis.exports.includes("default"),
      kind: analysis.semanticKind as any, // preserved for backwards compatibility
      semanticKind: analysis.semanticKind,
      runtime: analysis.runtime,
      renderingMode: analysis.rendering.mode,
      isHydrationBoundary: analysis.hydration.isHydrationBoundary,
    };

    nodes.set(analysis.filePath, node);
    graph.setNode(analysis.filePath, node);
  }

  // ── 2. Register all edges ────────────────────────────────────────────────
  for (const analysis of analyses) {
    for (const importDetail of analysis.importDetails) {
      const resolved = resolveSpecifier(
        importDetail.moduleSpecifier,
        analysis.filePath,
        projectRoot,
        knownFiles,
      );

      if (!resolved) continue;

      if (!graph.hasNode(resolved)) {
        const node: GraphNode = {
          id: resolved,
          filePath: resolved,
          isClientComponent: false,
          isServerComponent: inferIsServerComponent(resolved, false),
          hasDefaultExport: false,
          kind: classifyKind(resolved),
          semanticKind: classifyKind(resolved) as any,
          runtime: "server",
          renderingMode: "static",
          isHydrationBoundary: false,
        };
        nodes.set(resolved, node);
        graph.setNode(resolved, node);
      }

      graph.setEdge(analysis.filePath, resolved);

      edges.push({
        from: analysis.filePath,
        to: resolved,
        importedNames: [
          ...importDetail.namedImports,
          ...(importDetail.defaultImport ? [importDetail.defaultImport] : []),
        ],
        isTypeOnly: importDetail.isTypeOnly,
      });
    }
  }

  return { graph, nodes, edges };
}
