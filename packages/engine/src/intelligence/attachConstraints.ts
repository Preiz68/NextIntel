import type { SemanticFileAnalysis } from "../classifier/types.js";

/**
 * Knowledge Integration Boundary
 *
 * This function evaluates the semantic metadata of a file and attaches the IDs
 * of violated constraints. It maps framework classifications and boundaries
 * to central Knowledge Pack constraint rules.
 */
export function attachConstraints(analysis: Omit<SemanticFileAnalysis, "violatedConstraints">): string[] {
  const violatedConstraints: string[] = [];

  // -------------------------------------------------------------------------
  // Server Components (SC-*)
  // -------------------------------------------------------------------------
  
  if (analysis.semanticKind === "server-component" || analysis.semanticKind === "page" || analysis.semanticKind === "layout") {
    // SC-001: No Browser APIs inside Server Components
    if (analysis.browserAPIs && analysis.browserAPIs.length > 0) {
      violatedConstraints.push("SC-001");
    }
    
    // SC-002: No React Hooks inside Server Components
    if (analysis.hookDetails && analysis.hookDetails.length > 0) {
      violatedConstraints.push("SC-002");
    }

    if (analysis.boundaries.hasClientHooksInServer) {
      violatedConstraints.push("SC-002");
    }
  }

  // -------------------------------------------------------------------------
  // Client Components (CC-*)
  // -------------------------------------------------------------------------

  if (analysis.semanticKind === "client-component") {
    // CC-001: 'use client' boundary pulls server-only modules
    if (analysis.boundaries.hasServerOnlyApisInClient || analysis.boundaries.overHydrationRisk) {
      violatedConstraints.push("CC-001");
    }

    // CC-003: Async Client Component is invalid
    if (analysis.boundaries.hasAsyncClientComponent) {
      violatedConstraints.push("CC-003");
    }
  }

  // -------------------------------------------------------------------------
  // Rendering (RE-*)
  // -------------------------------------------------------------------------
  
  // RE-003: Dynamic Route Segments Require generateStaticParams
  if (analysis.semanticKind === "page" && analysis.runtime !== "client") {
    const isDynamicSegment = analysis.filePath.replace(/\\/g, "/").includes("/[");
    if (isDynamicSegment && !analysis.rendering.hasGenerateStaticParams) {
      violatedConstraints.push("RE-003");
    }
  }

  // -------------------------------------------------------------------------
  // Hydration (HY-*)
  // -------------------------------------------------------------------------
  
  // HY-001: Non-deterministic render expressions or unguarded browser APIs
  if (analysis.hydration.riskLevel === "high") {
    violatedConstraints.push("HY-001");
  }

  if (analysis.hydration.isHydrationBoundary && !analysis.hydration.hasRenderSafeBrowserApis) {
    violatedConstraints.push("HY-001");
  }

  // -------------------------------------------------------------------------
  // Data Fetching & Caching (DF-*, PF-*, CA-*)
  // -------------------------------------------------------------------------

  if (analysis.runtime !== "client") {
    const hasUnoptimizedFetch = analysis.fetchCalls.some(f => f.cacheStrategy === "implicit-dynamic");
    if (hasUnoptimizedFetch) {
      violatedConstraints.push("PF-001");
      violatedConstraints.push("DF-001");
      violatedConstraints.push("CA-001");
    }
  }

  // CA-005 / Caching conflict: Conflicting revalidate/dynamic configs
  if (analysis.rendering.mode === "conflicting-cache-intent" || analysis.rendering.hasConflictingDeclarations) {
    violatedConstraints.push("CA-005");
  }

  return Array.from(new Set(violatedConstraints));
}
