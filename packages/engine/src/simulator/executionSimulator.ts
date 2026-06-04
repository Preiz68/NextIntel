import { SourceFile, SyntaxKind, FunctionDeclaration, ArrowFunction, FunctionExpression, Node } from "ts-morph";
import type { SemanticFileAnalysis } from "../classifier/types.js";
import { isInsideDeferredScope, isNodeConditionallyGuarded } from "../taint/taintEngine.js";

export interface SimulationFinding {
  type: "ssr_leak" | "hydration_mismatch" | "action_missing_auth" | "action_missing_validation" | "action_browser_api";
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  message: string;
  line: number;
  column?: number;
  endColumn?: number;
  symbol?: string;
}

export interface SimulationResult {
  filePath: string;
  findings: SimulationFinding[];
}

function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-\.]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function isMutationAction(
  actionNode: FunctionDeclaration | ArrowFunction | FunctionExpression
): boolean {
  const baseMutationKeywords = ["create", "update", "delete", "insert", "remove", "save", "patch", "upsert", "write", "execute", "replace"];

  // 1. Check if the function name or variable assignment name contains mutation keywords as whole words
  let actionName = "";
  if (Node.isFunctionDeclaration(actionNode)) {
    actionName = actionNode.getName() || "";
  } else {
    const varDec = actionNode.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDec) {
      actionName = varDec.getName();
    }
  }
  if (actionName) {
    const words = splitWords(actionName);
    if (baseMutationKeywords.some(kw => words.includes(kw))) {
      return true;
    }
  }

  // 2. Check all method/function calls in the action body
  const callExprs = actionNode.getDescendantsOfKind(SyntaxKind.CallExpression);
  for (const call of callExprs) {
    const expression = call.getExpression();
    let name = "";
    if (Node.isPropertyAccessExpression(expression)) {
      name = expression.getName();
    } else if (Node.isIdentifier(expression)) {
      name = expression.getText();
    }
    
    if (name) {
      const words = splitWords(name);
      if (baseMutationKeywords.some(kw => words.includes(kw))) {
        return true;
      }
    }
  }

  // 3. Check for SQL/raw queries in string or template literals
  const strings = actionNode.getDescendantsOfKind(SyntaxKind.StringLiteral);
  const templates = actionNode.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral);
  const templateHeads = actionNode.getDescendantsOfKind(SyntaxKind.TemplateHead);
  const templateSpans = actionNode.getDescendantsOfKind(SyntaxKind.TemplateMiddle);
  const templateTails = actionNode.getDescendantsOfKind(SyntaxKind.TemplateTail);
  
  const textNodes = [...strings, ...templates, ...templateHeads, ...templateSpans, ...templateTails];
  const sqlMutationRegex = /\b(insert\s+into|update\s+|delete\s+from|drop\s+table|alter\s+table)\b/i;
  
  for (const node of textNodes) {
    try {
      if (sqlMutationRegex.test(node.getLiteralText())) {
        return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
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

  const params = actionNode.getParameters();
  const paramNames = params.map((p) => p.getName()).filter(Boolean);

  let hasAuth = false;
  let hasValidation = params.length === 0;
  let authLine = -1;
  let validationLine = -1;

  if (!hasValidation && paramNames.length > 0) {
    const hasTypeGuard = actionNode.getDescendantsOfKind(SyntaxKind.IfStatement).some(ifStmt => {
      const condText = ifStmt.getExpression().getText();
      return paramNames.some(name => {
        const regex = new RegExp(`\\b${name}\\b`);
        if (!regex.test(condText)) return false;
        return condText.includes("typeof") || condText.includes("===") || condText.includes("!==") || condText.includes("==") || condText.includes("!=") || condText.startsWith("!");
      });
    });
    if (hasTypeGuard) {
      hasValidation = true;
    }
  }

  const statements = body.isKind(SyntaxKind.Block) 
    ? body.asKindOrThrow(SyntaxKind.Block).getStatements()
    : [body];

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
  const sourceFile = actionNode.getSourceFile();
  const startLoc = sourceFile.getLineAndColumnAtPos(actionNode.getStart());
  const endLoc = sourceFile.getLineAndColumnAtPos(actionNode.getEnd());
  const column = startLoc.column - 1;
  const endColumn = endLoc.column - 1;

  // Only require authentication for Server Actions that perform mutations
  if (!hasAuth && isMutationAction(actionNode)) {
    findings.push({
      type: "action_missing_auth",
      severity: "CRITICAL",
      message: `Server Action is missing authentication gate check. Secure action endpoints by checking auth() first.`,
      line,
      column,
      endColumn,
    });
  }

  if (!hasValidation) {
    findings.push({
      type: "action_missing_validation",
      severity: "CRITICAL",
      message: `Server Action is missing input schema validation. Run parse() or safeParse() on arguments.`,
      line,
      column,
      endColumn,
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
          if (api.isGuarded) return; // Exempt guarded ones from Server Component leaks!
          findings.push({
            type: "ssr_leak",
            severity: "CRITICAL",
            message: `Browser global '${api.api}' is evaluated during server-side RSC render pass, causing runtime ReferenceError.`,
            line: api.line,
            column: api.column,
            endColumn: api.endColumn,
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
              column: api.column,
              endColumn: api.endColumn,
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
            column: api.column,
            endColumn: api.endColumn,
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
      const txt = s.getText().trim().replace(/;$/, "");
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
