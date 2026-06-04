import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Project, SyntaxKind } from "ts-morph";

const UTIL_FOLDERS = new Set(["server", "shared", "lib", "utils", "helpers", "data", "dal", "services"]);
const ROUTING_BASENAMES = new Set(["page", "layout", "route", "template"]);

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

function fileContext(filePath: string): "server-action" | "routing-boundary" | "utility" | "other" {
  const fp = filePath.replace(/\\/g, "/");
  const basename = path.basename(fp, path.extname(fp));
  const segments = fp.split("/");

  if (ROUTING_BASENAMES.has(basename)) return "routing-boundary";
  if (UTIL_FOLDERS.some((f) => segments.includes(f))) return "utility";
  return "other";
}

function hasDynamicTrigger(content: string): boolean {
  return /cookies\s*\(\s*\)|headers\s*\(\s*\)|draftMode\s*\(\s*\)|connection\s*\(\s*\)|unstable_noStore\s*\(\s*\)/.test(content);
}

function isMutationFetch(content: string, fetchLine: number): boolean {
  const lines = content.split("\n");
  const windowStart = Math.max(0, fetchLine - 3);
  const windowEnd = Math.min(lines.length, fetchLine + 5);
  const window = lines.slice(windowStart, windowEnd).join("\n");
  return /\b(POST|PUT|DELETE|PATCH)\b/.test(window);
}

function isServerAction(content: string): boolean {
  return /"use server"/.test(content) || /'use server'/.test(content);
}

function buildMessage(
  mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE",
  ctx: ReturnType<typeof fileContext>,
  fetchCount: number
): string {
  const countLabel = fetchCount > 1 ? ` (${fetchCount} uncached fetch calls in this file)` : "";
  const base = `fetch()${countLabel} called without an explicit cache strategy`;

  if (ctx === "utility") {
    return (
      `${base}. Utility/DAL files that fetch data should declare an explicit cache strategy. ` +
      `Use { cache: 'force-cache' } for data that changes infrequently, ` +
      `or wrap the function with React.cache() for request-level deduplication. ` +
      `This makes the caching contract explicit and avoids implicit Next.js default behavior.`
    );
  }

  if (mode === "DYNAMIC_ROUTE") {
    return (
      `${base}. Since this route is classified as a DYNAMIC_ROUTE (uses dynamic APIs like cookies/headers), ` +
      `per-request rendering is expected. You should add { cache: 'no-store' } explicitly to make the ` +
      `dynamic intent clear and avoid relying on Next.js default behaviors.`
    );
  }

  if (mode === "STATIC_ROUTE") {
    return (
      `${base}. Since this route has no dynamic triggers, it is classified as a STATIC_ROUTE. ` +
      `In Next.js 15+, fetch() defaults to no-store (uncached). Use { cache: 'force-cache' } for static data ` +
      `that can be pre-rendered, or { next: { revalidate: N } } for ISR (time-based refresh) to enable caching.`
    );
  }

  return (
    `${base}. Classified as a HYBRID_ROUTE due to mixed static and dynamic requirements. ` +
    `Consider splitting your data fetching layers (RSC vs. Client Components) or using React.cache() ` +
    `to safely share query boundaries without breaking static pre-rendering.`
  );
}

function buildQuickFixes(
  mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE",
  ctx: ReturnType<typeof fileContext>
): string[] {
  if (ctx === "utility") {
    return [
      "Add { cache: 'force-cache' } for stable reference data: fetch(url, { cache: 'force-cache' })",
      "Or wrap the utility function with React.cache() for request-level deduplication.",
      "For time-based refresh: fetch(url, { next: { revalidate: 60 } })",
    ];
  }
  if (mode === "DYNAMIC_ROUTE") {
    return [
      "Add { cache: 'no-store' } to make dynamic intent explicit: fetch(url, { cache: 'no-store' })",
      "Or add { next: { tags: ['my-tag'] } } for on-demand revalidation support.",
    ];
  }
  if (mode === "HYBRID_ROUTE") {
    return [
      "Wrap the fetch or data acquisition logic in React.cache() to deduplicate requests.",
      "Add { cache: 'no-store' } if the fetch should always hit the server.",
      "Or use fetch(url, { next: { revalidate: 60 } }) to allow caching on a hybrid route.",
    ];
  }
  return [
    "Static data: fetch(url, { cache: 'force-cache' })",
    "ISR / time-based: fetch(url, { next: { revalidate: 60 } })",
    "Truly dynamic: fetch(url, { cache: 'no-store' })",
  ];
}

