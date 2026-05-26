import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { isTypeNonSerializable } from "../rendering/props-must-be-serializable.js";

/**
 * Rule: server-actions-lexical-closures
 *
 * Detects inline Server Actions capturing non-serializable server-only variables
 * (e.g. database connections, ORM instances, file streams) in their lexical scope,
 * causing React Flight serialization crashes or performance/security leaks.
 *
 * Semantics: Sourced from "Server Actions" knowledge pack constraint SA-002.
 */
export const serverActionsLexicalClosures: Rule = {
  id: "server-actions-lexical-closures",

  meta: {
    description: "Inline Server Actions must not capture non-serializable variables in their closure.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("server-actions", "SA-002");
    const whyItMatters = constraint?.whyItMatters ?? "Inline Server Actions serialize closed-over variables. Non-serializable database clients, request contexts, or complex objects in closures cause runtime crashes.";
    const quickFixes = constraint?.quickFixes ?? ["Move the Server Action to a separate 'use server' file to enforce parameters over scope closures."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      // Quick filter
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
              // Analyze variables captured by this action closure
              const identifiers = body.getDescendantsOfKind(SyntaxKind.Identifier);
              const flagged = new Set<string>();

              for (const id of identifiers) {
                const name = id.getText();
                if (flagged.has(name)) continue;

                try {
                  const symbol = id.getSymbol();
                  if (symbol) {
                    const decls = symbol.getDeclarations();
                    for (const decl of decls) {
                      if (decl.getSourceFile() === sourceFile) {
                        // Check if the declaration is inside the action function node
                        let parent = decl.getParent();
                        let isDeclaredInside = false;
                        while (parent) {
                          if (parent === node) {
                            isDeclaredInside = true;
                            break;
                          }
                          parent = parent.getParent();
                        }

                        if (!isDeclaredInside) {
                          // Free variable captured from the outer scope!
                          const type = id.getType();
                          if (type && isTypeNonSerializable(type)) {
                            flagged.add(name);
                            const line = id.getStartLineNumber();

                            diagnostics.push({
                              file: analysis.filePath,
                              line,
                              severity: "error",
                              ruleId: this.id,
                              id: constraint?.id ?? "SA-002",
                              message: `Inline Server Action captures non-serializable variable '${name}' from lexical scope. This will cause serialization failures during rendering.`,
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
                    }
                  }
                } catch {
                  // ignore type-resolution edge cases
                }
              }
            }
          }
        }
      });
    }

    return diagnostics;
  },
};
