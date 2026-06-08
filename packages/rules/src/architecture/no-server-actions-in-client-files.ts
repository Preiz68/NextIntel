import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const noServerActionsInClientFiles: Rule = {
  id: "no-server-actions-in-client-files",

  meta: {
    description: "Ensure Server Actions are not defined or exported from files marked with the 'use client' directive.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      if (!analysis.isClientComponent) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      if (!content.includes("use server") && !content.includes('"use server"') && !content.includes("'use server'")) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_sa_client.tsx", content);
        
        const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const arrows = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);
        const expressions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression);

        for (const func of [...functions, ...arrows, ...expressions]) {
          const bodyText = func.getBody()?.getText() ?? "";
          if (bodyText.includes('"use server"') || bodyText.includes("'use server'")) {
            const line = func.getStartLineNumber();
            diagnostics.push({
              file: analysis.filePath,
              line: line,
              severity: "warning",
              ruleId: this.id,
              id: "AR-ACTION-CLIENT-001",
              message: `Server Action defined inline inside Client Component file '${path.basename(analysis.filePath)}'. Move this action to a separate server-only actions file (e.g. 'actions.ts') and import it.`,
              whyItMatters: "React Server Components do not support inline Server Actions in client-side bundles. Defining a Server Action directly inside a Client Component file will cause compilation or runtime hydration crashes during build because client bundles cannot export server-only handlers.",
              quickFixes: [
                "Extract the server action into a separate file marked with 'use server' at the top.",
                "Import the action from that file into your Client Component."
              ],
              architectureSuggestions: [
                "Isolate Server Actions: Keep a clean 'actions.ts' file at the folder root containing all mutations for the route."
              ],
              productionRisks: [
                "Webpack/compiler build-time compilation errors",
                "Runtime execution failures during client hydration",
                "Leaking server compilation metadata to client-side bundles"
              ]
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return diagnostics;
  }
};
