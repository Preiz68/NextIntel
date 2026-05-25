import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export function isTypeNonSerializable(type: any): boolean {
  if (!type) return false;

  // 1. Functions
  if (type.getCallSignatures().length > 0) return true;

  // 2. Map, Set, Symbol
  const typeText = type.getText();
  if (
    typeText === "symbol" ||
    typeText.startsWith("Symbol") ||
    typeText.startsWith("Map<") ||
    typeText === "Map" ||
    typeText.startsWith("Set<") ||
    typeText === "Set"
  ) {
    return true;
  }

  // 3. Class instances (excluding Date)
  const symbol = type.getSymbol();
  if (symbol) {
    const name = symbol.getName();
    if (name === "Date") return false;
    if (name === "Map" || name === "Set" || name === "Symbol") return true;

    const decls = symbol.getDeclarations();
    if (decls.some((d: any) => d.getKind() === SyntaxKind.ClassDeclaration)) {
      return true;
    }
  }

  return false;
}

function isNonSerializable(expr: any): boolean {
  if (!expr) return false;
  const kind = expr.getKindName();
  if (
    kind === "ArrowFunction" ||
    kind === "FunctionExpression" ||
    kind === "ClassExpression" ||
    kind === "ClassDeclaration" ||
    kind === "FunctionDeclaration"
  ) {
    return true;
  }

  try {
    const type = expr.getType();
    if (type && isTypeNonSerializable(type)) {
      return true;
    }
  } catch {
    // ignore
  }

  if (kind === "Identifier") {
    try {
      const symbol = expr.getSymbol();
      if (symbol) {
        const decls = symbol.getDeclarations();
        for (const decl of decls) {
          const declKind = decl.getKindName();
          if (
            declKind === "FunctionDeclaration" ||
            declKind === "ClassDeclaration" ||
            declKind === "ArrowFunction" ||
            declKind === "FunctionExpression" ||
            declKind === "MethodDeclaration"
          ) {
            return true;
          }
          if (declKind === "VariableDeclaration") {
            const init = (decl as any).getInitializer();
            if (init) {
              const initKind = init.getKindName();
              if (
                initKind === "ArrowFunction" ||
                initKind === "FunctionExpression" ||
                initKind === "ClassExpression"
              ) {
                return true;
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return false;
}

export const propsMustBeSerializable: Rule = {
  id: "props-must-be-serializable",

  meta: {
    description: "Props passed from Server to Client Components must be serializable.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServerCtx = analysis.executionModel.componentType === "server";
      if (!isServerCtx) continue;

      const hasViolation = analysis.executionModel.boundaryViolations.includes(
        "non-serializable prop passed to client component"
      );
      if (!hasViolation) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

      let reported = false;

      sourceFile.forEachDescendant((node) => {
        const kind = node.getKindName();
        if (kind === "JsxOpeningElement" || kind === "JsxSelfClosingElement") {
          const tagNameNode = (node as any).getTagNameNode();
          if (tagNameNode) {
            const tagName = tagNameNode.getText();
            // Check if tag name is capitalized (indicates a custom component, not raw HTML element)
            if (tagName && tagName[0] === tagName[0].toUpperCase()) {
              const attributes = (node as any).getAttributes();
              for (const attr of attributes) {
                if (attr.getKindName() === "JsxAttribute") {
                  const init = attr.getInitializer();
                  if (init && init.getKindName() === "JsxExpression") {
                    const expr = init.getExpression();
                    if (expr && isNonSerializable(expr)) {
                      const propName = attr.getName();
                      const line = attr.getStartLineNumber();

                      diagnostics.push(
                        mapEventToDiagnostic(
                          "BOUNDARY_VIOLATION_DETECTED",
                          "SC-SERIALIZATION-001",
                          this.id,
                          analysis.filePath,
                          line,
                          `Non-serializable value passed to prop '${propName}' of Client Component '<${tagName}>'.`
                        )
                      );
                      reported = true;
                    }
                  }
                }
              }
            }
          }
        }
      });

      if (!reported) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SC-SERIALIZATION-001",
            this.id,
            analysis.filePath,
            1,
            `Non-serializable props are passed to Client Components from this Server Component.`
          )
        );
      }
    }

    return diagnostics;
  },
};
