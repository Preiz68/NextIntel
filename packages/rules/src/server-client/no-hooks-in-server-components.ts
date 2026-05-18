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
    const constraint = context.knowledgeRegistry.getConstraintById("SC-002");

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

          // ── Core message ─────────────────────────────────────────────────
          message: `React hook '${hook.name}' is used in a Server Component. Hooks require the React client runtime and cannot run during the server-side RSC render pass.`,

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
