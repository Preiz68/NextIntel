import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noRouteHandlersInClientComponents: Rule = {
  id: "no-route-handlers-in-client-components",

  meta: {
    description:
      "Avoid calling Route Handlers from Client Components when Server Components can fetch.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClientCtx = analysis.executionModel.componentType === "client";
      if (!isClientCtx) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("fetch") || !content.includes("/api/")) {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

      const callExpressions = sourceFile.getDescendantsOfKind(
        SyntaxKind.CallExpression
      );
      let reported = false;

      for (const call of callExpressions) {
        if (call.getExpression().getText() === "fetch") {
          const args = call.getArguments();
          if (args.length > 0) {
            const firstArg = args[0]!;
            const firstArgText = firstArg.getText();
            const isInternalApi =
              /^[‘'"`]\/api\//.test(firstArgText) ||
              (firstArg.getKind() === SyntaxKind.TemplateExpression &&
                firstArgText.startsWith("`/api/"));

            if (isInternalApi) {
              const line = call.getStartLineNumber();

              diagnostics.push(
                mapEventToDiagnostic(
                  "BOUNDARY_VIOLATION_DETECTED",
                  "CC-ROUTE-HANDLER-001",
                  this.id,
                  analysis.filePath,
                  line,
                  `Client Component fetches internal route '${firstArgText.replace(
                    /['"`]/g,
                    ""
                  )}'.`
                )
              );
              reported = true;
            }
          }
        }
      }

      if (
        !reported &&
        (content.includes("fetch('/api/") ||
          content.includes("fetch(\"/api/") ||
          content.includes("fetch(`/api/"))
      ) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "CC-ROUTE-HANDLER-001",
            this.id,
            analysis.filePath,
            1,
            `Avoid calling Route Handlers from Client Components when Server Components can fetch instead.`
          )
        );
      }
    }

    return diagnostics;
  },
};
