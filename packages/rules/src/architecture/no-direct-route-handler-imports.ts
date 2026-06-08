import { Rule, RuleContext, Diagnostic } from "../types.js";
import path from "node:path";

export const noDirectRouteHandlerImports: Rule = {
  id: "no-direct-route-handler-imports",

  meta: {
    description: "Ensure route handler files (route.ts) are not directly imported inside pages or components.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const imports = analysis.importDetails || [];
      const currentDir = path.dirname(analysis.filePath);

      for (const imp of imports) {
        const spec = imp.moduleSpecifier;
        let resolvedPath = "";

        if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) {
          if (spec.startsWith("@/")) {
            const suffix = spec.slice(2);
            const match = context.analyses.find(a => 
              a.filePath.endsWith(suffix) || 
              a.filePath.endsWith(suffix + ".ts") || 
              a.filePath.endsWith(suffix + ".js")
            );
            if (match) resolvedPath = match.filePath.replace(/\\/g, "/");
          } else {
            const abs = path.resolve(currentDir, spec);
            const match = context.analyses.find(a => {
              const aNorm = a.filePath.replace(/\\/g, "/");
              const absNorm = abs.replace(/\\/g, "/");
              return aNorm.replace(/\.[jt]sx?$/, "") === absNorm.replace(/\.[jt]sx?$/, "");
            });
            if (match) resolvedPath = match.filePath.replace(/\\/g, "/");
          }
        }

        if (resolvedPath) {
          const filename = path.basename(resolvedPath);
          const isRouteHandler = /^(route)\.[jt]sx?$/.test(filename);
          if (isRouteHandler) {
            diagnostics.push({
              file: analysis.filePath,
              line: imp.line ?? 1,
              severity: "warning",
              ruleId: this.id,
              id: "AR-ROUTE-IMPORT-001",
              message: `Direct import of Route Handler '${filename}' (from '${path.basename(path.dirname(resolvedPath))}') detected. Route Handlers are standalone API endpoints and must not be imported directly. Extract the shared logic to a server utility or DAL helper.`,
              whyItMatters: "Route Handlers (route.ts) define HTTP request methods (GET, POST, etc.) and are compiled as independent routing endpoints. Importing them directly couples UI code to specific HTTP request/response typings, causes code bundling overlap, and violates clean separation of layers.",
              quickFixes: [
                "Move the shared logic/helpers out of route.ts into a shared utility file (e.g. '/lib/data-fetchers.ts').",
                "Import the shared utility file in both the Route Handler and your component."
              ],
              architectureSuggestions: [
                "Structure: Component/Page -> imports shared utility. Route Handler -> imports shared utility. Never import Route Handler into Component."
              ],
              productionRisks: [
                "Severe compilation warnings and bundling bloat",
                "Spaghetti code dependencies coupling REST structures to UI logic",
                "Difficulty in maintaining API contracts and endpoint tests"
              ]
            });
          }
        }
      }
    }

    return diagnostics;
  }
};
