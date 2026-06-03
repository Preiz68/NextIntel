import { Rule, RuleContext, Diagnostic } from "../types.js";
import fs from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const noLargeDataImportsInClient: Rule = {
  id: "no-large-data-imports-in-client",

  meta: {
    description: "Detect large data imports (.json/.csv > 50KB) directly inside Client Components.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const stripUseEffect = (text: string): string => {
      let result = text;
      const pattern = /\buse(Layout)?Effect\s*\(/g;
      let match;
      while ((match = pattern.exec(result)) !== null) {
        const startIdx = match.index;
        const openParenIdx = result.indexOf("(", startIdx);
        if (openParenIdx === -1) continue;

        let depth = 1;
        let endIdx = -1;
        for (let i = openParenIdx + 1; i < result.length; i++) {
          if (result[i] === "(") {
            depth++;
          } else if (result[i] === ")") {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }

        if (endIdx !== -1) {
          result = result.substring(0, startIdx) + result.substring(endIdx + 1);
          pattern.lastIndex = 0;
        }
      }
      return result;
    };

    const stripJSXEventHandlers = (text: string): string => {
      let result = text;
      const pattern = /\bon[A-Z][a-zA-Z]+\s*=\s*\{/g;
      let match;
      while ((match = pattern.exec(result)) !== null) {
        const startIdx = match.index;
        const openBraceIdx = result.indexOf("{", startIdx);
        if (openBraceIdx === -1) continue;

        let depth = 1;
        let endIdx = -1;
        for (let i = openBraceIdx + 1; i < result.length; i++) {
          if (result[i] === "{") {
            depth++;
          } else if (result[i] === "}") {
            depth--;
            if (depth === 0) {
              endIdx = i;
              break;
            }
          }
        }

        if (endIdx !== -1) {
          result = result.substring(0, startIdx) + result.substring(endIdx + 1);
          pattern.lastIndex = 0;
        }
      }
      return result;
    };

    const isUsedAtRenderTime = (content: string, importSpecifier: string, identifiers: string[]): boolean => {
      // Remove comments
      let cleaned = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

      // Remove the import lines for this specifier to avoid matching import declarations
      const lines = cleaned.split("\n");
      const filteredLines = lines.filter(line => !line.includes(importSpecifier));
      cleaned = filteredLines.join("\n");

      // Remove useEffect / useLayoutEffect blocks using balanced parser
      cleaned = stripUseEffect(cleaned);

      // Remove JSX event handlers using balanced parser
      cleaned = stripJSXEventHandlers(cleaned);

      // Check if any identifier is used in the cleaned code
      for (const id of identifiers) {
        if (!id) continue;
        const regex = new RegExp(`\\b${id}\\b`);
        if (regex.test(cleaned)) {
          return true;
        }
      }

      return false;
    };

    for (const analysis of context.analyses) {
      const isClient = 
        analysis.isClientComponent || 
        analysis.semanticKind === "client-component" ||
        analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      if (!analysis.importDetails || analysis.importDetails.length === 0) continue;

      const currentDir = path.dirname(analysis.filePath);
      let content = "";
      try {
        content = fs.readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      for (const imp of analysis.importDetails) {
        if (!imp.moduleSpecifier.startsWith(".")) continue;

        const resolvedPathNoExt = path.resolve(currentDir, imp.moduleSpecifier);
        let targetFile: string | null = null;
        const extensionsToCheck = ["", ".json", ".csv"];

        for (const ext of extensionsToCheck) {
          const p = resolvedPathNoExt + ext;
          try {
            if (fs.existsSync(p)) {
              const stat = fs.statSync(p);
              if (stat.isFile()) {
                targetFile = p;
                break;
              }
            }
          } catch {
            // ignore FS errors
          }
        }

        if (targetFile && (targetFile.endsWith(".json") || targetFile.endsWith(".csv"))) {
          try {
            const size = fs.statSync(targetFile).size;
            if (size > 51200) { // 50KB
              // Collect identifiers imported
              const identifiers: string[] = [];
              if (imp.defaultImport) identifiers.push(imp.defaultImport);
              if (imp.namespaceImport) identifiers.push(imp.namespaceImport);
              if (imp.namedImports) {
                for (const n of imp.namedImports) {
                  identifiers.push(n);
                }
              }

              // Check if used at render time
              if (isUsedAtRenderTime(content, imp.moduleSpecifier, identifiers)) {
                const line = imp.line || 1;
                diagnostics.push(
                  mapEventToDiagnostic(
                    "CLIENT_GRAPH_LEAK",
                    "CC-HYDRATION-ABUSE-001",
                    this.id,
                    analysis.filePath,
                    line,
                    `Client Component imports large static data file '${path.basename(targetFile)}' (${(size / 1024).toFixed(1)}KB), which exceeds the 50KB recommended limit. This bloats the client bundle and increases hydration time.`
                  )
                );
              }
            }
          } catch {
            // ignore FS errors
          }
        }
      }
    }

    return diagnostics;
  },
};
