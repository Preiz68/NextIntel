import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noAsyncClientComponents: Rule = {
  id: "no-async-client-components",

  meta: {
    description: "Client Components cannot be async functions.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClient = 
        analysis.isClientComponent || 
        analysis.semanticKind === "client-component" ||
        analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("async")) continue;

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.tsx", content);

      sourceFile.forEachDescendant((node) => {
        const kind = node.getKind();
        if (
          kind === SyntaxKind.FunctionDeclaration ||
          kind === SyntaxKind.ArrowFunction ||
          kind === SyntaxKind.FunctionExpression
        ) {
          // Check if function is marked async
          const isAsync = (node as any).isAsync ? (node as any).isAsync() : false;
          let hasAsyncModifier = isAsync;
          if (!hasAsyncModifier) {
            const modifiers = (node as any).getModifiers ? (node as any).getModifiers() : [];
            hasAsyncModifier = modifiers.some((m: any) => m.getText() === "async");
          }

          if (hasAsyncModifier) {
            let name = "";
            if (node.getKind() === SyntaxKind.FunctionDeclaration) {
              name = (node as any).getName() ?? "";
            } else {
              const parent = node.getParent();
              if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
                name = (parent as any).getName();
              }
            }

            if (name && name.charAt(0) === name.charAt(0).toUpperCase()) {
              const returnsJsx = (() => {
                const returnStatements = node.getDescendantsOfKind(SyntaxKind.ReturnStatement);
                for (const ret of returnStatements) {
                  const expr = ret.getExpression();
                  if (expr) {
                    const exprKind = expr.getKindName();
                    if (
                      exprKind === "JsxElement" ||
                      exprKind === "JsxSelfClosingElement" ||
                      exprKind === "JsxFragment"
                    ) {
                      return true;
                    }
                    const exprText = expr.getText();
                    if (/<[A-Za-z]/.test(exprText)) {
                      return true;
                    }
                  }
                }
                if (node.getKind() === SyntaxKind.ArrowFunction) {
                  const body = (node as any).getBody();
                  if (body) {
                    const bodyKind = body.getKindName();
                    if (
                      bodyKind === "JsxElement" ||
                      bodyKind === "JsxSelfClosingElement" ||
                      bodyKind === "JsxFragment"
                    ) {
                      return true;
                    }
                  }
                }
                return false;
              })();

              const isDefaultExport = (() => {
                if (node.getKind() === SyntaxKind.FunctionDeclaration) {
                  return (node as any).isDefaultExport() || ((node as any).isExported() && name === "default");
                }
                const parent = node.getParent();
                if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
                  const varStatement = parent.getFirstAncestorByKind(SyntaxKind.VariableStatement);
                  if (varStatement) {
                    return varStatement.isDefaultExport();
                  }
                }
                return false;
              })();

              if (returnsJsx || isDefaultExport) {
                const line = node.getStartLineNumber();
                diagnostics.push(
                  mapEventToDiagnostic(
                    "CLIENT_COMPONENT_ASYNC_EXECUTION",
                    "CC-ASYNC-CLIENT-001",
                    this.id,
                    analysis.filePath,
                    line,
                    `Client Component '${name}' is declared as an async function. Next.js Client Components cannot be async.`
                  )
                );
              }
            }
          }
        }
      });
    }

    return diagnostics;
  },
};

