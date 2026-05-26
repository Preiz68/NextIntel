import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";

/**
 * Rule: no-inline-server-actions-in-client-components
 *
 * Detects inline Server Actions (functions marked with 'use server') declared
 * inside Client Components, which is forbidden in Next.js and causes a build error.
 *
 * Semantics: Sourced from "Server Actions" knowledge pack constraint SA-002 / React compiler specifications.
 */
export const noInlineServerActionsInClientComponents: Rule = {
  id: "no-inline-server-actions-in-client-components",

  meta: {
    description: "Server Actions cannot be defined inline in Client Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("server-actions", "SA-002");
    const whyItMatters = constraint?.whyItMatters ?? "Next.js forbids defining Server Actions directly inside Client Components. They must be imported from a separate 'use server' file to maintain environment isolation.";
    const quickFixes = constraint?.quickFixes ?? ["Move the Server Action to a separate 'use server' file and import it."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

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

      if (!content.includes("use server")) continue;

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

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
              const line = node.getStartLineNumber();
              let name = "anonymous";
              if (node.getKind() === SyntaxKind.FunctionDeclaration) {
                name = (node as any).getName() ?? "anonymous";
              } else {
                const parent = node.getParent();
                if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
                  name = (parent as any).getName();
                }
              }

              diagnostics.push({
                file: analysis.filePath,
                line,
                severity: "error",
                ruleId: this.id,
                id: constraint?.id ?? "SA-002",
                message: `Server Action '${name}' is defined inline inside a Client Component. Server Actions cannot be defined inside Client Components.`,
                fix: quickFixes[0],
                whyItMatters,
                quickFixes,
                architectureSuggestions,
                optimizationGuidance,
                productionRisks,
                examples: constraint?.examples,
              });
            }
          }
        }
      });
    }

    return diagnostics;
  },
};
