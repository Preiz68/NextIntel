import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: no-browser-api-in-server-components
 *
 * Detection logic: unchanged deterministic AST check.
 * Semantics (forbidden API list, fixes, guidance): sourced entirely from
 * the "Server Components" knowledge pack constraint SC-001.
 */
export const noBrowserApiInServerComponents: Rule = {
  id: "no-browser-api-in-server-components",

  meta: {
    description:
      "Browser APIs (window, document, localStorage, etc.) cannot be used in Server Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge for this rule ──────────────────────────────
    const constraint = context.knowledgeRegistry.getConstraint("server-components", "SC-001");

    const whyItMatters = constraint?.whyItMatters ?? "Browser APIs are not available during server-side rendering.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      if (!analysis.isServerComponent || !analysis.usesBrowserAPI) continue;

      for (const b of analysis.browserAPIs) {
        diagnostics.push({
          file: analysis.filePath,
          line: b.line,
          severity: constraint?.severity ?? "error",
          ruleId: this.id,
          id: constraint?.id ?? "SC-001",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Browser API '${b.api}' is used in a Server Component. ${constraint?.problem ?? ""}`,

          // ── Legacy fix (preserved for backward compat) ───────────────────
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
