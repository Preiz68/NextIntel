import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: revalidation-cache-lifetime
 *
 * Detection logic: Deterministically detects low revalidation values (< 60s)
 * in layout files, which causes a mismatch boundary between the layout shell
 * and child page components.
 *
 * Semantics: Sourced from "Revalidation" knowledge pack constraint RV-002.
 */
export const revalidationCacheLifetime: Rule = {
  id: "revalidation-cache-lifetime",

  meta: {
    description:
      "Avoid using low revalidation intervals (< 60s) in layouts to prevent stale HTML mismatches.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("revalidation", "RV-002");

    const whyItMatters = constraint?.whyItMatters ?? "Synchronize child page and parent layout revalidation durations to avoid serving mismatched data states.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      if (analysis.isClientComponent) continue;

      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      const isLayout = normalizedPath.endsWith("/layout.tsx") || normalizedPath.endsWith("/layout.jsx") || normalizedPath.endsWith("/layout.js");

      if (!isLayout) continue;

      for (const fetchCall of analysis.fetchCalls) {
        // Parse the revalidate value
        let revalValue: number | null = null;
        if (typeof fetchCall.revalidateValue === "number") {
          revalValue = fetchCall.revalidateValue;
        } else if (typeof fetchCall.revalidateValue === "string") {
          const parsed = parseInt(fetchCall.revalidateValue, 10);
          if (!isNaN(parsed)) {
            revalValue = parsed;
          }
        }

        if (revalValue !== null && revalValue < 60) {
          diagnostics.push({
            file: analysis.filePath,
            line: fetchCall.line,
            severity: constraint?.severity ?? "warning",
            ruleId: this.id,
            id: constraint?.id ?? "RV-002",

            // ── Core message dynamically constructed from constraint ─────────
            message: `Extremely low revalidation interval (${revalValue}s) detected in layout. ${constraint?.problem ?? ""}`,

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
    }

    return diagnostics;
  },
};