export const fetchCacheConfig: Rule = {
  id: "fetch-cache-config",

  meta: {
    description:
      "Fetch calls in Next.js Server Components should have explicit cache or revalidate configuration.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraintById("DF-001");

    const whyItMatters =
      constraint?.whyItMatters ??
      "In Next.js 15+, fetch() calls are no-store by default. Without explicit cache settings, every render hits the network, eliminating the Data Cache and increasing TTFB.";
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    const helperMap = new Map<string, string[]>();
    for (const analysis of context.analyses) {
      if (analysis.executionModel.componentType === "client") continue;
      if (isUtilityFile(analysis)) {
        const helpers = getExportedFetchHelpers(analysis);
        if (helpers.length > 0) {
          helperMap.set(analysis.filePath, helpers);
        }
      }
    }

    for (const analysis of context.analyses) {
      if (analysis.executionModel.componentType === "client") continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        // ignore
      }

      const { fetchStrategy } = analysis.executionModel;
      const hasUncached = fetchStrategy.hasFetch && fetchStrategy.hasUncachedFetch;

      if (hasUncached) {
        let skipDirect = false;
        if (isServerAction(content)) {
          const fetchLine = analysis.fetchCalls[0]?.line ?? 1;
          if (isMutationFetch(content, fetchLine)) {
            skipDirect = true;
          }
        }

        if (!skipDirect) {
          const ctx = fileContext(analysis.filePath);
          const fetchCount = analysis.fetchCalls.length || 1;

          const isDynamic = hasDynamicTrigger(content) || 
                            analysis.rendering.mode === "dynamic" ||
                            analysis.executionModel.architectureFlags.includes("dynamic-force-dynamic");
                            
          const hasStaticIntent = /export\s+const\s+revalidate\s*=\s*[1-9]\d*/.test(content) || 
                                  analysis.rendering.mode === "isr" ||
                                  analysis.rendering.mode === "ppr" ||
                                  analysis.executionModel.architectureFlags.includes("has-static-params") ||
                                  analysis.filePath.includes("[");

          let mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE" = "STATIC_ROUTE";
          if (isDynamic && hasStaticIntent) {
            mode = "HYBRID_ROUTE";
          } else if (isDynamic) {
            mode = "DYNAMIC_ROUTE";
          } else {
            mode = "STATIC_ROUTE";
          }

          const message = buildMessage(mode, ctx, fetchCount);
          const quickFixes = buildQuickFixes(mode, ctx);

          diagnostics.push({
            file: analysis.filePath,
            line: analysis.fetchCalls[0]?.line,
            column: analysis.fetchCalls[0]?.column,
            endColumn: analysis.fetchCalls[0]?.endColumn,
            severity: constraint?.severity ?? "warning",
            ruleId: this.id,
            id: constraint?.id ?? "DF-001",
            message,
            fix: quickFixes[0],
            whyItMatters,
            quickFixes,
            architectureSuggestions,
            optimizationGuidance,
            productionRisks,
            examples: constraint?.examples,
          });
        }
      }

      if (!isUtilityFile(analysis) && analysis.importDetails && analysis.importDetails.length > 0) {
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

        if (importedHelpers.size > 0 && content) {
          try {
            const project = new Project();
            const sourceFile = project.createSourceFile("_temp_comp_helper_df001.tsx", content);
            const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
            for (const call of callExpressions) {
              const exprText = call.getExpression().getText();
              if (importedHelpers.has(exprText)) {
                const helperInfo = importedHelpers.get(exprText)!;
                const line = call.getStartLineNumber();
                const startLoc = sourceFile.getLineAndColumnAtPos(call.getStart());
                const endLoc = sourceFile.getLineAndColumnAtPos(call.getEnd());
                const column = startLoc.column - 1;
                const endColumn = endLoc.column - 1;

                const mode = "STATIC_ROUTE";
                const quickFixes = buildQuickFixes(mode, "utility");

                diagnostics.push({
                  file: analysis.filePath,
                  line,
                  column,
                  endColumn,
                  severity: constraint?.severity ?? "warning",
                  ruleId: this.id,
                  id: constraint?.id ?? "DF-001",
                  message: `Call to unoptimized fetch helper '${exprText}' (from '${path.basename(helperInfo.sourceFile)}') detected in a Server Component. ${constraint?.problem ?? ""}`,
                  fix: quickFixes[0],
                  whyItMatters,
                  quickFixes,
                  architectureSuggestions,
                  optimizationGuidance,
                  productionRisks,
                  examples: constraint?.examples,
                });
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    return diagnostics;
  },
};
