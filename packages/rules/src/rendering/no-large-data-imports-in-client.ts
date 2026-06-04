import { Rule, RuleContext, Diagnostic } from "../types.js";
import fs from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";
import { Project, SyntaxKind, Node } from "ts-morph";

function isInsideDeferredScope(node: Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.isKind(SyntaxKind.CallExpression)) {
      const callee = parent.getExpression().getText();
      if (
        callee === "useEffect" ||
        callee === "useLayoutEffect" ||
        callee === "useCallback" ||
        callee === "useMemo" ||
        callee.endsWith(".useEffect") ||
        callee.endsWith(".useLayoutEffect") ||
        callee.endsWith(".useCallback") ||
        callee.endsWith(".useMemo")
      ) {
        return true;
      }
    }

    if (
      parent.isKind(SyntaxKind.FunctionDeclaration) ||
      parent.isKind(SyntaxKind.FunctionExpression) ||
      parent.isKind(SyntaxKind.ArrowFunction)
    ) {
      const outerFunction =
        parent.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        parent.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
        parent.getFirstAncestorByKind(SyntaxKind.FunctionExpression);

      if (outerFunction) {
        return true;
      }
    }

    parent = parent.getParent();
  }
  return false;
}

export const noLargeDataImportsInClient: Rule = {
  id: "no-large-data-imports-in-client",

  meta: {
    description: "Detect large data imports (.json/.csv > 50KB) directly inside Client Components.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const isUsedAtRenderTime = (content: string, identifiers: string[]): boolean => {
      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_large_data.tsx", content);
        let usedAtRenderTime = false;

        sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
          const name = id.getText();
          if (identifiers.includes(name)) {
            const importParent = id.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
            if (importParent) return;

            if (!isInsideDeferredScope(id)) {
              usedAtRenderTime = true;
            }
          }
        });

        return usedAtRenderTime;
      } catch {
        return true;
      }
    };

    for (const analysis of context.analyses) {
      const isClient = 
        analysis.isClientComponent || 
        analysis.semanticKind === "client-component" ||
        analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      if (!analysis.importDetails || analysis.importDetails.length === 0) continue;

      const currentDir = path.dirname(analysis.filePath);
      let content = "";
      try {
        content = fs.readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      for (const imp of analysis.importDetails) {
        if (!imp.moduleSpecifier.startsWith(".")) continue;

        const resolvedPathNoExt = path.resolve(currentDir, imp.moduleSpecifier);
        let targetFile: string | null = null;
        const extensionsToCheck = ["", ".json", ".csv"];

        for (const ext of extensionsToCheck) {
          const p = resolvedPathNoExt + ext;
          try {
            if (fs.existsSync(p)) {
              const stat = fs.statSync(p);
              if (stat.isFile()) {
                targetFile = p;
                break;
              }
            }
          } catch {
            // ignore
          }
        }

        if (targetFile && (targetFile.endsWith(".json") || targetFile.endsWith(".csv"))) {
          try {
            const size = fs.statSync(targetFile).size;
            if (size > 51200) { // 50KB
              const identifiers: string[] = [];
              if (imp.defaultImport) identifiers.push(imp.defaultImport);
              if (imp.namespaceImport) identifiers.push(imp.namespaceImport);
              if (imp.namedImports) {
                for (const n of imp.namedImports) {
                  identifiers.push(n);
                }
              }

              if (isUsedAtRenderTime(content, identifiers)) {
                const line = imp.line || 1;
                diagnostics.push(
                  mapEventToDiagnostic(
                    "CLIENT_GRAPH_LEAK",
                    "CC-HYDRATION-ABUSE-001",
                    this.id,
                    analysis.filePath,
                    line,
                    `Client Component imports large static data file '${path.basename(targetFile)}' (${(size / 1024).toFixed(1)}KB), which exceeds the 50KB recommended limit. This bloats the client bundle and increases hydration time.`
                  )
                );
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return diagnostics;
  },
};
