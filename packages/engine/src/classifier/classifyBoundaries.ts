import type { BoundarySemantics, SemanticKind } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import fs from "node:fs";

/**
 * Analyzes boundary pollution, client component async rendering, and over-hydration risk.
 */
export function classifyBoundaries(
  analysis: FileAnalysis,
  componentType: SemanticKind
): BoundarySemantics {
  const violations: string[] = [];

  const hasServerOnlyApis = analysis.imports.some(imp => 
    imp.includes("next/headers") || 
    imp.includes("server-only")
  );

  const hasClientHooks = analysis.hooks.length > 0;

  if (componentType === "client-component" && hasServerOnlyApis) {
    violations.push("server-api-in-client-component");
  }

  if (componentType === "server-component" && hasClientHooks) {
    violations.push("client-hook-in-server-component");
  }

  // Check if it is an async Client Component
  if (componentType === "client-component" && analysis.hasAsyncComponent) {
    violations.push("async-client-component");
  }

  // Over-hydration heuristic: check if component body has large static markup structures (> 40 JSX tags)
  let isOverHydrated = false;
  if (componentType === "client-component" && fs.existsSync(analysis.filePath)) {
    try {
      const content = fs.readFileSync(analysis.filePath, "utf8");
      const jsxTags = (content.match(/<[a-zA-Z]/g) || []).length;
      if (jsxTags > 40) {
        isOverHydrated = true;
        violations.push("over-hydration-risk");
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    hasServerOnlyApisInClient: componentType === "client-component" && hasServerOnlyApis,
    hasClientHooksInServer: componentType === "server-component" && hasClientHooks,
    hasAsyncClientComponent: componentType === "client-component" && analysis.hasAsyncComponent,
    overHydrationRisk: isOverHydrated,
    violations,
  };
}
