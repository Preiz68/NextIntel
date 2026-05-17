import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: no-unoptimized-fetch
 * Checks for fetch() calls in Server Components that don't specify a cache policy.
 */
export const noUnoptimizedFetch: Rule = {
  id: "perf-no-unoptimized-fetch",
  meta: {
    description: "Detects unoptimized fetch calls in Server Components.",
    severity: "warning",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      // Only apply to Server Components
      if (analysis.isClientComponent) continue;

      for (const f of analysis.fetchCalls) {
        // If it's a fetch and has no cache/revalidate options
        if (!f.hasCacheConfig && !f.hasRevalidate) {
          diagnostics.push({
            ruleId: this.id,
            message: `Unoptimized fetch detected. In Server Components, consider adding { cache: 'force-cache' } or { next: { revalidate: ... } } for better performance.`,
            severity: "warning",
            file: analysis.filePath,
            line: f.line,
          });
        }
      }
    }

    return diagnostics;
  },
};
