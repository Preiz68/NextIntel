import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: rendering-require-generate-static-params
 *
 * Detection logic: deterministic check to see if a dynamic route segment
 * (indicated by a '[' in the file path, typically a page.tsx) exports a
 * generateStaticParams function.
 *
 * Semantics: sourced from the "Rendering" knowledge pack constraint RE-003.
 */
export const requireGenerateStaticParams: Rule = {
  id: "rendering-require-generate-static-params",

  meta: {
    description:
      "Dynamic route segments should export generateStaticParams to enable static rendering.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // ── Fetch semantic knowledge for this rule ──────────────────────────────
    const constraint = context.knowledgeRegistry.getConstraint("rendering", "RE-003");

    const whyItMatters = constraint?.whyItMatters ?? "Dynamic route segments should export generateStaticParams to enable static rendering.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      // We only care about page components that are Server Components
      if (analysis.isClientComponent) continue;

      const normalizedPath = analysis.filePath.replace(/\\/g, "/");

      // Check if it's a page component inside a dynamic segment (e.g., app/blog/[id]/page.tsx)
      const isPage = normalizedPath.endsWith("/page.tsx") || normalizedPath.endsWith("/page.jsx") || normalizedPath.endsWith("/page.js");
      const isDynamicSegment = normalizedPath.includes("/[") || normalizedPath.includes("\\[");

      if (!isPage || !isDynamicSegment) continue;

      // Check if generateStaticParams is exported
      const hasGenerateStaticParams = analysis.exports.includes("generateStaticParams");
      
      if (!hasGenerateStaticParams) {
        diagnostics.push({
          file: analysis.filePath,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "RE-003",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Dynamic route segment is missing generateStaticParams(). ${constraint?.problem ?? ""}`,

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
