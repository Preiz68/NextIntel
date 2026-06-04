import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";

/**
 * Rule: no-use-cache-in-client-components
 *
 * Detects usage of the Next.js 15 'use cache' directive inside Client Components,
 * which is a compile-time build error.
 *
 * Semantics: Sourced from "Caching" knowledge pack constraint CA-005.
 */

function hasUseCacheDirective(content: string): { hasDirective: boolean; line: number } {
  if (!content.includes("use cache")) {
    return { hasDirective: false, line: 0 };
  }

  const project = new Project();
  const sourceFile = project.createSourceFile("temp.ts", content);

  let line = 0;

  const isUseCache = (stmt: any): boolean => {
    if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
      const expr = stmt.getExpression();
      if (
        expr.getKind() === SyntaxKind.StringLiteral &&
        expr.getLiteralText() === "use cache"
      ) {
        line = stmt.getStartLineNumber();
        return true;
      }
    }
    return false;
  };

  // Check top-level statements
  const statements = sourceFile.getStatements();
  for (const stmt of statements) {
    if (isUseCache(stmt)) {
      return { hasDirective: true, line };
    }
  }

  // Check blocks
  const blocks = sourceFile.getDescendantsOfKind(SyntaxKind.Block);
  for (const block of blocks) {
    const firstStmt = block.getStatements()[0];
    if (firstStmt && isUseCache(firstStmt)) {
      return { hasDirective: true, line };
    }
  }

  return { hasDirective: false, line: 0 };
}

export const noUseCacheInClientComponents: Rule = {
  id: "no-use-cache-in-client-components",

  meta: {
    description: "The 'use cache' directive can only be used in Server Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("caching", "RSC_API_VIOLATION-005");
    const whyItMatters = constraint?.whyItMatters ?? "Next.js 15 'use cache' directive is only valid in Server Components. Using it in Client Components will throw a compiler error.";
    const quickFixes = constraint?.quickFixes ?? ["Remove the 'use cache' directive from the Client Component or move the cached function to a Server Component."];
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

      const check = hasUseCacheDirective(content);
      if (!check.hasDirective) continue;
      const line = check.line;

      diagnostics.push({
        file: analysis.filePath,
        line,
        severity: "error",
        ruleId: this.id,
        id: constraint?.id ?? "RSC_API_VIOLATION-005",
        message: "The 'use cache' directive is used inside a Client Component. 'use cache' is a server-only directive and cannot run in the browser.",
        fix: quickFixes[0],
        whyItMatters,
        quickFixes,
        architectureSuggestions,
        optimizationGuidance,
        productionRisks,
        examples: constraint?.examples,
      });
    }

    return diagnostics;
  },
};
