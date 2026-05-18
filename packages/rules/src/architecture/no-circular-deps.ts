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

    const constraint = context.knowledgeRegistry.getConstraint("bundling", "BD-003");
    
    const whyItMatters = constraint?.whyItMatters ?? "Circular dependencies complicate bundle building and can lead to runtime reference bugs.";
    const quickFixes = constraint?.quickFixes ?? ["Refactor the cycle by extracting shared logic to a common dependency file."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    if (cycleReport.hasCycles) {
      for (const cycle of cycleReport.cycles) {
        diagnostics.push({
          file: cycle[0]!, // Report on the first file of the cycle
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "BD-003",
          message: `Circular dependency detected: ${cycle.join(" -> ")}. ${constraint?.problem ?? ""}`,
          fix: quickFixes[0],
          whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: constraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
