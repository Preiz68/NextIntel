import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noServerApiInClientComponents: Rule = {
  id: "no-server-api-in-client-components",

  meta: {
    description:
      "Server-only Next.js APIs cannot be used in Client Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClientOrMixed =
        analysis.executionModel.componentType === "client" ||
        analysis.executionModel.componentType === "mixed";
      if (!isClientOrMixed) continue;

      const serverTaints = (analysis.taints || []).filter(
        (t) =>
          t.type === "SERVER_ONLY" ||
          t.type === "REQUEST_CONTEXT" ||
          t.type === "PROCESS_ENV" ||
          t.type === "NODE_NATIVE_API"
      );

      for (const t of serverTaints) {
        diagnostics.push(
          mapEventToDiagnostic(
            "RENDER_PHASE_SERVER_API_ACCESS",
            "CC-RUNTIME-LEAK-001",
            this.id,
            analysis.filePath,
            t.line,
            `Server-only API or module (e.g. from '${t.source}') is imported or used in a Client Component.`
          )
        );
      }
    }

    return diagnostics;
  },
};
