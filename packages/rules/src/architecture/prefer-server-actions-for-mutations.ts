import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const preferServerActionsForMutations: Rule = {
  id: "prefer-server-actions-for-mutations",

  meta: {
    description: "Suggest using Server Actions instead of custom Route Handlers for local form submissions and mutations.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || analysis.semanticKind === "client-component" || analysis.semanticKind === "client-util";
      if (!isClient) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      const postFetchRegex = /fetch\s*\(\s*['"`](\/api\/[^'"`]+)['"`]\s*,\s*\{[^}]*method\s*:\s*['"`](POST|PUT|DELETE|PATCH)['"`]/g;
      
      let match;
      while ((match = postFetchRegex.exec(content)) !== null) {
        const url = match[1]!;
        const method = match[2]!;
        const lines = content.substring(0, match.index).split("\n");
        const line = lines.length;

        diagnostics.push({
          file: analysis.filePath,
          line: line,
          severity: "warning",
          ruleId: this.id,
          id: "AR-ACTION-MUTATE-001",
          message: `Client mutation performs direct '${method}' fetch to local API endpoint '${url}'. Consider refactoring to a type-safe Server Action to simplify state updates, security, and cache revalidation.`,
          whyItMatters: "Using custom Route Handlers for client-side form submissions or mutations requires manually implementing CSRF protection, endpoint typing, and cache invalidation. Next.js Server Actions automatically handle CSRF, integrate natively with HTML forms and React transitions, and support immediate server-side cache revalidation.",
          quickFixes: [
            "Refactor the mutation into a Server Action ('use server') and import it.",
            "Use useTransition / useActionState hook to manage the form state."
          ],
          architectureSuggestions: [
            "Convert Form Submit: form action={serverAction} instead of onSubmit={handleSubmit} with custom fetch."
          ],
          productionRisks: [
            "CSRF vulnerability on custom POST endpoints if cookies are unchecked",
            "Mismatched schema types between client fetch body and server request parser",
            "Broken client-side Router Cache synchronization after mutations"
          ]
        });
      }
    }

    return diagnostics;
  }
};
