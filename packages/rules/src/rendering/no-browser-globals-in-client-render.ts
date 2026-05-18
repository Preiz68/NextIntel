import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: hydration-no-browser-globals-in-render
 *
 * Detection logic: unchanged deterministic AST check on browserAPIs metadata
 * for Client Components.
 *
 * Semantics (hydration explanation, risks, deferred-execution guidance):
 * sourced entirely from the "Hydration" knowledge pack constraint HY-001
 * (Server and Client render output must match on first render).
 */
export const noBrowserGlobalsInClientRender: Rule = {
  id: "hydration-no-browser-globals-in-render",

  meta: {
    description:
      "Detects browser APIs used in the top-level render body of a Client Component that can cause hydration mismatches.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge for this rule ──────────────────────────────
    const constraint = context.knowledgeRegistry.getConstraint("hydration", "HY-001");

    const whyItMatters = constraint?.whyItMatters ?? "Server and Client render output must match on first render.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      // Only applies to Client Components — Server Components have a separate rule.
      if (!analysis.isClientComponent) continue;

      for (const apiUsage of analysis.browserAPIs) {
        diagnostics.push({
          file: analysis.filePath,
          line: apiUsage.line,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "HY-001",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Browser API '${apiUsage.api}' is accessed during the top-level render of a Client Component. ${constraint?.problem ?? ""}`,

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
