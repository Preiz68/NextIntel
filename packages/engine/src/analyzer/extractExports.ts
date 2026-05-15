import { SourceFile, SyntaxKind, ExportedDeclarations } from "ts-morph";
import type { ExportInfo } from "./types.js";

function getKind(
  declarations: ReadonlyArray<ExportedDeclarations>,
): ExportInfo["kind"] {
  const first = declarations[0];
  if (!first) return "unknown";

  if (
    first.isKind(SyntaxKind.FunctionDeclaration) ||
    first.isKind(SyntaxKind.FunctionExpression) ||
    first.isKind(SyntaxKind.ArrowFunction)
  )
    return "function";

  if (
    first.isKind(SyntaxKind.ClassDeclaration) ||
    first.isKind(SyntaxKind.ClassExpression)
  )
    return "class";

  if (first.isKind(SyntaxKind.VariableDeclaration)) return "variable";

  if (first.isKind(SyntaxKind.TypeAliasDeclaration)) return "type";

  if (first.isKind(SyntaxKind.InterfaceDeclaration)) return "interface";

  if (first.isKind(SyntaxKind.EnumDeclaration)) return "enum";

  return "unknown";
}

export function extractExports(sourceFile: SourceFile): ExportInfo[] {
  const results: ExportInfo[] = [];
  const exportMap = sourceFile.getExportedDeclarations();

  for (const [name, declarations] of exportMap.entries()) {
    const isDefault = name === "default";

    // Detect type-only exports via ExportDeclaration nodes.
    const isTypeOnly = sourceFile
      .getExportDeclarations()
      .some(
        (ed) =>
          ed.isTypeOnly() &&
          ed.getNamedExports().some((ne) => ne.getName() === name),
      );

    results.push({
      name,
      isDefault,
      isTypeOnly,
      kind: getKind(declarations),
    });
  }

  return results;
}
