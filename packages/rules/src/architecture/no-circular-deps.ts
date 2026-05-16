import { Rule, RuleContext, Diagnostic } from "../types.js";
import { detectCycles } from "../../../engine/src/graph/detectCycles.js";

export const noCircularDeps: Rule = {
  id: "no-circular-deps",
  meta: {
    description:
      "Circular dependencies should be avoided as they can cause runtime issues and poor maintainability.",
    severity: "warning",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];
    const cycleReport = detectCycles(context.graph);

    if (cycleReport.hasCycles) {
      for (const cycle of cycleReport.cycles) {
        diagnostics.push({
          file: cycle[0]!, // Report on the first file of the cycle
          severity: "warning",
          ruleId: "no-circular-deps",
          message: `Circular dependency detected: ${cycle.join(" -> ")}`,
        });
      }
    }

    return diagnostics;
  },
};
