import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

function hasAuthVerification(bodyText: string): boolean {
  const lowercaseBody = bodyText.toLowerCase();
  const keywords = [
    "auth(",
    "auth.",
    "session",
    "token",
    "currentuser",
    "getserversession",
    "getsession",
  ];
  return keywords.some((kw) => lowercaseBody.includes(kw));
}

export const serverActionsAuth: Rule = {
  id: "server-actions-auth",

  meta: {
    description:
      "Every Server Action must validate authentication and authorization.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const missingAuth = (analysis.simulationFindings || []).filter(
        (f) => f.type === "action_missing_auth"
      );
      for (const f of missingAuth) {
        diagnostics.push(
          mapEventToDiagnostic(
            "SERVER_ACTION_MISSING_AUTH",
            "SA-AUTH-001",
            this.id,
            analysis.filePath,
            f.line,
            f.message
          )
        );
      }
    }

    return diagnostics;
  },
};
