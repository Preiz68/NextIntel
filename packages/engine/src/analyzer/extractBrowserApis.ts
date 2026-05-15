import { SourceFile, SyntaxKind } from "ts-morph";
import { BROWSER_GLOBALS } from "./constants.js";
import type { BrowserAPIUsage } from "./types.js";

export function extractBrowserAPIs(sourceFile: SourceFile): BrowserAPIUsage[] {
  const counts = new Map<string, number>();

  sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    if (!BROWSER_GLOBALS.has(name as any)) return;

    // Skip import/export declarations — we only want runtime usages.
    const parent = id.getParent();
    if (!parent) return;
    if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
      if (parent.getNameNode() === id) return;
    }
    if (
      parent.isKind(SyntaxKind.ImportSpecifier) ||
      parent.isKind(SyntaxKind.ImportClause) ||
      parent.isKind(SyntaxKind.ExportSpecifier) ||
      parent.isKind(SyntaxKind.NamespaceImport)
    )
      return;

    // Skip type positions.
    if (
      parent.isKind(SyntaxKind.TypeReference) ||
      parent.isKind(SyntaxKind.QualifiedName)
    )
      return;

    counts.set(name, (counts.get(name) ?? 0) + 1);
  });

  return [...counts.entries()].map(([api, count]) => ({ api, count }));
}
