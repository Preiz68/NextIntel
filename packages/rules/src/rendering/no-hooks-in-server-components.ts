import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: no-hooks-in-server-components
 *
 * Detection logic: unchanged deterministic AST check.
 * Semantics (forbidden hook list, fixes, guidance): sourced entirely from
 * the "Server Components" knowledge pack constraint SC-002.
 */
export const noHooksInServerComponents: Rule = {
  id: "no-hooks-in-server-components",

  meta: {
    description: "React hooks can only be used in Client Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge for this rule ──────────────────────────────
    const constraint = context.knowledgeRegistry.getConstraint("server-components", "SC-002");
    
    const whyItMatters = constraint?.whyItMatters ?? "React hooks require a client runtime context.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      if (!analysis.isServerComponent || analysis.hookDetails.length === 0)
        continue;

      for (const hook of analysis.hookDetails) {
        // If the knowledge pack has a forbidden-patterns list, validate the
        // detected hook against it so future hook additions to the pack are
        // automatically enforced.
        const isForbidden =
          !constraint?.forbiddenPatterns.length ||
          constraint.forbiddenPatterns.some((p) =>
            hook.name.includes(p.replace(/[()]/g, ""))
          );

        if (!isForbidden) continue;

        diagnostics.push({
          file: analysis.filePath,
          line: hook.line,
          severity: constraint?.severity ?? "error",
          ruleId: this.id,
          id: constraint?.id ?? "SC-002",

          // ── Core message dynamically constructed from constraint ─────────
          message: `React hook '${hook.name}' is used in a Server Component. ${constraint?.problem ?? ""}`,

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
