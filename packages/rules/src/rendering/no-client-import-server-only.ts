import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: no-client-import-server-only
 *
 * Detection logic: unchanged deterministic graph edge traversal.
 * Semantics: sourced from two complementary domains:
 *   • "Server Components" constraint SC-004 (Environment Variable Exposure / server boundary enforcement).
 *   • "Client Components" constraint CC-003 (Server Components Must Not Be Imported into Client Components).
 */
export const noClientImportServerOnly: Rule = {
  id: "no-client-import-server-only",

  meta: {
    description:
      "Client Components cannot import Server Components or server-only modules directly.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge from two complementary domains ─────────────
    const scConstraint = context.knowledgeRegistry.getConstraint("server-components", "SC-004");
    const ccConstraint = context.knowledgeRegistry.getConstraint("client-components", "CC-003");

    // Merge guidance from both domains — deduplicate by string content
    const mergeUnique = (...arrays: (string[] | undefined)[]): string[] => {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const arr of arrays) {
        for (const item of arr ?? []) {
          if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
          }
        }
      }
      return result;
    };

    const quickFixes = mergeUnique(ccConstraint?.quickFixes, scConstraint?.quickFixes);
    const architectureSuggestions = mergeUnique(ccConstraint?.architectureSuggestions, scConstraint?.architectureSuggestions);
    const optimizationGuidance = mergeUnique(ccConstraint?.optimizationGuidance, scConstraint?.optimizationGuidance);
    const productionRisks = mergeUnique(ccConstraint?.productionRisks, scConstraint?.productionRisks);

    const whyItMatters = ccConstraint?.whyItMatters ?? scConstraint?.whyItMatters ?? "Server modules cannot be directly imported in Client Components.";

    for (const edge of (context as any).edges || []) {
      const fromNode = context.nodes.get(edge.from);
      const toNode = context.nodes.get(edge.to);

      if (!fromNode?.isClientComponent || !toNode?.isServerComponent) continue;

      // In Next.js, importing a 'use server' file in a 'use client' file
      // is allowed for Server Actions, but rendering a Server Component inside
      // a Client Component by direct import is NOT allowed.
      diagnostics.push({
        file: edge.from,
        severity: ccConstraint?.severity ?? scConstraint?.severity ?? "error",
        ruleId: this.id,
        id: ccConstraint?.id ?? "CC-003",

        // ── Core message dynamically constructed from constraint ─────────
        message: `Client Component '${edge.from}' imports Server Component/Module '${edge.to}'. ${ccConstraint?.problem ?? ""}`,

        // ── Legacy fix (preserved for backward compat) ─────────────────────
        fix: quickFixes[0],

        // ── Knowledge-enriched fields ───────────────────────────────────────
        whyItMatters,
        quickFixes,
        architectureSuggestions,
        optimizationGuidance,
        productionRisks,
        examples: ccConstraint?.examples,
      });
    }

    return diagnostics;
  },
};
