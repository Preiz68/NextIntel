import type { HydrationSemantics } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";

/**
 * Classifies the hydration status and risks of the file.
 */
export function detectHydration(analysis: FileAnalysis): HydrationSemantics {
  const isHydrationBoundary = analysis.isClientComponent;
  
  // If browser APIs are used in a Client Component, we consider them 
  // "safe" if they are guarded (e.g. inside useEffect), but our raw AST 
  // extraction doesn't check if they are inside useEffect.
  // For now, any top-level usage detected by `usesBrowserAPI` is flagged as a risk.
  const hasRenderSafeBrowserApis = isHydrationBoundary && !analysis.usesBrowserAPI;
  
  const hydrationRisks: string[] = [];
  if (isHydrationBoundary && analysis.usesBrowserAPI) {
    analysis.browserAPIs.forEach(api => {
      hydrationRisks.push(`Unsafe access of '${api.api}' during SSR/Hydration pass`);
    });
  }

  return {
    isHydrationBoundary,
    hasRenderSafeBrowserApis,
    hydrationRisks,
  };
}
