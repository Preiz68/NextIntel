import type { FetchCall } from "../analyzer/types.js";
import type { EnhancedFetchCall } from "../classifier/types.js";

/**
 * Maps the raw AST FetchCall to an EnhancedFetchCall containing
 * Next.js caching strategies and rendering implications.
 */
export function evaluateFetchSemantics(
  fetchCalls: FetchCall[],
  isClientComponent: boolean
): EnhancedFetchCall[] {
  return fetchCalls.map((f) => {
    let cacheStrategy: EnhancedFetchCall["cacheStrategy"] = "implicit-dynamic";
    let implication: EnhancedFetchCall["renderingImplication"] = "dynamic-escalation";

    if (f.cacheValue === "force-cache") {
      cacheStrategy = "force-cache";
      implication = "safe-static";
    } else if (f.cacheValue === "no-store") {
      cacheStrategy = "no-store";
      implication = "blocks-static-prerender";
    } else if (f.hasRevalidate && f.revalidateValue !== undefined) {
      cacheStrategy = "revalidate";
      // If it revalidates, it doesn't block the initial static prerender
      implication = "safe-static"; 
    }

    return {
      line: f.line,
      url: f.isDynamic ? "dynamic" : "static",
      cacheStrategy,
      revalidateValue: f.revalidateValue,
      renderingImplication: implication,
    };
  });
}
