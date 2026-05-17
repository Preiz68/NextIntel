import { SourceFile, SyntaxKind } from "ts-morph";
import { BROWSER_GLOBALS } from "./constants.js";
import type { BrowserAPIUsage } from "./types.js";

export function extractBrowserAPIs(sourceFile: SourceFile): BrowserAPIUsage[] {
  const usages: BrowserAPIUsage[] = [];

  sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    if (!BROWSER_GLOBALS.has(name as any)) return;

    // Skip import/export declarations — we only want runtime usages.
    const parent = id.getParent();
    if (!parent) return;

    // Skip if it is a property identifier of a property access expression (e.g. `obj.window`)
    // We only want to flag when `window` is the global itself (i.e. the expression start).
    if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
      if (parent.getNameNode() === id) return;
    }

    if (
      parent.isKind(SyntaxKind.ImportSpecifier) ||
      parent.isKind(SyntaxKind.ImportClause) ||
      parent.isKind(SyntaxKind.ExportSpecifier) ||
      parent.isKind(SyntaxKind.NamespaceImport)
    ) {
      return;
    }

    // Skip type positions.
    if (
      parent.isKind(SyntaxKind.TypeReference) ||
      parent.isKind(SyntaxKind.QualifiedName)
    ) {
      return;
    }

    // Skip variable/function declarations themselves (e.g., `const window = ...` or `function localStorage()`)
    if (
      parent.isKind(SyntaxKind.VariableDeclaration) &&
      parent.getNameNode() === id
    ) {
      return;
    }
    if (
      parent.isKind(SyntaxKind.Parameter) &&
      parent.getNameNode() === id
    ) {
      return;
    }
    if (
      (parent.isKind(SyntaxKind.FunctionDeclaration) ||
        parent.isKind(SyntaxKind.ClassDeclaration) ||
        parent.isKind(SyntaxKind.InterfaceDeclaration)) &&
      (parent as any).getNameNode?.() === id
    ) {
      return;
    }

    // ─── Semantic Check (ts-morph symbol resolution) ──────────────────────
    // Resolve the symbol of the identifier. If it maps to a user-defined
    // declaration in the workspace, it's just a local variable with a matching name.
    const symbol = id.getSymbol();
    if (symbol) {
      const declarations = symbol.getDeclarations();
      const isLocalUserDeclaration = declarations.some((decl) => {
        const declPath = decl.getSourceFile().getFilePath();
        // Global environment types (lib.dom.d.ts) contain 'typescript/lib'
        // External packages contain 'node_modules'
        // If it is NOT in those, it belongs to the user's workspace source code.
        const isLib = declPath.includes("typescript/lib") || declPath.includes("node_modules");
        return !isLib;
      });

      if (isLocalUserDeclaration) {
        // It's a custom user naming, not a true global Browser API reference.
        return;
      }
    }

    // Get 1-based line number where the browser API identifier is used
    const line = id.getStartLineNumber();

    usages.push({
      api: name,
      count: 1,
      line,
    });
  });

  return usages;
}
