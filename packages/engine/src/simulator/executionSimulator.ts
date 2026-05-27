import { SourceFile, SyntaxKind, FunctionDeclaration, ArrowFunction, FunctionExpression, Node } from "ts-morph";
import type { SemanticFileAnalysis } from "../classifier/types.js";
import { isInsideDeferredScope, isNodeConditionallyGuarded } from "../taint/taintEngine.js";

export interface SimulationFinding {
  type: "ssr_leak" | "hydration_mismatch" | "action_missing_auth" | "action_missing_validation" | "action_browser_api";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
  line: number;
  symbol?: string;
}

export interface SimulationResult {
  filePath: string;
  findings: SimulationFinding[];
}

/**
 * Check if a Server Action body performs authentication and schema validation.
 */
function analyzeServerAction(
  actionNode: FunctionDeclaration | ArrowFunction | FunctionExpression,
  filePath: string
): SimulationFinding[] {
  const findings: SimulationFinding[] = [];
  const body = actionNode.getBody();
  if (!body) return [];

  const statements = body.isKind(SyntaxKind.Block) 
    ? body.asKindOrThrow(SyntaxKind.Block).getStatements()
    : [body];

  let hasAuth = false;
  let hasValidation = false;
  let authLine = -1;
  let validationLine = -1;

  // Let's inspect the statements to find calls related to auth and validation
  statements.forEach((stmt, index) => {
    const text = stmt.getText();

    // Heuristics for auth checks
    if (
      text.includes("auth(") ||
      text.includes("getSession(") ||
      text.includes("session") ||
      text.includes("getCurrentUser") ||
      text.includes("currentUser(")
    ) {
      if (!hasAuth) {
        hasAuth = true;
        authLine = stmt.getStartLineNumber();
      }
    }

    // Heuristics for validation checks
    if (
      text.includes("parse(") ||
      text.includes("safeParse(") ||
      text.includes("validate(") ||
      text.includes("Schema")
    ) {
      if (!hasValidation) {
        hasValidation = true;
        validationLine = stmt.getStartLineNumber();
      }
    }
  });

  const line = actionNode.getStartLineNumber();

  if (!hasAuth) {
    findings.push({
      type: "action_missing_auth",
      severity: "CRITICAL",
      message: `Server Action is missing authentication gate check. Secure action endpoints by checking auth() first.`,
      line
    });
  }

  if (!hasValidation) {
    findings.push({
      type: "action_missing_validation",
      severity: "CRITICAL",
      message: `Server Action is missing input schema validation. Run parse() or safeParse() on arguments.`,
      line
    });
  }

  return findings;
}

export class ExecutionSimulator {
  simulate(analyses: SemanticFileAnalysis[]): Map<string, SimulationResult> {
    const results = new Map<string, SimulationResult>();

    for (const a of analyses) {
      const findings: SimulationFinding[] = [];

      // Pass 1: SSR / RSC Render Pass
      if (a.runtimeType === "SERVER_COMPONENT") {
        // Find browser globals accessed directly
        a.browserAPIs.forEach((api) => {
          findings.push({
            type: "ssr_leak",
            severity: api.isGuarded ? "LOW" : "CRITICAL",
            message: api.isGuarded
              ? `Browser global '${api.api}' is referenced in Server Component inside a runtime guard. It is conditionally executed but not safe under static analysis.`
              : `Browser global '${api.api}' is evaluated during server-side RSC render pass, causing runtime ReferenceError.`,
            line: api.line,
            symbol: api.api
          });
        });
      }

      // Pass 2: Hydration Pass (for Client Components)
      if (a.runtimeType === "CLIENT_COMPONENT") {
        // If a browser API is used, but it's not guarded and is evaluated during the first render pass
        a.browserAPIs.forEach((api) => {
          // If it affects render
          if (api.affectsRender) {
            findings.push({
              type: "hydration_mismatch",
              severity: api.isGuarded ? "LOW" : "HIGH",
              message: api.isGuarded
                ? `Browser API '${api.api}' is read during top-level render of Client Component inside a runtime guard, which reduces but does not eliminate hydration risks.`
                : `Browser API '${api.api}' is read during top-level render of Client Component, triggering a hydration mismatch.`,
              line: api.line,
              symbol: api.api
            });
          }
        });
      }

      // Pass 3: Server Action Execution Pass
      if (a.semanticKind === "server-action") {
        // We can check if any browser APIs are accessed inside the action
        a.browserAPIs.forEach((api) => {
          findings.push({
            type: "action_browser_api",
            severity: api.isGuarded ? "LOW" : "CRITICAL",
            message: api.isGuarded
              ? `Browser global '${api.api}' is referenced inside a Server Action within a runtime guard. It will not execute on the server but is a false-safe path.`
              : `Browser global '${api.api}' is referenced inside a Server Action, which runs exclusively on Node.js/Edge server runtimes.`,
            line: api.line,
            symbol: api.api
          });
        });
      }

      results.set(a.filePath, {
        filePath: a.filePath,
        findings
      });
    }

    return results;
  }

  /**
   * Run deep AST-level checks on Server Actions.
   */
  static runASTActionChecks(sourceFile: SourceFile): SimulationFinding[] {
    const findings: SimulationFinding[] = [];

    // Let's find functions containing "use server" at the top of their body,
    // or if the whole file has "use server" at the top, inspect all exported functions.
    const hasFileDirective = sourceFile.getStatements().some((s) => {
      const txt = s.getText().trim();
      return txt === '"use server"' || txt === "'use server'";
    });

    const checkFunction = (node: FunctionDeclaration | ArrowFunction | FunctionExpression) => {
      let isAction = false;
      if (hasFileDirective) {
        if (Node.isFunctionDeclaration(node)) {
          isAction = node.isExported();
        } else {
          const varStatement = node.getFirstAncestorByKind(SyntaxKind.VariableStatement);
          isAction = varStatement ? varStatement.isExported() : false;
        }
      }
      if (!isAction) {
        // Check if it has "use server" inside the body
        const body = node.getBody();
        if (body && body.isKind(SyntaxKind.Block)) {
          const firstStmt = body.asKindOrThrow(SyntaxKind.Block).getStatements()[0];
          if (firstStmt) {
            const txt = firstStmt.getText().trim().replace(/;$/, "");
            if (txt === '"use server"' || txt === "'use server'") {
              isAction = true;
            }
          }
        }
      }

      if (isAction) {
        findings.push(...analyzeServerAction(node, sourceFile.getFilePath()));
      }
    };

    sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).forEach(checkFunction);
    sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach(checkFunction);
    sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression).forEach(checkFunction);

    return findings;
  }
}
