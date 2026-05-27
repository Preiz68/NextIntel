import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: streaming-suspense-boundaries
 *
 * Detection logic: Deterministically detects calling cookies() or headers()
 * inside layout files via `analysis.rendering.triggers` tracking, which blocks static shell streaming.
 *
 * Semantics: Sourced from "Streaming" knowledge pack constraint ST-002.
 */
export const streamingSuspenseBoundaries: Rule = {
  id: "streaming-suspense-boundaries",

  meta: {
    description: "Avoid dynamic request-time APIs blocking initial layout streaming.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("streaming", "ST-002");

    const whyItMatters = constraint?.whyItMatters ?? "Calling cookies() or headers() inside a root layout block forces the layout into dynamic on-demand rendering.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      const isLayout = normalizedPath.endsWith("/layout.tsx") || normalizedPath.endsWith("/layout.jsx") || normalizedPath.endsWith("/layout.js");

      if (!isLayout) continue;

      const hasBlockingTrigger = analysis.executionModel.usesServerApis.some((api: string) => api.includes("cookies") || api.includes("headers"));

      if (hasBlockingTrigger) {
        diagnostics.push({
          file: analysis.filePath,
          severity: constraint?.severity ?? "error",
          ruleId: this.id,
          id: constraint?.id ?? "ST-002",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Dynamic request-time API call detected in layout file. ${constraint?.problem ?? ""}`,

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
