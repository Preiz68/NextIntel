import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind, Node } from "ts-morph";
import path from "node:path";

export const actionArchitectureRules: Rule = {
  id: "action-architecture-rules",

  meta: {
    description: "Enforce security, type-safety, and validation rules for Next.js Server Actions.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isActionFile = analysis.hasTopLevelUseServer || analysis.semanticKind === "server-action";
      if (!isActionFile) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_sa_rules.ts", content);
        const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const arrowVars = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);

        for (const func of functions) {
          if (!func.isExported()) continue;
          checkServerAction(func, analysis.filePath, func.getName() ?? "default", diagnostics);
        }

        for (const v of arrowVars) {
          const init = v.getInitializer();
          if (init && (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression)) {
            const varStatement = v.getFirstAncestorByKind(SyntaxKind.VariableStatement);
            if (varStatement && varStatement.isExported()) {
              checkServerAction(init, analysis.filePath, v.getName(), diagnostics);
            }
          }
        }

      } catch (e) {
        // ignore
      }
    }

    return diagnostics;
  }
};

function checkServerAction(func: Node, filePath: string, actionName: string, diagnostics: Diagnostic[]) {
  const line = func.getStartLineNumber();
  const body = (func as any).getBody ? (func as any).getBody() : null;
  const bodyText = body ? body.getText() : "";

  // 1. SA-PREFIX-MUTATE (Naming Verbs)
  const allowedPrefixes = ["mutate", "action", "submit", "create", "update", "delete", "post", "add", "remove", "save"];
  const hasValidPrefix = allowedPrefixes.some(p => actionName.toLowerCase().startsWith(p));
  if (!hasValidPrefix && actionName !== "default") {
    diagnostics.push({
      file: filePath,
      line,
      severity: "warning",
      ruleId: "action-architecture-rules",
      id: "SA-PREFIX-MUTATE",
      message: `Server Action '${actionName}' does not use a mutating verb prefix. Consider renaming it to start with create, update, delete, or mutate to distinguish it from queries.`,
      whyItMatters: "Server Actions are strictly for state mutations. Naming them with clear verbs distinguishes them from read queries, improving developer scannability."
    });
  }

  // 2. SA-INPUT-TYPING (No raw 'any' inputs)
  if ("getParameters" in func) {
    const params = (func as any).getParameters();
    for (const p of params) {
      const typeNode = p.getTypeNode();
      if (!typeNode || typeNode.getText() === "any") {
        diagnostics.push({
          file: filePath,
          line: p.getStartLineNumber(),
          severity: "warning",
          ruleId: "action-architecture-rules",
          id: "SA-INPUT-TYPING",
          message: `Server Action parameter '${p.getName()}' has type 'any'. Enforce explicit parameter types for type safety at mutation boundaries.`,
          whyItMatters: "Server Actions receive arguments from client-side callers. Using 'any' bypasses build-time type verification, exposing the action to payload injection."
        });
      }

      // 3. SA-UPLOAD-LIMITS (Warn on direct File/Blob parameters)
      const pTypeText = p.getType().getText();
      if (pTypeText.includes("File") || pTypeText.includes("Blob") || p.getName().toLowerCase().includes("file")) {
        diagnostics.push({
          file: filePath,
          line: p.getStartLineNumber(),
          severity: "warning",
          ruleId: "action-architecture-rules",
          id: "SA-UPLOAD-LIMITS",
          message: `Server Action parameter '${p.getName()}' appears to receive a file or raw blob directly. For performance and scaling, upload files to signed storage URLs (e.g. S3) instead.`,
          whyItMatters: "Directly uploading files through Server Actions blocks Node.js worker threads and increases serverless execution memory, leading to connection timeouts."
        });
      }
    }
  }

  if (bodyText) {
    // 4. SA-NO-NESTED-CALLS (Nested actions)
    if (/\bawait\s+[a-zA-Z0-9_]+Action\s*\(/g.test(bodyText)) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-NO-NESTED-CALLS",
        message: `Server Action '${actionName}' invokes another Server Action directly. Avoid nesting action calls.`,
        whyItMatters: "Invoking another Server Action directly creates tight coupling and replicates transaction lifecycles, leading to unexpected database locks."
      });
    }

    // 5. SA-RETURN-CONTRACT (Standard status object)
    const returnsPlainObject = bodyText.includes("return {") || bodyText.includes("return Promise.resolve({");
    const returnsStatusObject = bodyText.includes("success:") || bodyText.includes("error:");
    if (returnsPlainObject && !returnsStatusObject) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-RETURN-CONTRACT",
        message: `Server Action '${actionName}' returns an object that does not conform to a standard { success: boolean, error?: string } schema.`,
        whyItMatters: "Standardizing mutation return schemas simplifies error boundaries and loading states in Client Components."
      });
    }

    // 6. SA-REDACT-DTO (Direct database entity return)
    if (/\breturn\s+(db\.|prisma\.|drizzle\.)/g.test(bodyText) || /\breturn\s+user\b/i.test(bodyText)) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-REDACT-DTO",
        message: `Server Action '${actionName}' returns a raw database model or user entity directly. Return a redacted Data Transfer Object (DTO) instead.`,
        whyItMatters: "Directly returning database schemas to clients exposes database fields (like passwords, metadata) and couples UI bindings directly to SQL schemas."
      });
    }

    // 7. SA-CSRF-CHECK (CSRF checking calls)
    const containsAuthCheck = /\b(session|auth|headers|cookies|checkAuth)\b/g.test(bodyText);
    if (!containsAuthCheck) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-CSRF-CHECK",
        message: `Server Action '${actionName}' lacks visible authorization or session check calls. Verify credentials in each action endpoint.`,
        whyItMatters: "Server Actions compile to exposed POST endpoints. Any client can invoke them directly, bypassing UI-level route checks."
      });
    }

    // 8. SA-INPUT-REDACTION (Unsafe logging of secrets)
    const logsSecrets = /console\.log\([^)]*(password|secret|key|token|card)[^)]*\)/i.test(bodyText);
    if (logsSecrets) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-INPUT-REDACTION",
        message: `Server Action '${actionName}' might log raw secrets or credentials (password, secret, token) to console logs.`,
        whyItMatters: "Logging raw request arguments containing user credentials leaks sensitive data to serverless cloud logs."
      });
    }

    // 9. SA-MUTATE-STATE (Global mutation warning)
    const mutatesGlobal = /\b(global\.|let\s+\w+\s*=|\b\w+\s*=\s*(?!await|db|res|data|const|let|var))/i.test(bodyText) && !bodyText.includes("db.") && !bodyText.includes("prisma.");
    if (mutatesGlobal && /^[a-zA-Z0-9_]+\s*=\s*/g.test(bodyText)) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-MUTATE-STATE",
        message: `Server Action '${actionName}' mutates outer scope variables. Serverless environments are stateless; outer variables are not shared across requests.`,
        whyItMatters: "Global variable state is reset on serverless function restarts, causing state inconsistencies."
      });
    }

    // 10. SA-RATE-LIMIT (Suggest rate limit check on auth/writes)
    const isSensitive = /\b(login|register|resetPassword|payment|checkout|charge|checkoutSession)\b/i.test(actionName);
    if (isSensitive && !bodyText.includes("rateLimit") && !bodyText.includes("throttle")) {
      diagnostics.push({
        file: filePath,
        line,
        severity: "warning",
        ruleId: "action-architecture-rules",
        id: "SA-RATE-LIMIT",
        message: `Server Action '${actionName}' handles sensitive state mutations but has no rate-limiting check.`,
        whyItMatters: "Public actions mutative in nature can be abused by automated bots if rate limiting is omitted."
      });
    }
  }
}
