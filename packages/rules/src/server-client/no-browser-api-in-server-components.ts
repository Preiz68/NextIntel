import { Rule, RuleContext, Diagnostic } from "../types.js";

export const noBrowserApiInServerComponents: Rule = {
  id: "no-browser-api-in-server-components",
  meta: {
    description: "Browser APIs (window, document, etc.) cannot be used in Server Components.",
    severity: "error",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      if (analysis.isServerComponent && analysis.usesBrowserAPI) {
        for (const b of analysis.browserAPIs) {
          diagnostics.push({
            file: analysis.filePath,
            severity: "error",
            ruleId: "no-browser-api-in-server-components",
            message: `Browser API '${b.api}' is used but this is a Server Component. These APIs are only available in Client Components.`,
            fix: `"use client";`,
            line: b.line,
          });
        }
      }
    }

    return diagnostics;
  },
};
