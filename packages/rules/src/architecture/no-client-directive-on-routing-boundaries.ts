import { Rule, RuleContext, Diagnostic } from "../types.js";
import path from "node:path";

export const noClientDirectiveOnRoutingBoundaries: Rule = {
  id: "no-client-directive-on-routing-boundaries",

  meta: {
    description: "Ensure page.tsx, layout.tsx, and template.tsx do not use the 'use client' directive.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const normPath = analysis.filePath.replace(/\\/g, "/");
      const filename = path.basename(normPath);
      const isRouteBoundary = /^(page|layout|template)\.[jt]sx?$/.test(filename);
      
      if (!isRouteBoundary) continue;

      if (analysis.isClientComponent) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "AR-ROUTE-CLIENT-001",
          message: `Routing boundary file '${filename}' contains the 'use client' directive. Layouts, pages, and templates should remain Server Components. Interactive logic or hooks should be refactored into smaller leaf-node Client Components.`,
          whyItMatters: "Making a route boundary a Client Component forces Next.js to ship its entire component subtree to the browser, significantly increasing javascript bundle sizes and disabling server-side data-fetching features.",
          quickFixes: [
            "Remove 'use client' and move state/hooks into child components.",
            "Pass interactive state and handlers as props to leaf Client Components."
          ],
          architectureSuggestions: [
            "Structure: Keep page.tsx as a Server Component to fetch data, then render <InteractiveComponent data={data} />."
          ],
          productionRisks: [
            "Increased Javascript bundle size",
            "Slow Time to Interactive (TTI)",
            "Loss of Server Component caching and streaming advantages"
          ]
        });
      }
    }

    return diagnostics;
  }
};
