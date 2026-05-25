import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const serverActionsValidation: Rule = {
  id: "server-actions-validation",

  meta: {
    description: "Server Actions must validate input with schema validation.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const missingVal = (analysis.simulationFindings || []).filter(
        (f) => f.type === "action_missing_validation"
      );
      for (const f of missingVal) {
        diagnostics.push(
          mapEventToDiagnostic(
            "SERVER_ACTION_UNSAFE_INPUT",
            "SA-VALIDATION-001",
            this.id,
            analysis.filePath,
            f.line,
            f.message
          )
        );
      }
    }

    return diagnostics;
  },
};
