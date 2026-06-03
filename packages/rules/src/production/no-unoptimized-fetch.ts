import { Rule, RuleContext, Diagnostic } from "../types.js";
import { Project, SyntaxKind } from "ts-morph";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function resolveImportPath(currentFilePath: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith(".")) return null;
  const currentDir = path.dirname(currentFilePath);
  const absoluteNoExt = path.resolve(currentDir, moduleSpecifier);
  const extensions = [".tsx", ".ts", ".jsx", ".js"];
  for (const ext of extensions) {
    const p = absoluteNoExt + ext;
    if (existsSync(p)) return p;
    const indexP = path.resolve(absoluteNoExt, "index" + ext);
    if (existsSync(indexP)) return indexP;
  }
  return null;
}

function isUtilityFile(analysis: any): boolean {
  const isUtilKind =
    analysis.semanticKind === "util" ||
    analysis.semanticKind === "shared-util" ||
    analysis.semanticKind === "server-util" ||
    analysis.semanticKind === "mixed-runtime-util" ||
    analysis.semanticKind === "unknown";
  
  const hasNoJsx = !analysis.filePath.endsWith(".tsx") && !analysis.filePath.endsWith(".jsx");
  return isUtilKind || hasNoJsx;
}

function getExportedFetchHelpers(analysis: any): string[] {
  const helpers: string[] = [];
  let content = "";
  try {
    content = readFileSync(analysis.filePath, "utf-8");
  } catch {
    return [];
  }

  const project = new Project();
  const sourceFile = project.createSourceFile("_temp_df001.ts", content);
  
  const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
    .filter(f => f.isExported());
  const variables = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
    .filter(v => {
      const varStatement = v.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      return varStatement ? varStatement.isExported() : false;
    });

  const checkBodyForUnoptimizedFetch = (bodyText: string): boolean => {
    if (!bodyText.includes("fetch(")) return false;
    return /fetch\(\s*[^,)]+\s*\)/.test(bodyText) ||
           (/fetch\(\s*[^,)]+,\s*\{/.test(bodyText) && !bodyText.includes("cache:") && !bodyText.includes("revalidate:"));
  };

  for (const func of functions) {
    const name = func.getName();
    if (!name) continue;
    
    const bodyText = func.getBody()?.getText() ?? "";
    if (checkBodyForUnoptimizedFetch(bodyText)) {
      helpers.push(name);
    }
  }

  for (const v of variables) {
    const name = v.getName();
    const initializer = v.getInitializer();
    if (!initializer) continue;
    
    if (initializer.getKind() === SyntaxKind.ArrowFunction || initializer.getKind() === SyntaxKind.FunctionExpression) {
      const bodyText = initializer.getText();
      if (checkBodyForUnoptimizedFetch(bodyText)) {
        helpers.push(name);
      }
    }
  }

  return helpers;
}

