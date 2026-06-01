import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noHooksInServerComponents: Rule = {
  id: "no-hooks-in-server-components",

  meta: {
    description: "React hooks can only be used in Client Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer || analysis.executionModel.usesClientHooks.length === 0)
        continue;

      for (const hook of analysis.hookDetails) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SC-HOOK-USAGE-001",
            this.id,
            analysis.filePath,
            hook.line,
            `React hook '${hook.name}' is used in a Server Component.`,
            false,
            hook.column,
            hook.endColumn
          )
        );
      }
    }

    return diagnostics;
  },
};
