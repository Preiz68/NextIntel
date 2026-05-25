import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
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
      const isClient = analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      const hasAsyncViolation =
        analysis.executionModel.boundaryViolations.includes(
          "async client component"
        );
      if (hasAsyncViolation) {
        let line = 1;
        try {
          const content = readFileSync(analysis.filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (
              lines[i]!.includes("async function") &&
              lines[i]!.includes("export")
            ) {
              line = i + 1;
              break;
            }
          }
        } catch {
          // fallback to 1
        }

        diagnostics.push(
          mapEventToDiagnostic(
            "CLIENT_COMPONENT_ASYNC_EXECUTION",
            "CC-ASYNC-CLIENT-001",
            this.id,
            analysis.filePath,
            line,
            `Client Component is declared as an async function. Next.js Client Components cannot be async.`
          )
        );
      }
    }

    return diagnostics;
  },
};
