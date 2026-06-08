import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const requireErrorBoundaryForActions: Rule = {
  id: "require-error-boundary-for-actions",

  meta: {
    description: "Ensure Server Action invocations in Client Components are wrapped in try-catch or backed by a route-level error.tsx boundary.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const serverActionFiles = new Set<string>();
    for (const a of context.analyses) {
      if (a.hasTopLevelUseServer || a.semanticKind === "server-action") {
        serverActionFiles.add(a.filePath.replace(/\\/g, "/"));
      }
    }

    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || analysis.semanticKind === "client-component";
      if (!isClient) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      const actionImports = new Set<string>();
      const imports = analysis.importDetails || [];
      
      const currentDir = path.dirname(analysis.filePath);
      for (const imp of imports) {
        let resolvedPath = "";
        const spec = imp.moduleSpecifier;
        if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) {
          if (spec.startsWith("@/")) {
            const suffix = spec.slice(2);
            const match = context.analyses.find(a => 
              a.filePath.endsWith(suffix) || 
              a.filePath.endsWith(suffix + ".ts") || 
              a.filePath.endsWith(suffix + ".tsx")
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

        if (resolvedPath && serverActionFiles.has(resolvedPath)) {
          if (imp.defaultImport) actionImports.add(imp.defaultImport);
          for (const name of imp.namedImports) {
            actionImports.add(name);
          }
        }
      }

      if (actionImports.size === 0) continue;

      let dir = path.dirname(analysis.filePath);
      let foundErrorSibling = false;
      while (dir && dir.replace(/\\/g, "/").includes("/app")) {
        const errorFiles = ["error.tsx", "error.jsx", "error.js"];
        for (const f of errorFiles) {
          if (existsSync(path.join(dir, f))) {
            foundErrorSibling = true;
            break;
          }
        }
        if (foundErrorSibling) break;

        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      if (foundErrorSibling) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_action_err.tsx", content);
        
        const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of calls) {
          const exprText = call.getExpression().getText();
          if (actionImports.has(exprText)) {
            const insideTry = call.getFirstAncestorByKind(SyntaxKind.TryStatement);
            
            if (!insideTry) {
              const line = call.getStartLineNumber();
              diagnostics.push({
                file: analysis.filePath,
                line: line,
                severity: "warning",
                ruleId: this.id,
                id: "AR-ACTION-ERR-001",
                message: `Server Action '${exprText}' is called in Client Component without a try-catch block and has no sibling 'error.tsx' boundary. An unhandled exception in this action will crash the client UI.`,
                whyItMatters: "Server Actions execute database mutations and network calls, which frequently fail (validation errors, timeouts, connection dropouts). Without catching these errors locally or backing them with a React Error Boundary (error.tsx), the failure will cause unhandled promise rejections, leaving the client UI in an unresponsive or broken state.",
                quickFixes: [
                  "Wrap the action call inside a try-catch block to handle errors gracefully.",
                  "Create an 'error.tsx' component in your route directory to act as a fallback."
                ],
                architectureSuggestions: [
                  "Establish a robust error-handling contract: Actions return state structures like { success: boolean, error?: string } to avoid throwing exceptions directly across the network."
                ],
                productionRisks: [
                  "Client-side React rendering crashes on query/db exceptions",
                  "Broken UI state with buttons left in disabled/loading states",
                  "Vulnerability to unhandled promise rejections crashing browser runtime"
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
