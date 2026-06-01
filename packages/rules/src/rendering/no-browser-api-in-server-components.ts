import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noBrowserApiInServerComponents: Rule = {
  id: "no-browser-api-in-server-components",

  meta: {
    description:
      "Browser APIs (window, document, localStorage, etc.) cannot be used in Server Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const leaks = (analysis.simulationFindings || []).filter(
        (f) => f.type === "ssr_leak"
      );
      for (const leak of leaks) {
        diagnostics.push(
          mapEventToDiagnostic(
            "RENDER_PHASE_BROWSER_API_ACCESS",
            "SC-BROWSER-API-001",
            this.id,
            analysis.filePath,
            leak.line,
            leak.message,
            leak.severity === "LOW",
            leak.column,
            leak.endColumn
          )
        );
      }
    }

    return diagnostics;
  },
};
