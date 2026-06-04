import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const serverActionsVsHandlers: Rule = {
  id: "server-actions-vs-handlers",

  meta: {
    description: "Use Server Actions for mutations, not inline Route Handlers.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isRouteHandler =
        analysis.executionModel.architectureFlags.includes("route-handler");
      if (!isRouteHandler) continue;

      const fp = analysis.filePath.replace(/\\/g, "/").toLowerCase();
      if (fp.includes("webhook") || fp.includes("webhooks")) continue;

      const hasMutatingMethod =
        analysis.exports.includes("POST") ||
        analysis.exports.includes("PUT") ||
        analysis.exports.includes("DELETE");

      if (hasMutatingMethod) {
        const methods = ["POST", "PUT", "DELETE"].filter((m) =>
          analysis.exports.includes(m)
        );

        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SA-ROUTE-HANDLER-001",
            this.id,
            analysis.filePath,
            1,
            `Route Handler exports mutating method(s) [${methods.join(
              ", "
            )}]. Prefer Server Actions for internal mutations.`
          )
        );
      }
    }

    return diagnostics;
  },
};
