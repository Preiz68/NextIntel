import type { SemanticFileAnalysis } from "../classifier/types.js";

/**
 * Knowledge Integration Boundary
 *
 * This function evaluates the semantic metadata of a file and attaches the IDs
 * of violated constraints. It DOES NOT generate the human-readable diagnostic text
 * or quick fixes — that is the responsibility of the downstream Rules layer
 * querying the central Knowledge Registry.
 */
export function attachConstraints(analysis: Omit<SemanticFileAnalysis, "violatedConstraints">): string[] {
  const violatedConstraints: string[] = [];

  // -------------------------------------------------------------------------
  // Server Components (SC-*)
  // -------------------------------------------------------------------------
  
  if (analysis.semanticKind === "server-component" || analysis.semanticKind === "page" || analysis.semanticKind === "layout") {
    if (analysis.runtime !== "client") { // Extra guard
      // SC-001: No Browser APIs
      if (analysis.hydration.hydrationRisks.length > 0 || analysis.browserAPIs.length > 0) {
        violatedConstraints.push("SC-001");
      }
      
      // SC-002: No React Hooks (that are not useId/use)
      if (analysis.hookDetails.length > 0) {
        // Technically, `useId` and `use` are allowed, but we leave the strict 
        // filtering to the specific rules layer or assume generic hooks are a violation.
        violatedConstraints.push("SC-002");
      }
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
  
  // HY-001: Browser APIs in top-level render of Client Components
  if (analysis.hydration.isHydrationBoundary && !analysis.hydration.hasRenderSafeBrowserApis) {
    violatedConstraints.push("HY-001");
  }

  // -------------------------------------------------------------------------
  // Data Fetching & Performance (DF-*, PF-*, CA-*)
  // -------------------------------------------------------------------------

  if (analysis.runtime !== "client") {
    const hasUnoptimizedFetch = analysis.fetchCalls.some(f => f.cacheStrategy === "implicit-dynamic");
    if (hasUnoptimizedFetch) {
      violatedConstraints.push("PF-001");
      violatedConstraints.push("DF-001");
      violatedConstraints.push("CA-001");
    }
  }

  // Note: CC-003 and SC-004 (Client imports Server) are graph-level constraints,
  // so they are not evaluated on a per-file basis here. They belong in graph validation.

  // Deduplicate just in case
  return Array.from(new Set(violatedConstraints));
}
