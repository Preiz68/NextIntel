import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: middleware-runtime-constraints
 *
 * Detection logic: Deterministically detects middleware files that lack
 * a matcher `config` export, which causes them to intercept all static asset requests.
 *
 * Semantics: Sourced from "Middleware" knowledge pack constraint MW-002.
 */
export const middlewareRuntimeConstraints: Rule = {
  id: "middleware-runtime-constraints",

  meta: {
    description: "Strictly configure Middleware matcher to ignore static assets.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("middleware", "MW-002");

    const whyItMatters = constraint?.whyItMatters ?? "Omitting a strict matcher configuration in middleware forces it to execute on every single static asset load.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      const isMiddleware = analysis.semanticKind === "middleware" || normalizedPath.endsWith("/middleware.ts") || normalizedPath.endsWith("/middleware.js");

      if (!isMiddleware) continue;

      const exportsConfig = analysis.exports.includes("config");

      if (!exportsConfig) {
        diagnostics.push({
          file: analysis.filePath,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "MW-002",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Middleware is missing the 'config' matcher export. ${constraint?.problem ?? ""}`,

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
