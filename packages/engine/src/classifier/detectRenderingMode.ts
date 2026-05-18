import type { RenderingSemantics, DynamicTrigger } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";

/**
 * Determines the rendering mode (static vs dynamic) based on imported
 * modules, exported configs, and dynamic triggers.
 */
export function detectRenderingMode(analysis: FileAnalysis): RenderingSemantics {
  const triggers: DynamicTrigger[] = [];
  let hasGenerateStaticParams = false;

  // Check for Next.js dynamic triggers in imports/exports
  if (analysis.imports.some(imp => imp.includes("next/headers"))) {
    triggers.push("cookies");
    triggers.push("headers");
  }
  
  if (analysis.exports.includes("generateStaticParams")) {
    hasGenerateStaticParams = true;
  }

  // Check fetch calls for cache: 'no-store'
  for (const f of analysis.fetchCalls) {
    if (f.cacheValue === "no-store") {
      triggers.push("noStore");
    }
  }

  // Without AST value extraction for `export const dynamic = 'force-dynamic'`,
  // we rely on the imports and fetch behaviors extracted.
  let mode: RenderingSemantics["mode"] = "static";

  if (triggers.length > 0) {
    mode = "dynamic";
  }

  return {
    mode,
    triggers,
    revalidate: false, // Default unless 'revalidate' export is parsed
    hasGenerateStaticParams,
  };
}
