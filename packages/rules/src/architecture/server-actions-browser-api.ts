import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const serverActionsBrowserApi: Rule = {
  id: "server-actions-browser-api",

  meta: {
    description: "Browser APIs cannot be used in Server Actions.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const leaks = (analysis.simulationFindings || []).filter(
        (f) => f.type === "action_browser_api"
      );
      for (const leak of leaks) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SA-BROWSER-API-001",
            this.id,
            analysis.filePath,
            leak.line,
            leak.message,
            leak.severity === "LOW"
          )
        );
      }
    }

    return diagnostics;
  },
};
