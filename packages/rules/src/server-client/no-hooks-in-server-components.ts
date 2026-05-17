import { Rule, RuleContext, Diagnostic } from "../types.js";

export const noHooksInServerComponents: Rule = {
  id: "no-hooks-in-server-components",
  meta: {
    description: "React hooks can only be used in Client Components.",
    severity: "error",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      if (analysis.isServerComponent && analysis.hookDetails.length > 0) {
        for (const hook of analysis.hookDetails) {
          diagnostics.push({
            file: analysis.filePath,
            severity: "error",
            ruleId: "no-hooks-in-server-components",
            message: `Hook '${hook.name}' is used but this is a Server Component. Add "use client" at the top.`,
            fix: `"use client";`,
            line: hook.line,
          });
        }
      }
    }

    return diagnostics;
  },
};
