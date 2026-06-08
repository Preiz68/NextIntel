import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind, Node } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function hasMutatingSideEffectsAST(actionNode: any): boolean {
  const callExprs = actionNode.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of callExprs) {
    const expression = call.getExpression();
    let name = "";
    if (Node.isPropertyAccessExpression(expression)) {
      name = expression.getName();
    } else if (Node.isIdentifier(expression)) {
      name = expression.getText();
    }

    if (name) {
      const lowerName = name.toLowerCase();
      if (
        lowerName === "revalidatepath" ||
        lowerName === "revalidatetag" ||
        lowerName === "redirect"
      ) {
        return true;
      }

      const baseMutationKeywords = ["create", "update", "delete", "insert", "remove", "save", "patch", "upsert", "write", "execute", "replace", "set"];
      const words = splitWords(name);
      if (baseMutationKeywords.some(kw => words.includes(kw))) {
        return true;
      }
    }
  }

  // Note: cookies().get() is read-only — we only want cookies().set() or
  // cookies().delete() which are handled above in the PropertyAccessExpression
  // branch. A bare "cookies" identifier is NOT sufficient to classify mutation.

  const strings = actionNode.getDescendantsOfKind(SyntaxKind.StringLiteral);
  const templates = actionNode.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  const templateHeads = actionNode.getDescendantsOfKind(SyntaxKind.TemplateHead);
  const templateMiddle = actionNode.getDescendantsOfKind(SyntaxKind.TemplateMiddle);
  const templateTails = actionNode.getDescendantsOfKind(SyntaxKind.TemplateTail);
  
  const textNodes = [...strings, ...templates, ...templateHeads, ...templateMiddle, ...templateTails];
  const sqlMutationRegex = /\b(insert\s+into|update\s+|delete\s+from|drop\s+table|alter\s+table)\b/i;
  
  for (const node of textNodes) {
    try {
      if (sqlMutationRegex.test(node.getLiteralText())) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}

export const serverActionsNoReads: Rule = {
  id: "server-actions-no-reads",

  meta: {
    description: "Server Actions must not be used for read operations.",
    severity: "warning",
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
        const isReadName = /^(get|read|fetch)([A-Z]|$)/.test(action.name);
        if (!isReadName) continue;

        if (!hasMutatingSideEffectsAST(action.node)) {
          diagnostics.push(
            mapEventToDiagnostic(
              "CACHE_CONFLICT_DETECTED",
              "SA-READ-ACTION-001",
              this.id,
              analysis.filePath,
              action.line,
              `Server Action '${action.name}' appears to be a read-only operation. Server Actions should only be used for mutations.`
            )
          );
        }
      }
    }

    return diagnostics;
  },
};
