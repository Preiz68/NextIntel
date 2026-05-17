import { Rule, RuleContext, Diagnostic } from "../types.js";

export const fetchCacheConfig: Rule = {
  id: "fetch-cache-config",
  meta: {
    description:
      "Fetch calls in Next.js should have explicit cache or revalidate configuration.",
    severity: "warning",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      // Data caching only applies to Server Components, Route Handlers, and Server Actions
      if (analysis.isClientComponent) continue;

      for (const fetchCall of analysis.fetchCalls) {
        if (!fetchCall.hasCacheConfig && !fetchCall.hasRevalidate) {
          diagnostics.push({
            file: analysis.filePath,
            severity: "warning",
            ruleId: "fetch-cache-config",
            message:
              "Implicit fetch caching detected. Consider adding explicit { cache: '...' } or { next: { revalidate: ... } }.",
            fix: "{ cache: 'no-store' }",
            line: fetchCall.line,
          });
        }
      }
    }

    return diagnostics;
  },
};
