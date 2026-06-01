import { SourceFile } from "ts-morph";
import type { ImportInfo } from "./types.js";

export function extractImports(sourceFile: SourceFile): ImportInfo[] {
  const imports: ImportInfo[] = [];

  // 1. Process ImportDeclarations
  sourceFile.getImportDeclarations().forEach((decl) => {
    const namedImports = decl.getNamedImports().map((n) => n.getName());
    const defaultImport = decl.getDefaultImport()?.getText() ?? null;
    const namespaceImport = decl.getNamespaceImport()?.getText() ?? null;
    const isTypeOnly = decl.isTypeOnly();
    const moduleSpecifier = decl.getModuleSpecifierValue();
    const sourceFileObj = decl.getSourceFile();
    const startLoc = sourceFileObj.getLineAndColumnAtPos(decl.getStart());
    const endLoc = sourceFileObj.getLineAndColumnAtPos(decl.getEnd());
    const column = startLoc.column - 1;
    const endColumn = endLoc.column - 1;

    imports.push({
      moduleSpecifier,
      namedImports,
      defaultImport,
      namespaceImport,
      isTypeOnly,
      line: decl.getStartLineNumber(),
      column,
      endColumn,
    });
  });

  // 2. Process ExportDeclarations that have a module specifier
  sourceFile.getExportDeclarations().forEach((decl) => {
    const moduleSpecifier = decl.getModuleSpecifierValue();
    if (!moduleSpecifier) return;

    const namedImports = decl.getNamedExports().map((n) => n.getName());
    const defaultImport = null;

    let namespaceImport: string | null = null;
    const namespaceExport = decl.getNamespaceExport();
    if (namespaceExport) {
      namespaceImport = namespaceExport.getName();
    } else if (!decl.getNamedExports().length) {
      namespaceImport = "*";
    }

    const isTypeOnly = decl.isTypeOnly();
    const sourceFileObj = decl.getSourceFile();
    const startLoc = sourceFileObj.getLineAndColumnAtPos(decl.getStart());
    const endLoc = sourceFileObj.getLineAndColumnAtPos(decl.getEnd());
    const column = startLoc.column - 1;
    const endColumn = endLoc.column - 1;

    imports.push({
      moduleSpecifier,
      namedImports,
      defaultImport,
      namespaceImport,
      isTypeOnly,
      line: decl.getStartLineNumber(),
      column,
      endColumn,
    });
  });

  return imports;
}
