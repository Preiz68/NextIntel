import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: routing-valid-files
 *
 * Detection logic: Deterministically checks for the co-location of both page files
 * and route handlers in the exact same directory segment, which crashes the build.
 *
 * Semantics: Sourced from "Routing" knowledge pack constraint RO-002.
 */
export const routingValidFiles: Rule = {
  id: "routing-valid-files",

  meta: {
    description: "Prevent co-location of Route Handlers and Pages in the same directory segment.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("routing", "RO-002");

    const whyItMatters = constraint?.whyItMatters ?? "A route folder cannot contain both a page and a route handler.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    const dirMap = new Map<string, { page?: string; route?: string }>();

    for (const analysis of context.analyses) {
      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      const lastSlashIdx = normalizedPath.lastIndexOf("/");
      if (lastSlashIdx === -1) continue;

      const dir = normalizedPath.substring(0, lastSlashIdx);

      let entry = dirMap.get(dir);
      if (!entry) {
        entry = {};
        dirMap.set(dir, entry);
      }

      if (
        normalizedPath.endsWith("/page.tsx") ||
        normalizedPath.endsWith("/page.jsx") ||
        normalizedPath.endsWith("/page.js")
      ) {
        entry.page = analysis.filePath;
      } else if (
        normalizedPath.endsWith("/route.ts") ||
        normalizedPath.endsWith("/route.js")
      ) {
        entry.route = analysis.filePath;
      }
    }

    for (const [dir, entry] of dirMap.entries()) {
      if (entry.page && entry.route) {
        diagnostics.push({
          file: entry.page,
          severity: constraint?.severity ?? "error",
          ruleId: this.id,
          id: constraint?.id ?? "RO-002",

          // ── Core message dynamically constructed from constraint ─────────
          message: `Co-located Page and Route Handler detected at ${dir}. ${constraint?.problem ?? ""}`,

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
