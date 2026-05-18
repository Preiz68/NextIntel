import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: fetch-cache-config
 *
 * Detection logic: unchanged deterministic AST check on fetchCalls metadata.
 * Semantics (cache recommendations, rendering implications, optimisation
 * guidance): sourced entirely from the "Caching" knowledge pack constraint
 * CA-001.
 */
export const fetchCacheConfig: Rule = {
  id: "fetch-cache-config",

  meta: {
    description:
      "Fetch calls in Next.js Server Components should have explicit cache or revalidate configuration.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge for this rule ──────────────────────────────
    const constraint = context.knowledgeRegistry.getConstraintById("CA-001");

    for (const analysis of context.analyses) {
      // Data caching only applies to Server Components, Route Handlers, and
      // Server Actions — not Client Components.
      if (analysis.isClientComponent) continue;

      for (const fetchCall of analysis.fetchCalls) {
        if (fetchCall.hasCacheConfig || fetchCall.hasRevalidate) continue;

        diagnostics.push({
          file: analysis.filePath,
          line: fetchCall.line,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,

          // ── Core message ──────────────────────────────────────────────────
          message:
            "Implicit fetch caching detected. In the current Next.js model, fetch() is NOT cached by default. Add an explicit { cache: 'force-cache' } or { next: { revalidate: N } } option, or use the 'use cache' directive on the enclosing function.",

          // ── Legacy fix (preserved for backward compat) ────────────────────
          fix:
            constraint?.quickFixes[0] ??
            "Add { cache: 'force-cache' } or { next: { revalidate: 3600 } } to the fetch() call.",

          // ── Knowledge-enriched fields ─────────────────────────────────────
          whyItMatters: constraint?.whyItMatters,
          quickFixes: constraint?.quickFixes,
          architectureSuggestions: constraint?.architectureSuggestions,
          optimizationGuidance: constraint?.optimizationGuidance,
          productionRisks: constraint?.productionRisks,
          examples: constraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
