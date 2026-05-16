import { Rule, RuleContext, Diagnostic } from "../types.js";

export const noClientImportServerOnly: Rule = {
  id: "no-client-import-server-only",
  meta: {
    description: "Client Components cannot import Server-only modules or Server Actions directly.",
    severity: "error",
  },
  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const edge of (context as any).edges || []) {
      const fromNode = context.nodes.get(edge.from);
      const toNode = context.nodes.get(edge.to);

      if (fromNode?.isClientComponent && toNode?.isServerComponent) {
        // In Next.js, importing a 'use server' file in a 'use client' file 
        // is allowed for Server Actions, but importing a Server Component 
        // in a Client Component to render it is NOT allowed.
        // For the MVP, we flag any Client -> Server import as a warning/error
        // unless we can distinguish between Server Actions and Components.
        
        diagnostics.push({
          file: edge.from,
          severity: "error",
          ruleId: "no-client-import-server-only",
          message: `Client Component imports Server Component/Module: ${edge.to}. This will cause a runtime error if rendered directly.`,
          fix: "Pass the Server Component as 'children' or a prop instead of importing it directly.",
        });
      }
    }

    return diagnostics;
  },
};
