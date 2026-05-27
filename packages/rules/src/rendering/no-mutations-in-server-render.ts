import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noMutationsInServerRender: Rule = {
  id: "no-mutations-in-server-render",

  meta: {
    description: "Mutations must not occur during Server Component rendering.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      // Check if file content mentions target mutation APIs at all (quick pre-filter)
      if (
        !content.includes("cookies") &&
        !content.includes("revalidatePath") &&
        !content.includes("revalidateTag")
      ) {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

      // If file has top-level "use server", it's a Server Actions file, not a component render body
      const hasTopLevelUseServer = sourceFile.getStatements().some((stmt) => {
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

      if (hasTopLevelUseServer) continue;

      const callExpressions = sourceFile.getDescendantsOfKind(
        SyntaxKind.CallExpression
      );

      for (const call of callExpressions) {
        let isMutationCall = false;
        let callName = "";

        const expr = call.getExpression();
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
          const propAccess = expr as any;
          const propName = propAccess.getName();
          const subExpr = propAccess.getExpression();
          if (
            (propName === "set" || propName === "delete") &&
            subExpr.getKind() === SyntaxKind.CallExpression
          ) {
            if (subExpr.getExpression().getText() === "cookies") {
              isMutationCall = true;
              callName = `cookies().${propName}`;
            }
          }
        } else if (expr.getKind() === SyntaxKind.Identifier) {
          const idText = expr.getText();
          if (idText === "revalidatePath" || idText === "revalidateTag") {
            isMutationCall = true;
            callName = idText;
          }
        }

        if (!isMutationCall) continue;

        // Check if call is inside an inline Server Action
        if (isInsideServerAction(call)) continue;

        const line = call.getStartLineNumber();

        diagnostics.push(
          mapEventToDiagnostic(
            "RENDER_PHASE_SERVER_API_ACCESS",
            "SC-MUTATION-001",
            this.id,
            analysis.filePath,
            line,
            `Mutation API '${callName}()' is called during Server Component render phase.`
          )
        );
      }
    }

    return diagnostics;
  },
};

function isInsideServerAction(node: any): boolean {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    if (
      kind === SyntaxKind.FunctionDeclaration ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.MethodDeclaration
    ) {
      const body = parent.getBody ? parent.getBody() : null;
      if (body && body.getKind() === SyntaxKind.Block) {
        const statements = body.getStatements();
        for (const stmt of statements) {
          if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
            const expr = stmt.getExpression();
            if (
              expr.getKind() === SyntaxKind.StringLiteral &&
              expr.getLiteralText() === "use server"
            ) {
              return true;
            }
          }
        }
      }
    }
    parent = parent.getParent();
  }
  return false;
}
