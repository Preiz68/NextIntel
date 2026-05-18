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
    const constraint = context.knowledgeRegistry.getConstraintById("SC-001");

    for (const analysis of context.analyses) {
      if (!analysis.isServerComponent || !analysis.usesBrowserAPI) continue;

      for (const b of analysis.browserAPIs) {
        diagnostics.push({
          file: analysis.filePath,
          line: b.line,
          severity: constraint?.severity ?? "error",
          ruleId: this.id,

          // ── Core message ─────────────────────────────────────────────────
          message: `Browser API '${b.api}' is used in a Server Component. Server Components run exclusively in the Node.js runtime — there is no browser context, DOM, or Web API available.`,

          // ── Legacy fix (preserved for backward compat) ───────────────────
          fix: constraint?.quickFixes[0] ?? `Add "use client"; at the top of the file.`,

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
