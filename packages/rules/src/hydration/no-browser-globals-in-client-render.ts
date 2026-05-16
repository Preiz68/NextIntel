import { Rule, RuleContext, Diagnostic } from "../types.js";

/**
 * Rule: no-browser-globals-in-client-render
 * Warns if browser-only APIs are used in the top-level render of a client component.
 */
export const noBrowserGlobalsInClientRender: Rule = {
  id: "hydration-no-browser-globals-in-render",
  meta: {
    description: "Detects browser APIs used in Client Component render body.",
    severity: "warning",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      // Only apply to Client Components
      if (!analysis.isClientComponent) continue;

      for (const apiUsage of analysis.browserAPIs) {
        diagnostics.push({
          ruleId: this.id,
          message: `Browser API '${apiUsage.api}' used in Client Component. To avoid hydration mismatches, move it to useEffect or an event handler.`,
          severity: "warning",
          file: analysis.filePath,
        });
      }
    }

    return diagnostics;
  },
};
