import { SourceFile, SyntaxKind, Node } from "ts-morph";
import { BROWSER_GLOBALS } from "./constants.js";
import type { BrowserAPIUsage } from "./types.js";
import { doesValueAffectRender } from "./renderDivergence.js";

/**
 * Checks if a node is nested inside a deferred execution context,
 * such as a useEffect/useLayoutEffect hook callback or an event handler function.
 * This makes it safe to reference browser globals (like window/localStorage) without
 * causing Server-Side Rendering (SSR) hydration mismatches.
 */
function isInsideDeferredScope(node: Node): boolean {
  let parent = node.getParent();
  while (parent) {
    // 1. Check if inside a useEffect / useLayoutEffect hook call
    if (parent.isKind(SyntaxKind.CallExpression)) {
      const callee = parent.getExpression().getText();
      if (
        callee === "useEffect" ||
        callee === "useLayoutEffect" ||
        callee.endsWith(".useEffect") ||
        callee.endsWith(".useLayoutEffect")
      ) {
        return true;
      }
    }

    // 2. Check if inside a nested callback or handler function
    // (a function nested inside another function/component is safe because it doesn't run during render)
    if (
      parent.isKind(SyntaxKind.FunctionDeclaration) ||
      parent.isKind(SyntaxKind.FunctionExpression) ||
      parent.isKind(SyntaxKind.ArrowFunction)
    ) {
      const outerFunction =
        parent.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        parent.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
        parent.getFirstAncestorByKind(SyntaxKind.FunctionExpression);

      if (outerFunction) {
        return true;
      }
    }

    parent = parent.getParent();
  }
  return false;
}

function isNodeConditionallyGuarded(node: Node): boolean {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    
    if (kind === SyntaxKind.IfStatement) {
      const ifStmt = parent.asKindOrThrow(SyntaxKind.IfStatement);
      const condText = ifStmt.getExpression().getText();
      if (
        condText.includes("window") ||
        condText.includes("document") ||
        condText.includes("process.env") ||
        condText.includes("globalThis")
      ) {
        return true;
      }
    } else if (kind === SyntaxKind.ConditionalExpression) {
      const condExpr = parent.asKindOrThrow(SyntaxKind.ConditionalExpression);
      const condText = condExpr.getCondition().getText();
      if (
        condText.includes("window") ||
        condText.includes("document") ||
        condText.includes("process.env") ||
        condText.includes("globalThis")
      ) {
        return true;
      }
    } else if (kind === SyntaxKind.BinaryExpression) {
      const binExpr = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
      const op = binExpr.getOperatorToken().getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken) {
        const leftText = binExpr.getLeft().getText();
        if (
          leftText.includes("window") ||
          leftText.includes("document") ||
          leftText.includes("process.env") ||
          leftText.includes("globalThis")
        ) {
          return true;
        }
      }
    }
    
    parent = parent.getParent();
  }
  return false;
}

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
    if (parent.isKind(SyntaxKind.Parameter) && parent.getNameNode() === id) {
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
        const isLib =
          declPath.includes("typescript/lib") ||
          declPath.includes("node_modules");
        return !isLib;
      });

      if (isLocalUserDeclaration) {
        // It's a custom user naming, not a true global Browser API reference.
        return;
      }
    }

    // ─── Deferred Execution / SSR Safety Check ────────────────────────────
    // Skip if referencing a browser global inside a deferred scope (like useEffect or click handler).
    // These do not run during the Server render phase, so they are perfectly safe.
    if (isInsideDeferredScope(id)) {
      return;
    }

    // Get 1-based line number where the browser API identifier is used
    const line = id.getStartLineNumber();
    const affectsRender = doesValueAffectRender(id);
    const isGuarded = isNodeConditionallyGuarded(id);

    usages.push({
      api: name,
      count: 1,
      line,
      affectsRender,
      isGuarded,
    });
  });

  return usages;
}
