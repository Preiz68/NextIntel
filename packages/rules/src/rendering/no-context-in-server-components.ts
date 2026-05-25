import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noContextInServerComponents: Rule = {
  id: "no-context-in-server-components",

  meta: {
    description: "React Context is not supported in Server Components.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServerCtx = analysis.executionModel.componentType === "server";
      if (!isServerCtx) continue;

      const hasContextHook =
        analysis.executionModel.usesClientHooks.includes("createContext") ||
        analysis.executionModel.usesClientHooks.includes("useContext");

      if (!hasContextHook) continue;

      let reported = false;

      // 1. Check hookDetails
      for (const hook of analysis.hookDetails) {
        if (hook.name === "createContext" || hook.name === "useContext") {
          diagnostics.push(
            mapEventToDiagnostic(
              "BOUNDARY_VIOLATION_DETECTED",
              "SC-CONTEXT-001",
              this.id,
              analysis.filePath,
              hook.line,
              `React context feature '${hook.name}' is used in a Server Component.`
            )
          );
          reported = true;
        }
      }

      // 2. Search file lines if not reported via hookDetails
      if (!reported) {
        try {
          const content = readFileSync(analysis.filePath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i]!;
            if (
              lineText.includes("createContext") ||
              lineText.includes("useContext")
            ) {
              const feature = lineText.includes("createContext")
                ? "createContext"
                : "useContext";
              diagnostics.push(
                mapEventToDiagnostic(
                  "BOUNDARY_VIOLATION_DETECTED",
                  "SC-CONTEXT-001",
                  this.id,
                  analysis.filePath,
                  i + 1,
                  `React context feature '${feature}' is used in a Server Component.`
                )
              );
              reported = true;
            }
          }
        } catch {
          // Ignore read error
        }
      }

      // 3. Fallback
      if (!reported) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SC-CONTEXT-001",
            this.id,
            analysis.filePath,
            1,
            `React Context is used in a Server Component.`
          )
        );
      }
    }

    return diagnostics;
  },
};
