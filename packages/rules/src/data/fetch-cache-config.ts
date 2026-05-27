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
    const constraint = context.knowledgeRegistry.getConstraint("caching", "DYNAMIC_RENDER_TRIGGER-001");

    const whyItMatters = constraint?.whyItMatters ?? "Explicit cache configurations ensure reproducible rendering behavior.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      // Data caching only applies to Server Components, Route Handlers, and
      // Server Actions — not Client Components.
      if (analysis.executionModel.componentType === "client") continue;

      const { fetchStrategy } = analysis.executionModel;
      if (fetchStrategy.hasFetch && fetchStrategy.cacheMode === null && fetchStrategy.revalidate === null) {
        diagnostics.push({
          file: analysis.filePath,
          line: analysis.fetchCalls[0]?.line,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-001",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Implicit fetch caching detected. ${constraint?.problem ?? ""}`,

          // ── Legacy fix (preserved for backward compat) ────────────────────
          fix: quickFixes[0],

          // ── Knowledge-enriched fields ─────────────────────────────────────
          whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: constraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
