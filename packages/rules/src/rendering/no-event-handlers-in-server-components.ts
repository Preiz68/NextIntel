import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noEventHandlersInServerComponents: Rule = {
  id: "no-event-handlers-in-server-components",

  meta: {
    description: "Event handlers cannot be attached inside Server Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const hasViolation = analysis.executionModel.boundaryViolations.includes(
        "event handler in server component"
      );
      if (!hasViolation) continue;

      let fileLines: string[] = [];
      try {
        const content = readFileSync(analysis.filePath, "utf-8");
        fileLines = content.split("\n");
      } catch {
        // Safe skip reading file
      }

      let reported = false;
      const forbidden = [
        "onClick",
        "onChange",
        "onSubmit",
        "onKeyDown",
        "onKeyUp",
      ];

      for (let i = 0; i < fileLines.length; i++) {
        const lineText = fileLines[i]!;
        const matchedPattern = forbidden.find((p) => {
          const regex = new RegExp(`\\b${p}\\b\\s*=`);
          return regex.test(lineText);
        });

        if (matchedPattern) {
          diagnostics.push(
            mapEventToDiagnostic(
              "BOUNDARY_VIOLATION_DETECTED",
              "SC-EVENT-HANDLER-001",
              this.id,
              analysis.filePath,
              i + 1,
              `Event handler '${matchedPattern}' is attached in a Server Component.`
            )
          );
          reported = true;
        }
      }

      if (!reported) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SC-EVENT-HANDLER-001",
            this.id,
            analysis.filePath,
            1,
            `Event handlers are attached in a Server Component.`
          )
        );
      }
    }

    return diagnostics;
  },
};