export const noUnoptimizedFetch: Rule = {
  id: "perf-no-unoptimized-fetch",

  meta: {
    description:
      "Detects fetch() calls in Server Components that are missing explicit cache or revalidate options.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const perfConstraint = context.knowledgeRegistry.getConstraint("performance", "PF-001");
    const dataConstraint = context.knowledgeRegistry.getConstraint("data-fetching", "DF-001");

    const mergeUnique = (...arrays: (string[] | undefined)[]): string[] => {
      const seen = new Set<string>();
      const result: string[] = [];
      for (const arr of arrays) {
        for (const item of arr ?? []) {
          if (!seen.has(item)) {
            seen.add(item);
            result.push(item);
          }
        }
      }
      return result;
    };

    const quickFixes = mergeUnique(
      dataConstraint?.quickFixes,
      perfConstraint?.quickFixes
    );
    const architectureSuggestions = mergeUnique(
      dataConstraint?.architectureSuggestions,
      perfConstraint?.architectureSuggestions
    );
    const optimizationGuidance = mergeUnique(
      dataConstraint?.optimizationGuidance,
      perfConstraint?.optimizationGuidance
    );
    const productionRisks = mergeUnique(
      dataConstraint?.productionRisks,
      perfConstraint?.productionRisks
    );

    const whyItMatters = dataConstraint?.whyItMatters ?? perfConstraint?.whyItMatters ?? "Data fetching in Server Components is critical for performance.";

    // 1. Build map of exported fetch helpers in utility files
    const helperMap = new Map<string, string[]>();
    for (const analysis of context.analyses) {
      if (analysis.isClientComponent) continue;
      if (isUtilityFile(analysis)) {
        const helpers = getExportedFetchHelpers(analysis);
        if (helpers.length > 0) {
          helperMap.set(analysis.filePath, helpers);
        }
      }
    }

    // 2. Scan each Server Component for direct fetch calls or calls to imported helpers
    for (const analysis of context.analyses) {
      if (analysis.isClientComponent) continue;

      // Skip utility files themselves from direct warnings to prevent duplicate flags
      if (isUtilityFile(analysis)) continue;

      let fileContent = "";
      try {
        fileContent = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      // Skip if the component file has dynamic rendering configuration
      const hasDynamicConfig =
        analysis.executionModel.architectureFlags.includes("dynamic-force-dynamic") ||
        analysis.executionModel.architectureFlags.includes("revalidate-0") ||
        /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(fileContent) ||
        /export\s+const\s+revalidate\s*=\s*0/.test(fileContent);

      if (hasDynamicConfig) continue;

      const project = new Project();
      const sourceFile = project.createSourceFile("_temp_comp_df001.tsx", fileContent);

      // A. Check for direct unoptimized fetch calls
      const directFetchCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
        .filter(call => call.getExpression().getText() === "fetch");

      for (const call of directFetchCalls) {
        const args = call.getArguments();
        let isUnoptimized = false;
        if (args.length === 1) {
          isUnoptimized = true;
        } else if (args.length >= 2) {
          const optionsObj = args[1];
          if (optionsObj.getKind() === SyntaxKind.ObjectLiteralExpression) {
            const obj = optionsObj.asKind(SyntaxKind.ObjectLiteralExpression)!;
            const hasCache = obj.getProperty("cache") !== undefined;
            const hasNext = obj.getProperty("next") !== undefined;
            let hasRevalidate = false;
            if (hasNext) {
              const nextProp = obj.getProperty("next");
              if (nextProp?.getKind() === SyntaxKind.PropertyAssignment) {
                const init = nextProp.asKind(SyntaxKind.PropertyAssignment)?.getInitializer();
                if (init?.getKind() === SyntaxKind.ObjectLiteralExpression) {
                  hasRevalidate = init.asKind(SyntaxKind.ObjectLiteralExpression)?.getProperty("revalidate") !== undefined;
                }
              }
            }
            if (!hasCache && !hasRevalidate) {
              isUnoptimized = true;
            }
          } else {
            isUnoptimized = true;
          }
        }

        if (isUnoptimized) {
          const line = call.getStartLineNumber();
          diagnostics.push({
            file: analysis.filePath,
            line,
            severity: "warning",
            ruleId: this.id,
            id: dataConstraint?.id ?? "DF-001",
            message: `Unoptimized fetch() detected in a Server Component. ${dataConstraint?.problem ?? ""}`,
            fix: quickFixes[0],
            whyItMatters,
            quickFixes,
            architectureSuggestions,
            optimizationGuidance,
            productionRisks,
            examples: dataConstraint?.examples,
          });
        }
      }

      // B. Check for calls to imported fetch helpers
      if (!analysis.importDetails) continue;

      const importedHelpers = new Map<string, { helperName: string; sourceFile: string }>();
      for (const imp of analysis.importDetails) {
        const targetPath = resolveImportPath(analysis.filePath, imp.moduleSpecifier);
        if (!targetPath) continue;

        let matchedPath = "";
        for (const key of helperMap.keys()) {
          if (path.normalize(key).replace(/\\/g, "/") === path.normalize(targetPath).replace(/\\/g, "/")) {
            matchedPath = key;
            break;
          }
        }

        if (matchedPath) {
          const helpers = helperMap.get(matchedPath)!;
          if (imp.defaultImport && helpers.includes("default")) {
            importedHelpers.set(imp.defaultImport, { helperName: "default", sourceFile: matchedPath });
          }
          for (const named of imp.namedImports || []) {
            if (helpers.includes(named)) {
              importedHelpers.set(named, { helperName: named, sourceFile: matchedPath });
            }
          }
        }
      }

      if (importedHelpers.size > 0) {
        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const call of callExpressions) {
          const exprText = call.getExpression().getText();
          if (importedHelpers.has(exprText)) {
            const helperInfo = importedHelpers.get(exprText)!;
            const line = call.getStartLineNumber();
            diagnostics.push({
              file: analysis.filePath,
              line,
              severity: "warning",
              ruleId: this.id,
              id: dataConstraint?.id ?? "DF-001",
              message: `Call to unoptimized fetch helper '${exprText}' (from '${path.basename(helperInfo.sourceFile)}') detected in a Server Component. ${dataConstraint?.problem ?? ""}`,
              fix: quickFixes[0],
              whyItMatters,
              quickFixes,
              architectureSuggestions,
              optimizationGuidance,
              productionRisks,
              examples: dataConstraint?.examples,
            });
          }
        }
      }
    }

    return diagnostics;
  },
};
