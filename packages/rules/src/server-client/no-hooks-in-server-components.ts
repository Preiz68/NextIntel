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
      if (analysis.isServerComponent && analysis.hooks.length > 0) {
        diagnostics.push({
          file: analysis.filePath,
          severity: "error",
          ruleId: "no-hooks-in-server-components",
          message: `File uses React hooks (${analysis.hooks.join(", ")}) but is a Server Component. Add "use client" at the top.`,
          fix: `"use client";`,
        });
      }
    }

    return diagnostics;
  },
};
