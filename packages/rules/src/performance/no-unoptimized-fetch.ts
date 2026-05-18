import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: perf-no-unoptimized-fetch
 *
 * Detection logic: unchanged deterministic AST check on fetchCalls metadata
 * for Server Components.
 *
 * Semantics (performance recommendations, server-first architecture guidance,
 * async data fetching patterns): sourced from:
 *   • "Performance"    knowledge pack constraint PF-001 (minimise client JS)
 *   • "Data Fetching"  knowledge pack constraint DF-001 (fetch in Server Components)
 *
 * Both constraint domains are merged: DF-001 explains WHY to fetch server-side,
 * PF-001 explains the bundle/performance impact of doing otherwise.
 */
export const noUnoptimizedFetch: Rule = {
  id: "perf-no-unoptimized-fetch",

  meta: {
    description:
      "Detects fetch() calls in Server Components that are missing explicit cache or revalidate options.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge from two complementary domains ─────────────
    const perfConstraint =
      context.knowledgeRegistry.getConstraintById("PF-001");
    const dataConstraint =
      context.knowledgeRegistry.getConstraintById("DF-001");

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

    const quickFixes = mergeUnique(
      dataConstraint?.quickFixes,
      perfConstraint?.quickFixes
    );
    const architectureSuggestions = mergeUnique(
      dataConstraint?.architectureSuggestions,
      perfConstraint?.architectureSuggestions
    );
    const optimizationGuidance = mergeUnique(
      dataConstraint?.optimizationGuidance,
      perfConstraint?.optimizationGuidance
    );
    const productionRisks = mergeUnique(
      dataConstraint?.productionRisks,
      perfConstraint?.productionRisks
    );

    for (const analysis of context.analyses) {
      // Only applies to Server Components — client-side fetching is handled
      // separately by the data-fetching rule domain.
      if (analysis.isClientComponent) continue;

      for (const f of analysis.fetchCalls) {
        if (f.hasCacheConfig || f.hasRevalidate) continue;

        diagnostics.push({
          file: analysis.filePath,
          line: f.line,
          severity: "warning",
          ruleId: this.id,

          // ── Core message ──────────────────────────────────────────────────
          message:
            "Unoptimized fetch() detected in a Server Component. Without { cache: 'force-cache' } or { next: { revalidate: N } }, this fetch runs on every request, increasing upstream load and preventing prerendering.",

          // ── Legacy fix (preserved for backward compat) ────────────────────
          fix:
            quickFixes[0] ??
            "Add { next: { revalidate: 3600 } } or { cache: 'force-cache' } to the fetch() call.",

          // ── Knowledge-enriched fields (merged from perf + data-fetching) ──
          whyItMatters: dataConstraint?.whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: dataConstraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
