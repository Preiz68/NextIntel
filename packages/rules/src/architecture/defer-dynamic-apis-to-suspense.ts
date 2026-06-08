import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const deferDynamicApisToSuspense: Rule = {
  id: "defer-dynamic-apis-to-suspense",

  meta: {
    description: "Ensure dynamic API calls (cookies(), headers()) are deferred to Suspense-wrapped child components rather than locking layout/page static shells.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      if (analysis.isClientComponent) continue;

      const normPath = analysis.filePath.replace(/\\/g, "/");
      const filename = path.basename(normPath);
      const isBoundary = /^(page|layout|template)\.[jt]sx?$/.test(filename);
      if (!isBoundary) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      if (!content.includes("cookies(") && !content.includes("headers(")) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_defer_dyn.tsx", content);
        
        const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const arrows = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
        
        for (const func of [...functions, ...arrows]) {
          const body = func.getBody();
          if (!body) continue;

          const callExpressions = body.getDescendantsOfKind(SyntaxKind.CallExpression);
          for (const call of callExpressions) {
            const exprText = call.getExpression().getText();
            if (exprText === "cookies" || exprText === "headers") {
              const line = call.getStartLineNumber();
              diagnostics.push({
                file: analysis.filePath,
                line: line,
                severity: "warning",
                ruleId: this.id,
                id: "AR-PERF-DYN-001",
                message: `Blocking dynamic API '${exprText}()' called directly in routing boundary '${filename}' render phase. Move it to a separate child component wrapped in <Suspense> to allow the layout/page shell to be pre-rendered statically (PPR).`,
                whyItMatters: "Calling cookies() or headers() at the root of a layout or page opts the entire segment and all its children out of static caching, causing Next.js to render the whole route dynamically per request. Deferring these calls to Suspense-wrapped child components allows Next.js to serve the static layout instantly from a CDN and stream in the dynamic parts.",
                quickFixes: [
                  `Extract the dynamic code into a separate component: function DynamicPart() { const data = ${exprText}(); ... }`,
                  `Wrap it in layout/page: <Suspense fallback={<Skeleton />}><DynamicPart /></Suspense>`
                ],
                architectureSuggestions: [
                  "Optimize for Partial Prerendering (PPR): Keep layout shells static and isolate request-time dynamic hooks inside granular Suspense holes."
                ],
                productionRisks: [
                  "Substantially increased Time to First Byte (TTFB) on static routes",
                  "Loss of CDN caching benefits, forcing full dynamic execution on every page load",
                  "Increased server rendering load and infrastructure costs"
                ]
              });
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return diagnostics;
  }
};
