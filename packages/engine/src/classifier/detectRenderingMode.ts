import type { RenderingSemantics, DynamicTrigger } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import fs from "node:fs";

/**
 * Determines the rendering mode (static, dynamic, isr, etc.) based on
 * AST analysis, fetch calls, and segment configuration properties.
 */
export function detectRenderingMode(analysis: FileAnalysis): RenderingSemantics {
  const triggers: DynamicTrigger[] = [];
  let hasGenerateStaticParams = false;
  let revalidate: RenderingSemantics["revalidate"] = null;
  let segmentDynamic: string | null = null;

  // Check for Next.js dynamic triggers in imports
  if (analysis.imports.some(imp => imp.includes("next/headers"))) {
    triggers.push("cookies");
    triggers.push("headers");
  }
  
  if (analysis.exports.includes("generateStaticParams")) {
    hasGenerateStaticParams = true;
  }

  // Parse page-level segment configurations from file content
  if (fs.existsSync(analysis.filePath)) {
    try {
      const content = fs.readFileSync(analysis.filePath, "utf8");
      
      const revalMatch = content.match(/export\s+const\s+revalidate\s*=\s*(\d+|false|['"]force-cache['"])/);
      if (revalMatch && revalMatch[1]) {
        const val = revalMatch[1].replace(/['"]/g, "");
        if (val === "false") {
          revalidate = false;
        } else if (val === "force-cache") {
          revalidate = "force-cache";
        } else {
          revalidate = Number(val);
        }
      }

      const dynMatch = content.match(/export\s+const\s+dynamic\s*=\s*['"](force-static|force-dynamic|error|auto)['"]/);
      if (dynMatch && dynMatch[1]) {
        segmentDynamic = dynMatch[1];
        if (segmentDynamic === "force-dynamic") {
          triggers.push("force-dynamic");
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Check fetch calls for cache: 'no-store' or revalidate: 0
  for (const f of analysis.fetchCalls) {
    if (f.cacheValue === "no-store") {
      triggers.push("noStore");
    }
    if (f.revalidateValue === 0 || f.revalidateValue === "0") {
      triggers.push("noStore");
    }
  }

  let mode: RenderingSemantics["mode"] = "static";
  let hasConflictingDeclarations = false;

  // Conflicting caching intent check
  if (segmentDynamic === "force-static" && triggers.length > 0) {
    mode = "conflicting-cache-intent";
    hasConflictingDeclarations = true;
  } else if (
    (triggers.includes("noStore") || triggers.includes("force-dynamic")) && 
    revalidate !== null && 
    typeof revalidate === "number" && 
    revalidate > 0
  ) {
    mode = "conflicting-cache-intent";
    hasConflictingDeclarations = true;
  } else if (triggers.length > 0) {
    mode = "dynamic";
  } else if (revalidate !== null && typeof revalidate === "number" && revalidate > 0) {
    mode = "isr";
  }

  return {
    mode,
    triggers,
    revalidate,
    hasGenerateStaticParams,
    hasConflictingDeclarations,
  };
}
