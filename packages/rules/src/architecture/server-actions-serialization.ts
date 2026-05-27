import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";
import { isTypeNonSerializable } from "../rendering/props-must-be-serializable.js";

function getApparentType(type: any): any {
  if (!type) return type;
  const typeText = type.getText();
  if ((typeText.startsWith("Promise<") || typeText.startsWith("PromiseLike<")) && type.getTypeArguments().length > 0) {
    return type.getTypeArguments()[0];
  }
  return type;
}

export const serverActionsSerialization: Rule = {
  id: "server-actions-serialization",

  meta: {
    description:
      "Server Action arguments and return values must be serializable.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      const hasUseServer = content.includes("use server");
      if (!hasUseServer) continue;

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

      const isActionFile = sourceFile.getStatements().some((stmt) => {
        if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
          const expr = (stmt as any).getExpression();
          if (
            expr &&
            expr.getKind() === SyntaxKind.StringLiteral &&
            expr.getLiteralText() === "use server"
          ) {
            return true;
          }
        }
        return false;
      });

      const serverActions: { name: string; line: number; node: any }[] = [];

      // 1. If file has top-level "use server"
      if (isActionFile) {
        sourceFile.getFunctions().forEach((f) => {
          if (f.isExported() || f.isDefaultExport()) {
            serverActions.push({
              name: f.getName() ?? "anonymous",
              line: f.getStartLineNumber(),
              node: f,
            });
          }
        });

        sourceFile.getVariableStatements().forEach((vs) => {
          if (vs.isExported()) {
            vs.getDeclarations().forEach((decl) => {
              const init = decl.getInitializer();
              if (
                init &&
                (init.getKind() === SyntaxKind.ArrowFunction ||
                  init.getKind() === SyntaxKind.FunctionExpression)
              ) {
                serverActions.push({
                  name: decl.getName(),
                  line: decl.getStartLineNumber(),
                  node: init,
                });
              }
            });
          }
        });
      }

      // 2. Inline "use server" functions
      sourceFile.forEachDescendant((node) => {
        const kind = node.getKind();
        if (
          kind === SyntaxKind.FunctionDeclaration ||
          kind === SyntaxKind.ArrowFunction ||
          kind === SyntaxKind.FunctionExpression ||
          kind === SyntaxKind.MethodDeclaration
        ) {
          const body = (node as any).getBody ? (node as any).getBody() : null;
          if (body && body.getKind() === SyntaxKind.Block) {
            const hasInlineDir = body.getStatements().some((stmt: any) => {
              if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
                const expr = stmt.getExpression();
                if (
                  expr.getKind() === SyntaxKind.StringLiteral &&
                  expr.getLiteralText() === "use server"
                ) {
                  return true;
                }
              }
              return false;
            });
            if (hasInlineDir) {
              let name = "anonymous";
              if (node.getKind() === SyntaxKind.FunctionDeclaration) {
                name = (node as any).getName() ?? "anonymous";
              } else {
                const parent = node.getParent();
                if (
                  parent &&
                  parent.getKind() === SyntaxKind.VariableDeclaration
                ) {
                  name = (parent as any).getName();
                } else if (
                  parent &&
                  parent.getKind() === SyntaxKind.PropertyAssignment
                ) {
                  name = (parent as any).getName();
                }
              }
              if (!serverActions.some((sa) => sa.node === node)) {
                serverActions.push({
                  name,
                  line: node.getStartLineNumber(),
                  node,
                });
              }
            }
          }
        }
      });

      for (const action of serverActions) {
        // Enforce async actions
        const isAsync = action.node.isAsync ? action.node.isAsync() : false;
        if (!isAsync) {
          diagnostics.push(
            mapEventToDiagnostic(
              "BOUNDARY_VIOLATION_DETECTED",
              "SA-SERIALIZATION-001",
              this.id,
              analysis.filePath,
              action.line,
              `Server Action '${action.name}' is declared as a synchronous function. Server Actions must be asynchronous.`
            )
          );
        }

        // Check arguments
        const params = action.node.getParameters
          ? action.node.getParameters()
          : [];
        for (const param of params) {
          const type = param.getType();
          if (isTypeNonSerializable(type, new Set(), true)) {
            const typeText = type.getText();
            diagnostics.push(
              mapEventToDiagnostic(
                "BOUNDARY_VIOLATION_DETECTED",
                "SA-SERIALIZATION-001",
                this.id,
                analysis.filePath,
                param.getStartLineNumber(),
                `Server Action '${action.name}' has non-serializable parameter '${param.getName()}' of type '${typeText}'.`
              )
            );
          }
        }

        // Check return statements
        const returnStatements = action.node.getDescendantsOfKind(
          SyntaxKind.ReturnStatement
        );
        for (const ret of returnStatements) {
          let parent = ret.getParent();
          let isNested = false;
          while (parent && parent !== action.node) {
            const pKind = parent.getKind();
            if (
              pKind === SyntaxKind.FunctionDeclaration ||
              pKind === SyntaxKind.ArrowFunction ||
              pKind === SyntaxKind.FunctionExpression
            ) {
              isNested = true;
              break;
            }
            parent = parent.getParent();
          }
          if (isNested) continue;

          const expr = ret.getExpression();
          if (expr) {
            const type = getApparentType(expr.getType());
            if (isTypeNonSerializable(type, new Set(), true)) {
              const typeText = type.getText();
              diagnostics.push(
                mapEventToDiagnostic(
                  "BOUNDARY_VIOLATION_DETECTED",
                  "SA-SERIALIZATION-001",
                  this.id,
                  analysis.filePath,
                  ret.getStartLineNumber(),
                  `Server Action '${action.name}' returns non-serializable value of type '${typeText}'.`
                )
              );
            }
          }
        }
      }
    }

    return diagnostics;
  },
};
