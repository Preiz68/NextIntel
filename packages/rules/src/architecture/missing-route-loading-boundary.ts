import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const missingRouteLoadingBoundary: Rule = {
  id: "missing-route-loading-boundary",

  meta: {
    description: "Ensure routing pages with async data fetching have a corresponding loading.tsx file in their segment hierarchy.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const normPath = analysis.filePath.replace(/\\/g, "/");
      if (!normPath.includes("/app/")) continue;
      if (!normPath.endsWith("/page.tsx") && !normPath.endsWith("/page.ts") && !normPath.endsWith("/page.jsx") && !normPath.endsWith("/page.js")) continue;
      if (analysis.isClientComponent) continue;

      const hasFetch = analysis.fetchCalls && analysis.fetchCalls.length > 0;
      let hasDbCall = false;
      try {
        const content = readFileSync(analysis.filePath, "utf-8");
        hasDbCall = /\bawait\s+(fetch|db\.|prisma\.|drizzle\.|get[A-Z]|\w+DB)/g.test(content);
      } catch {
        // ignore
      }

      if (!hasFetch && !hasDbCall) continue;

      let dir = path.dirname(analysis.filePath);
      let foundLoading = false;

      while (dir && dir.replace(/\\/g, "/").includes("/app")) {
        const loadingFiles = ["loading.tsx", "loading.jsx", "loading.js"];
        for (const f of loadingFiles) {
          if (existsSync(path.join(dir, f))) {
            foundLoading = true;
            break;
          }
        }
        if (foundLoading) break;

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      if (!foundLoading) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "AR-ROUTE-LOADING-001",
          message: `Async data-fetching page '${path.basename(analysis.filePath)}' has no corresponding 'loading.tsx' boundary in its route segment or parent folders. Next.js will block page load until all async resolves, slowing LCP. Add a 'loading.tsx' fallback to enable progressive HTML streaming.`,
          whyItMatters: "In Next.js App Router, loading.tsx acts as an automatic React Suspense boundary. If missing, layout rendering is blocked until the page's async/await fetches resolve, increasing TTFB and visual delay for the user.",
          quickFixes: [
            "Create a 'loading.tsx' file in the same directory as the page.",
            "Or wrap page elements in a manual <Suspense> boundary inside your layout."
          ],
          architectureSuggestions: [
            "Always co-locate a loading.tsx skeleton component alongside page.tsx for routes containing async network requests."
          ],
          productionRisks: [
            "Slow visual response on initial page navigation",
            "Disabling Next.js progressive HTML streaming optimization",
            "Core Web Vitals LCP degradation"
          ]
        });
      }
    }

    return diagnostics;
  }
};
