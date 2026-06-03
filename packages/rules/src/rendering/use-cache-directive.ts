import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";

export const useCacheDirective: Rule = {
  id: "rendering-use-cache-directive",

  meta: {
    description: "Server-side data fetches or database queries can leverage the Next.js 15 'use cache' directive for component-level caching.",
    severity: "info",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("rendering", "RE-005");
    const whyItMatters = constraint?.whyItMatters ?? "Using Next.js 15 'use cache' enables memoization of outputs for expensive data-fetching functions.";
    const quickFixes = constraint?.quickFixes ?? ["Add the 'use cache' directive at the top of the function or component body."];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel?.componentType !== "client";
      if (!isServer) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // Strip comments to avoid false-positives matching comment text
      const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

      const hasUseCache = /['"]use cache['"]/.test(contentWithoutComments);
      const hasUnstableCache = contentWithoutComments.includes("unstable_cache");
      if (hasUseCache || hasUnstableCache) continue; // Already cached!

      const performsDataFetch = 
        analysis.fetchCalls.length > 0 || 
        analysis.executionModel?.fetchStrategy?.hasFetch ||
        /\b(db\.\w+|prisma\.\w+|drizzle\.\w+)\b/.test(content);

      if (performsDataFetch) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "info",
          ruleId: this.id,
          id: "RE-005",
          message: `Leverage Next.js 15 'use cache' for Component Caching: This Server Component or database wrapper performs fetches or queries but does not use component-level caching. Consider adding the 'use cache' directive to cache its output.`,
          fix: quickFixes[0],
          whyItMatters,
          quickFixes,
          architectureSuggestions: constraint?.architectureSuggestions ?? [],
          optimizationGuidance: constraint?.optimizationGuidance ?? [],
          productionRisks: constraint?.productionRisks ?? [],
          examples: constraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
