import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noBrowserGlobalsInClientRender: Rule = {
  id: "hydration-no-browser-globals-in-render",

  meta: {
    description:
      "Detects browser APIs used in the top-level render body of a Client Component that can cause hydration mismatches.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      const mismatches = (analysis.simulationFindings || []).filter(
        (f) => f.type === "hydration_mismatch"
      );
      for (const m of mismatches) {
        diagnostics.push(
          mapEventToDiagnostic(
            "RENDER_PHASE_BROWSER_API_ACCESS",
            "HY-RENDER-BROWSER-API-001",
            this.id,
            analysis.filePath,
            m.line,
            m.message
          )
        );
      }
    }

    return diagnostics;
  },
};
