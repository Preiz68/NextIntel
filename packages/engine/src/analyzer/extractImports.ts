import { SourceFile } from "ts-morph";
import type { ImportInfo } from "./types.js";

export function extractImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map((decl) => {
    const namedImports = decl.getNamedImports().map((n) => n.getName());

    const defaultImport = decl.getDefaultImport()?.getText() ?? null;
    const namespaceImport = decl.getNamespaceImport()?.getText() ?? null;
    const isTypeOnly = decl.isTypeOnly();
    const moduleSpecifier = decl.getModuleSpecifierValue();

    return {
      moduleSpecifier,
      namedImports,
      defaultImport,
      namespaceImport,
      isTypeOnly,
    };
  });
}
