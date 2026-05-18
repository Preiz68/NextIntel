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
    const constraint = context.knowledgeRegistry.getConstraintById("HY-001");

    for (const analysis of context.analyses) {
      // Only applies to Client Components — Server Components have a separate rule.
      if (!analysis.isClientComponent) continue;

      for (const apiUsage of analysis.browserAPIs) {
        diagnostics.push({
          file: analysis.filePath,
          line: apiUsage.line,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,

          // ── Core message ──────────────────────────────────────────────────
          message: `Browser API '${apiUsage.api}' is accessed during the top-level render of a Client Component. The server pre-renders this component without browser context, so the output will differ from the initial client render, causing a hydration mismatch.`,

          // ── Legacy fix (preserved for backward compat) ────────────────────
          fix:
            constraint?.quickFixes[0] ??
            "Move the browser API access into a useEffect callback to ensure it only runs after hydration.",

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
