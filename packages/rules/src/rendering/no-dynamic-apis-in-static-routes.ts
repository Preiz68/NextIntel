import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";

/**
 * Rule: no-dynamic-apis-in-static-routes
 *
 * Detects usage of dynamic runtime APIs (cookies(), headers(), draftMode())
 * inside layout components or segments marked as force-static, as this invalidates
 * static generation / Full Route Cache.
 *
 * Semantics: Sourced from "Caching" knowledge pack constraint CA-003.
 */
export const noDynamicApisInStaticRoutes: Rule = {
  id: "no-dynamic-apis-in-static-routes",

  meta: {
    description: "Do not call dynamic APIs (cookies, headers) inside layout components or static route segments.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("caching", "CA-003");
    const whyItMatters = constraint?.whyItMatters ?? "Using runtime APIs (cookies(), headers()) in a Server Component without Suspense wrapping causes the entire route to be dynamically rendered, disabling Full Route Cache.";
    const quickFixes = constraint?.quickFixes ?? ["Extract the cookies()/headers() call into a child component wrapped in <Suspense>."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const isLayout = analysis.semanticKind === "layout" || analysis.filePath.endsWith("layout.tsx") || analysis.filePath.endsWith("layout.ts");
      const hasDynamicTriggers = 
        analysis.rendering.triggers.includes("cookies") || 
        analysis.rendering.triggers.includes("headers") ||
        analysis.rendering.triggers.includes("unstable_noStore") ||
        analysis.rendering.triggers.includes("noStore");

      if (!hasDynamicTriggers) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      // Check if this segment is configured for force-static
      const isForceStatic = content.includes("force-static");

      if (isLayout) {
        // Flag dynamic APIs in layouts
        let line = 1;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes("cookies(") || lines[i]!.includes("headers(")) {
            line = i + 1;
            break;
          }
        }

        diagnostics.push({
          file: analysis.filePath,
          line,
          severity: "warning",
          ruleId: this.id,
          id: constraint?.id ?? "CA-003",
          message: `Dynamic API called inside layout component. This invalidates static rendering (SSG) for this entire layout's subtree. Move dynamic APIs deep into leaves or wrap in <Suspense>.`,
          fix: quickFixes[0],
          whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: constraint?.examples,
        });
      } else if (isForceStatic) {
        // Flag dynamic APIs in force-static files (Direct compile/runtime error)
        let line = 1;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]!.includes("cookies(") || lines[i]!.includes("headers(")) {
            line = i + 1;
            break;
          }
        }

        diagnostics.push({
          file: analysis.filePath,
          line,
          severity: "error", // In force-static it is a direct build error
          ruleId: this.id,
          id: constraint?.id ?? "CA-003",
          message: `Dynamic API called inside route segment configured as 'force-static'. Next.js will throw a compile-time or runtime error.`,
          fix: "Remove dynamic APIs or change dynamic segment configuration.",
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
