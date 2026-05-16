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
        const apis = analysis.browserAPIs.map((a: { api: string }) => a.api).join(", ");
        diagnostics.push({
          file: analysis.filePath,
          severity: "error",
          ruleId: "no-browser-api-in-server-components",
          message: `File uses browser APIs (${apis}) but is a Server Component. These APIs are only available in Client Components.`,
          fix: `"use client";`,
        });
      }
    }

    return diagnostics;
  },
};
