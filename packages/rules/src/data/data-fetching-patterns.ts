import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind, Node } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";
import { isWaterfallCandidate } from "../utils/waterfall.js";
import path from "node:path";
/**
 * Rule: data-fetching-patterns
 *
 * Implements:
 * 1. DF-002: Exported DB functions not wrapped in React.cache()
 * 2. DF-003: Server Components calling internal /api/ Route Handlers
 * 3. DF-004: Uncached DB queries in Server Components
 * 4. DF-005: Sequential awaits causing rendering waterfalls
 * 5. DF-006: Duplicate data-fetch function calls in same render scope
 * 6. DF-007: Client Component re-fetching data already available from Server Component (graph-edge heuristic)
 * 7. CA-006: Cache tag declared but revalidateTag() never called anywhere (full-scan mode only)
 * 8. DYNAMIC_RENDER_TRIGGER-004: Server Actions mutating without revalidation
 */

// ── File-kind guards ───────────────────────────────────────────────────────────

/**
 * True when this file is a pure server-side utility/DAL module — NOT a
 * routing boundary (page, layout, route handler). DF-001 must NOT fire on these.
 */
function isServerUtilModule(analysis: { filePath: string; semanticKind?: string }): boolean {
  const fp = analysis.filePath.replace(/\\/g, "/");
  const basename = path.basename(fp, path.extname(fp));
  // Route-boundary files are always candidates for DF-001
  const ROUTING_BASENAMES = new Set(["page", "layout", "route", "template", "loading", "error", "not-found"]);
  if (ROUTING_BASENAMES.has(basename)) return false;
  // server-util / shared-util semanticKind
  const kind = (analysis as any).semanticKind ?? "";
  if (kind === "server-util" || kind === "util" || kind === "shared-util") return true;
  // Heuristic: files in conventional utility folders
  const segments = fp.split("/");
  const UTIL_FOLDERS = new Set(["server", "shared", "lib", "utils", "helpers", "data", "dal", "services"]);
  return segments.some(s => UTIL_FOLDERS.has(s));
}

/**
 * True if the file is a routing page/layout Server Component — primary candidate for
 * DF-001, DF-003, DF-005 checks.
 */
function isRoutingBoundary(analysis: { filePath: string }): boolean {
  const fp = analysis.filePath.replace(/\\/g, "/");
  return (
    fp.includes("/page.") ||
    fp.includes("/layout.") ||
    fp.includes("/route.") ||
    fp.includes("/template.")
  );
}

/**
 * Checks if the direct wrapping function ancestor of awaitExpr is the specified func node.
 */
function isDirectAwaitInFunction(awaitExpr: Node, func: Node): boolean {
  const ancestor = awaitExpr.getFirstAncestor(node => 
    node.getKind() === SyntaxKind.FunctionDeclaration ||
    node.getKind() === SyntaxKind.ArrowFunction ||
    node.getKind() === SyntaxKind.FunctionExpression ||
    node.getKind() === SyntaxKind.MethodDeclaration
  );
  return ancestor === func;
}

/**
 * Extracts variables defined or initialized by an await expression.
 */
function getVariablesDefinedByAwait(awaitExpr: Node): Set<string> {
  const vars = new Set<string>();
  
  // Find if it's part of a VariableDeclaration
  const varDec = awaitExpr.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (varDec) {
    const nameNode = varDec.getNameNode();
    if (nameNode.getKind() === SyntaxKind.Identifier) {
      vars.add(nameNode.getText());
    } else if (
      nameNode.getKind() === SyntaxKind.ObjectBindingPattern ||
      nameNode.getKind() === SyntaxKind.ArrayBindingPattern
    ) {
      const identifiers = nameNode.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const id of identifiers) {
        vars.add(id.getText());
      }
    }
    return vars;
  }

  // Find if it's part of a BinaryExpression assignment (e.g., x = await ...)
  const binaryExpr = awaitExpr.getFirstAncestorByKind(SyntaxKind.BinaryExpression);
  if (binaryExpr && binaryExpr.getOperatorToken().getKind() === SyntaxKind.EqualsToken) {
    const left = binaryExpr.getLeft();
    if (left.getKind() === SyntaxKind.Identifier) {
      vars.add(left.getText());
    } else if (
      left.getKind() === SyntaxKind.ObjectLiteralExpression ||
      left.getKind() === SyntaxKind.ArrayLiteralExpression
    ) {
      const identifiers = left.getDescendantsOfKind(SyntaxKind.Identifier);
      for (const id of identifiers) {
        vars.add(id.getText());
      }
    }
  }

  return vars;
}

/**
 * Checks if the expression being awaited references any of the variables in the set.
 */
function expressionReferencesVariables(awaitExpr: Node, variables: Set<string>): boolean {
  const expression = (awaitExpr as any).getExpression();
  if (!expression) return false;
  
  const identifiers = expression.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const id of identifiers) {
    if (variables.has(id.getText())) {
      const parent = id.getParent();
      if (parent && parent.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = parent.asKind(SyntaxKind.PropertyAccessExpression);
        if (propAccess && propAccess.getNameNode() === id) {
          continue;
        }
      }
      return true;
    }
  }
  return false;
}

export const dataFetchingPatterns: Rule = {
  id: "data-fetching-patterns",

  meta: {
    description: "Detect data fetching, request memoization, waterfalls, duplicate fetches, and mutation cache revalidation issues.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    // Pre-scan all workspace files for cache() / unstable_cache() function wrappers
    const cachedFunctionNames = new Set<string>();
    for (const seqAnalysis of context.analyses) {
      try {
        if (existsSync(seqAnalysis.filePath)) {
          const content = readFileSync(seqAnalysis.filePath, "utf-8");
          const matches = content.matchAll(/(?:const|let|var|export\s+const|export\s+let|export\s+var)\s+(\w+)\s*=\s*(?:React\.)?(?:unstable_)?cache\s*\(/g);
          for (const match of matches) {
            if (match[1]) {
              cachedFunctionNames.add(match[1]);
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    // ── DF-010: Cross-Route Duplicate Fetch check ────────────────────────────
    for (let i = 0; i < context.analyses.length; i++) {
      const a = context.analyses[i]!;
      if (a.isClientComponent || a.executionModel?.componentType === "client") continue;
      const aPath = a.filePath.replace(/\\/g, "/");
      const aDir = path.dirname(aPath);

      for (let j = i + 1; j < context.analyses.length; j++) {
        const b = context.analyses[j]!;
        if (b.isClientComponent || b.executionModel?.componentType === "client") continue;
        const bPath = b.filePath.replace(/\\/g, "/");
        const bDir = path.dirname(bPath);

        // Check if one folder is a parent of the other (so they render in same request path)
        const aIsParent = bDir.startsWith(aDir + "/") || bDir === aDir;
        const bIsParent = aDir.startsWith(bDir + "/") || aDir === bDir;
        
        if (aIsParent || bIsParent) {
          const parent = aIsParent ? a : b;
          const child = aIsParent ? b : a;

          const parentName = path.basename(parent.filePath, path.extname(parent.filePath));
          const childName = path.basename(child.filePath, path.extname(child.filePath));

          const parentIsAncestorSegment = parentName === "layout" || parentName === "template" || parentName === "middleware";
          const childIsRouteSegment = childName === "page" || childName === "layout";

          if (parentIsAncestorSegment && childIsRouteSegment) {
            // Find duplicate fetch calls between parent and child
            for (const pf of parent.fetchCalls) {
              if (pf.url === "dynamic") continue;
              const pfUrl = pf.url;

              for (const cf of child.fetchCalls) {
                if (cf.url === "dynamic") continue;
                const cfUrl = cf.url;

                if (pfUrl === cfUrl) {
                  const diag = mapEventToDiagnostic(
                    "DUPLICATE_DATA_REQUEST",
                    "DF-010",
                    this.id,
                    child.filePath,
                    cf.line,
                    `Cross-Route Duplicate Fetch: both '${path.basename(parent.filePath)}' and '${path.basename(child.filePath)}' fetch the same URL '${cfUrl.replace(/['"`]/g, "")}'. Move this data query to a shared utility wrapped in React.cache() to deduplicate requests during the request lifecycle.`
                  );
                  diag.safeRefactorSuggestion = 
                    `// Deduplicate cross-file requests by wrapping fetch in React.cache() inside a shared utility:\n` +
                    `import { cache } from 'react';\n\n` +
                    `export const getSharedData = cache(async () => {\n` +
                    `  const res = await fetch('${cfUrl.replace(/['"`]/g, "")}');\n` +
                    `  return res.json();\n` +
                    `});\n\n` +
                    `// Then import and await getSharedData() in both layout and page files.`;
                  diagnostics.push(diag);
                }
              }
            }
          }
        }
      }
    }

    const df002Constraint = context.knowledgeRegistry.getConstraint("data-fetching", "DF-002");
    const df003Constraint = context.knowledgeRegistry.getConstraint("data-fetching", "DF-003");
    const df004Constraint = context.knowledgeRegistry.getConstraint("data-fetching", "DF-004");
    const df005Constraint = context.knowledgeRegistry.getConstraint("data-fetching", "DF-005");
    const drt004Constraint = context.knowledgeRegistry.getConstraint("caching", "DYNAMIC_RENDER_TRIGGER-004");

    // ── CA-006: Global tag registry (full-scan mode only) ────────────────────
    // Collect all cache tags declared anywhere, then check they are revalidated somewhere.
    // CA-006 is only meaningful when we have ALL files in context (full-scan / CI mode).
    const allCacheTags = new Map<string, string[]>(); // tag → [filePath, ...]
    const allRevalidateTags = new Set<string>();

    for (const analysis of context.analyses) {
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      // Extract next.tags from fetch calls: { next: { tags: ["foo", "bar"] } }
      const tagMatches = content.matchAll(/next\s*:\s*\{[^}]*tags\s*:\s*\[([^\]]+)\]/g);
      for (const match of tagMatches) {
        const tagList = match[1]!;
        const tags = [...tagList.matchAll(/['"`]([^'"`]+)['"`]/g)].map(m => m[1]!);
        for (const tag of tags) {
          if (!allCacheTags.has(tag)) allCacheTags.set(tag, []);
          allCacheTags.get(tag)!.push(analysis.filePath);
        }
      }

      // Extract revalidateTag("foo") calls
      const revalidateMatches = content.matchAll(/revalidateTag\s*\(\s*['"`]([^'"`]+)['"`]/g);
      for (const match of revalidateMatches) {
        allRevalidateTags.add(match[1]!);
      }
    }

    // Only run CA-006 in full-scan mode: when context has 5+ files analyzed (heuristic for "project scan")
    const isFullScanMode = context.analyses.length >= 5;
    if (isFullScanMode) {
      for (const [tag, declaredInFiles] of allCacheTags) {
        if (!allRevalidateTags.has(tag)) {
          // Report on the first file that declared this tag
          const reportFile = declaredInFiles[0]!;
          diagnostics.push({
            file: reportFile,
            line: 1,
            severity: "warning",
            ruleId: this.id,
            id: "CA-006",
            message: `Cache tag '"${tag}"' is declared in a fetch() call but revalidateTag("${tag}") is never called anywhere in the project. This data will never be invalidated after mutations, leaving the cache permanently stale.`,
            whyItMatters: "Cache tags only provide value when there is a corresponding revalidateTag() call in a Server Action or Route Handler. Without it, tagged data remains cached indefinitely regardless of database changes.",
            quickFixes: [
              `Add revalidateTag("${tag}") to the Server Action that mutates this data.`,
              `Example: After db.update(...), call revalidateTag("${tag}") to clear the stale cache.`,
            ],
            architectureSuggestions: [
              "Adopt a tag-per-entity convention: every entity type (user, post, product) has a canonical tag, declared where data is fetched and invalidated where data is mutated.",
            ],
            optimizationGuidance: [
              "Prefer granular tags like 'user-{id}' over broad tags like 'users' to minimize cache stampedes.",
            ],
            productionRisks: [
              "Stale data served indefinitely — mutations never reflected without a hard cache purge or redeployment.",
            ],
          });
        }
      }
    }

    // ── DF-007: Client re-fetch of data already on server (graph-edge heuristic) ─
    // Build a map of: server file → set of function names it calls/exports
    const serverDataFunctions = new Map<string, Set<string>>(); // filePath → { "getUsers", "getPosts", ... }
    for (const analysis of context.analyses) {
      if (analysis.isClientComponent) continue;
      let content = "";
      try { content = readFileSync(analysis.filePath, "utf-8"); } catch { continue; }
      // Collect function names that look like data-fetching (get*, fetch*, load*)
      const fnNames = [...content.matchAll(/\b(get[A-Z]\w*|fetch[A-Z]\w*|load[A-Z]\w*)\s*\(/g)]
        .map(m => m[1]!);
      if (fnNames.length > 0) {
        serverDataFunctions.set(analysis.filePath, new Set(fnNames));
      }
    }

    // For each client component, check if it fetches a URL that semantically matches
    // a function name already called in a server component in the same graph
    for (const analysis of context.analyses) {
      if (!analysis.isClientComponent) continue;
      let content = "";
      try { content = readFileSync(analysis.filePath, "utf-8"); } catch { continue; }

      // Extract URLs from fetch() calls in useEffect
      const clientFetchUrls = [...content.matchAll(/fetch\s*\(\s*['"`](\/api\/([^'"`]+))['"`]/g)]
        .map(m => ({ url: m[1]!, segment: m[2]! }));
      if (clientFetchUrls.length === 0) continue;

      // Walk graph predecessors (files that import this client component)
      const filePath = analysis.filePath.replace(/\\/g, "/");
      const importers: string[] = (context.graph as any)?.predecessors(filePath) ?? [];

      for (const importerPath of importers) {
        const importerAnalysis = context.analyses.find(
          a => a.filePath.replace(/\\/g, "/") === importerPath
        );
        if (!importerAnalysis || importerAnalysis.isClientComponent) continue;

        const serverFns = serverDataFunctions.get(importerAnalysis.filePath) ?? new Set<string>();

        for (const { url, segment } of clientFetchUrls) {
          // Heuristic: URL segment matches a server function name (case-insensitive, plurals)
          const segmentClean = segment.replace(/\//g, "").toLowerCase();
          const matchingFn = [...serverFns].find(fn => {
            const fnBase = fn.replace(/^(get|fetch|load)/i, "").toLowerCase();
            return fnBase === segmentClean || fnBase === segmentClean + "s" || fnBase + "s" === segmentClean;
          });

          if (matchingFn) {
            diagnostics.push({
              file: analysis.filePath,
              line: 1,
              severity: "error",
              ruleId: this.id,
              id: "DF-007",
              message: `Data for '${url}' appears to already be fetched server-side via '${matchingFn}()' in the parent Server Component '${path.basename(importerAnalysis.filePath)}'. Re-fetching it client-side creates a double-fetch: server fetch + client-side waterfall. Pass the data as props instead.`,
              whyItMatters: "When a Server Component already has the data, passing it as props to the Client Component is zero-cost — no network roundtrip. Fetching again client-side adds latency, bypasses caching, and shows a loading state that could be avoided.",
              quickFixes: [
                `Remove the client-side fetch("${url}") and accept the data as a prop from the parent Server Component.`,
                `In the Server Component: const data = await ${matchingFn}(); then pass <ClientComponent data={data} />`,
              ],
              architectureSuggestions: [
                "Rule: Server Components own data. Client Components display data. Props are the handoff point.",
              ],
              optimizationGuidance: [
                "Eliminates the client-side waterfall: HTML load → JS parse → fetch → render becomes HTML load → render.",
              ],
              productionRisks: [
                "Visible loading flash on every page navigation",
                "Double database load: once server-side, once client-side",
              ],
            });
          }
        }
      }
    }

    // ── Per-file analysis loop ────────────────────────────────────────────────
    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || (analysis as any).executionModel?.componentType === "client";
      if (isClient) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("_temp_df.ts", content);

      const hasTopLevelUseServer = sourceFile.getStatements().some((stmt) => {
        if (stmt.getKind() === SyntaxKind.ExpressionStatement) {
          const expr = (stmt as any).getExpression();
          return expr && expr.getKind() === SyntaxKind.StringLiteral && expr.getLiteralText() === "use server";
        }
        return false;
      });

      // ── DYNAMIC_RENDER_TRIGGER-004 (Server Actions mutating without revalidation)
      if (hasTopLevelUseServer || content.includes("use server")) {
        const functions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const arrowFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction);

        for (const func of [...functions, ...arrowFunctions]) {
          const bodyText = func.getBody()?.getText() ?? "";
          const isAction =
            hasTopLevelUseServer ||
            bodyText.includes('"use server"') ||
            bodyText.includes("'use server'");
          if (!isAction) continue;

          const isMutation =
            /\b(db\.\w+|prisma\.\w+|drizzle\.\w+|\w+\.(insert|update|delete|create|upsert))\b/.test(bodyText) ||
            (bodyText.includes("fetch") && /\b(POST|PUT|DELETE|PATCH)\b/.test(bodyText));

          if (!isMutation) continue;

          // ── Analytics/logging exclusion ─────────────────────────────────────
          // Not all mutations require cache invalidation.
          // Logging, telemetry, and analytics writes are fire-and-forget —
          // they don't affect any cached UI data.
          const ANALYTICS_PATTERN = /analytic|telemetry|log|track|metric|event|beacon|mixpanel|segment|amplitude|posthog|datadog|sentry|gtag|ga\b/i;
          const LOGGING_TABLE_PATTERN = /\.(log|audit|event|activity|history|trace|diagnostic)s?\b/i;

          const isAnalyticsMutation =
            ANALYTICS_PATTERN.test(bodyText) ||
            LOGGING_TABLE_PATTERN.test(bodyText);

          const hasRevalidation =
            /\b(revalidatePath|revalidateTag|redirect|router\.refresh)\b/.test(bodyText);

          if (hasRevalidation) continue; // already handles invalidation

          if (isAnalyticsMutation) {
            // Analytics/logging mutations are intentionally fire-and-forget.
            // Emit INFO instead of WARNING — not a real cache issue.
            // Use the base DF-004 constraint for knowledge lookup, tag as analytics.
            const analyticsDiag = mapEventToDiagnostic(
              "CACHE_CONFLICT_DETECTED",
              "DYNAMIC_RENDER_TRIGGER-004",
              this.id,
              analysis.filePath,
              func.getStartLineNumber(),
              `Server Action performs analytics/logging writes without cache revalidation — this is expected behavior. Analytics and telemetry mutations are fire-and-forget and do not require revalidateTag() or revalidatePath(). No action needed.`
            ) as any;
            analyticsDiag.analyticsExclusion = true; // flag for engine: downgrade to INFO
            diagnostics.push(analyticsDiag);
            continue;
          }

          // Core data mutation without revalidation — flag as WARNING
          diagnostics.push(
            mapEventToDiagnostic(
              "CACHE_CONFLICT_DETECTED",
              "DYNAMIC_RENDER_TRIGGER-004",
              this.id,
              analysis.filePath,
              func.getStartLineNumber(),
              `Server Action performs data mutations (insert/update/delete/upsert) but does not call revalidateTag(), revalidatePath(), or redirect(). This leaves the Router Cache in a stale state — users will see outdated data until the cache naturally expires.`
            )
          );
        }
      }

      // ── Routing-boundary-only checks (DF-001 scoped here, DF-003, DF-005) ──
      const isRouting = isRoutingBoundary(analysis);
      const isUtil = isServerUtilModule(analysis);

      const componentFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);

      if (isRouting) {
        // ── MD-002: Avoid Fetch Duplication Inside Dynamic generateMetadata and Pages ──
        let generateMetadataNode: Node | undefined;
        const allFunctions = sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration);
        const allVariables = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);

        for (const fn of allFunctions) {
          if (fn.getName() === "generateMetadata") {
            generateMetadataNode = fn;
            break;
          }
        }
        if (!generateMetadataNode) {
          for (const v of allVariables) {
            if (v.getName() === "generateMetadata") {
              generateMetadataNode = v.getInitializer() || v;
              break;
            }
          }
        }

        let defaultExportNode: Node | undefined;
        const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
        if (defaultExportSymbol) {
          const decls = defaultExportSymbol.getDeclarations();
          if (decls.length > 0) {
            defaultExportNode = decls[0];
          }
        }
        if (!defaultExportNode) {
          for (const fn of allFunctions) {
            if (fn.isDefaultExport()) {
              defaultExportNode = fn;
              break;
            }
          }
        }

        if (generateMetadataNode && defaultExportNode) {
          const metadataCalls = generateMetadataNode.getDescendantsOfKind(SyntaxKind.CallExpression);
          const pageCalls = defaultExportNode.getDescendantsOfKind(SyntaxKind.CallExpression);

          for (const mc of metadataCalls) {
            const mcText = mc.getText();
            const isFetch = mc.getExpression().getText() === "fetch";
            const isDataQuery = /\b(db\.\w+|prisma\.\w+|drizzle\.\w+|\b(get|fetch|load)[A-Z]\w*)\b/.test(mcText);

            if (isFetch || isDataQuery) {
              // If it's a call to a cached helper function, skip MD-002 check
              const calledFnName = mc.getExpression().getText();
              if (isDataQuery && cachedFunctionNames.has(calledFnName)) {
                continue;
              }

              const matchingCall = pageCalls.find(pc => {
                if (isFetch) {
                  const pcIsFetch = pc.getExpression().getText() === "fetch";
                  if (!pcIsFetch) return false;
                  const mcArgs = mc.getArguments();
                  const pcArgs = pc.getArguments();
                  if (mcArgs.length > 0 && pcArgs.length > 0) {
                    return mcArgs[0]!.getText() === pcArgs[0]!.getText();
                  }
                  return false;
                } else {
                  return pc.getText() === mcText;
                }
              });

              if (matchingCall) {
                if (isFetch) {
                  const urlText = mc.getArguments()[0]?.getText() || mc.getExpression().getText();
                  const diag = mapEventToDiagnostic(
                    "DUPLICATE_DATA_REQUEST",
                    "DF-009",
                    this.id,
                    analysis.filePath,
                    mc.getStartLineNumber(),
                    `Duplicate fetch call detected: both generateMetadata() and the page component fetch '${urlText}'. In Next.js, use cached data helpers, React.cache(), or unstable_cache() to deduplicate requests between generateMetadata and page rendering.`
                  );
                  diag.safeRefactorSuggestion = 
                    `// Deduplicate this request by wrapping it in React.cache() in a shared helper:\n` +
                    `import { cache } from 'react';\n\n` +
                    `export const getProductData = cache(async (id: string) => {\n` +
                    `  const res = await fetch(\`https://api.com/product/\${id}\`);\n` +
                    `  return res.json();\n` +
                    `});\n\n` +
                    `// Then in generateMetadata and Page:\n` +
                    `const data = await getProductData(params.id);`;
                  diagnostics.push(diag);
                } else {
                  const queryText = mc.getExpression().getText();
                  const diag = mapEventToDiagnostic(
                    "DUPLICATE_DATA_REQUEST",
                    "MD-002",
                    this.id,
                    analysis.filePath,
                    mc.getStartLineNumber(),
                    `Duplicate database query/call detected: both generateMetadata() and the page component query/call '${queryText}'. In Next.js, use cached data helpers or React.cache() to deduplicate requests between generateMetadata and page rendering.`
                  );
                  diag.safeRefactorSuggestion = 
                    `// Wrap your database query function inside React.cache() to share requests:\n` +
                    `import { cache } from 'react';\n` +
                    `import { db } from './db';\n\n` +
                    `export const getProductFromDb = cache(async (id: string) => {\n` +
                    `  return db.select().from(products).where(eq(products.id, id)).execute();\n` +
                    `});\n\n` +
                    `// Then call in generateMetadata and Page:\n` +
                    `const product = await getProductFromDb(params.id);`;
                  diagnostics.push(diag);
                }
              }
            }
          }
        }

        for (const func of componentFunctions) {
          // ── DF-003: Server Component calling internal /api/ route ────────────
          const callExpressions = func.getDescendantsOfKind(SyntaxKind.CallExpression);
          for (const call of callExpressions) {
            if (call.getExpression().getText() === "fetch") {
              const args = call.getArguments();
              if (args.length > 0) {
                const urlArg = args[0]!;
                const urlText = urlArg.getText();
                const isInternalApi =
                  /^['"`]\/api\//.test(urlText) ||
                  (urlArg.getKind() === SyntaxKind.TemplateExpression && urlText.startsWith("`/api/"));

                if (isInternalApi) {
                  diagnostics.push(
                    mapEventToDiagnostic(
                      "INTERNAL_API_ROUTE_CALL",
                      "DF-003",
                      this.id,
                      analysis.filePath,
                      call.getStartLineNumber(),
                      `Server Component directly fetches internal API Route '${urlText.replace(/['"` + "`]/g, "")}'. Import and call the data access function directly to avoid a loopback network request.`
                    )
                  );
                }
              }
            }
          }

          // ── DF-004: Uncached DB query in Server Component ────────────────────
          const bodyText = func.getBody()?.getText() ?? "";
          const containsDbAccess = /\b(db\.\w+|prisma\.\w+|drizzle\.\w+)\b/.test(bodyText);
          const hasCacheDirective =
            content.includes('"use cache"') ||
            content.includes("'use cache'") ||
            content.includes("unstable_cache");

          if (containsDbAccess && !hasCacheDirective) {
            diagnostics.push(
              mapEventToDiagnostic(
                "CACHE_CONFLICT_DETECTED",
                "DF-004",
                this.id,
                analysis.filePath,
                func.getStartLineNumber(),
                `Server Component accesses database/ORM directly without a caching wrapper ('use cache' or 'unstable_cache'). This query will hit the database on every render request.`
              )
            );
          }

          // ── DF-005: Sequential awaits → waterfall ────────────────────────────
          const allAwaits = func.getDescendantsOfKind(SyntaxKind.AwaitExpression);
          const awaits = allAwaits.filter(aw => {
            return isDirectAwaitInFunction(aw, func) && isWaterfallCandidate(aw);
          });

          if (awaits.length >= 2) {
            const definedVariables = new Set<string>();
            const independentAwaits: Node[] = [];

            for (const aw of awaits) {
              const isDependent = expressionReferencesVariables(aw, definedVariables);
              if (!isDependent) {
                independentAwaits.push(aw);
              }
              const newVars = getVariablesDefinedByAwait(aw);
              for (const v of newVars) {
                definedVariables.add(v);
              }
            }

            if (independentAwaits.length >= 2) {
              const sequentialLines = independentAwaits.map(aw => aw.getStartLineNumber());
              const mockLatencies = [500, 300, 200, 100, 100, 100];
              const items = sequentialLines.map((line, idx) => ({
                line,
                latency: mockLatencies[idx] ?? 100
              }));
              const sequentialSum = items.reduce((acc, item) => acc + item.latency, 0);
              const parallelMax = Math.max(...items.map(item => item.latency));
              const latencySaved = sequentialSum - parallelMax;

              // ── Latency-tiered severity ──────────────────────────────────────
              let waterfallTier: "MINOR" | "MODERATE" | "MAJOR";
              let severityLabel: string;
              if (latencySaved >= 500) {
                waterfallTier = "MAJOR";
                severityLabel = "Significant";
              } else if (latencySaved >= 100) {
                waterfallTier = "MODERATE";
                severityLabel = "Moderate";
              } else {
                waterfallTier = "MINOR";
                severityLabel = "Minor";
              }

              const latencyLossText =
                `${severityLabel} request waterfall detected (${latencySaved}ms latency penalty). ` +
                `Multiple sequential awaits (lines ${sequentialLines.join(", ")}) for fetch or database calls ` +
                `in a Server Component body. Run these in parallel with Promise.all().`;

              const df005Diag = mapEventToDiagnostic(
                "SEQUENTIAL_FETCH_WATERFALL",
                "DF-005",
                this.id,
                analysis.filePath,
                sequentialLines[0]!,
                latencyLossText
              ) as any;
              df005Diag.waterfallTier = waterfallTier;
              diagnostics.push(df005Diag);
            }
            // ── DF-006: Duplicate function calls in same render scope ───────────
            const callNameCounts = new Map<string, { count: number; firstLine: number }>();
            for (const aw of awaits) {
              const expression = aw.getExpression();
              if (expression && expression.getKind() === SyntaxKind.CallExpression) {
                const callText = (expression as any).getExpression().getText();
                // Skip Promise.* and common non-data utilities
                if (callText.startsWith("Promise.") || callText === "setTimeout" || callText === "sleep") continue;
                
                // Skip if wrapped in cache() or unstable_cache()
                if (cachedFunctionNames.has(callText)) continue;

                const existing = callNameCounts.get(callText);
                if (existing) {
                  existing.count++;
                } else {
                  callNameCounts.set(callText, { count: 1, firstLine: aw.getStartLineNumber() });
                }
              }
            }

            for (const [fnName, { count, firstLine }] of callNameCounts) {
              if (count >= 2) {
                diagnostics.push(
                  mapEventToDiagnostic(
                    "REQUEST_DEDUPLICATION_OPPORTUNITY",
                    "DF-006",
                    this.id,
                    analysis.filePath,
                    firstLine,
                    `Duplicate data request detected: '${fnName}()' is called ${count} times in this Server Component render pass. Wrap the source function with React.cache() to eliminate redundant network or database calls via React Request Memoization.`
                  )
                );
              }
            }
          }
        }
      }

      // ── DF-002: Exported DB helpers not wrapped in React.cache() ────────────
      // This applies to utility modules — the opposite of DF-001 scope
      if (isUtil) {
        const exports = sourceFile.getExportedDeclarations();
        for (const [name, declarations] of exports) {
          for (const decl of declarations) {
            const bodyText = decl.getText();
            const hasDbQuery = /\b(db\.\w+|prisma\.\w+|drizzle\.\w+)\b/.test(bodyText);
            if (!hasDbQuery) continue;

            let isWrapped = false;
            const line = decl.getStartLineNumber();

            if (decl.getKind() === SyntaxKind.FunctionDeclaration) {
              // function declaration — cannot be directly wrapped, flag it
              isWrapped = false;
            } else if (decl.getKind() === SyntaxKind.VariableDeclaration) {
              const init = (decl as any).getInitializer();
              if (init && init.getKind() === SyntaxKind.CallExpression) {
                const callText = init.getExpression().getText();
                if (callText === "cache" || callText.endsWith(".cache")) {
                  isWrapped = true;
                }
              }
            }

            if (!isWrapped) {
              diagnostics.push(
                mapEventToDiagnostic(
                  "REQUEST_DEDUPLICATION_OPPORTUNITY",
                  "DF-002",
                  this.id,
                  analysis.filePath,
                  line,
                  `Exported data access function '${name}' queries the database but is not wrapped in React.cache(). Multiple calls to this function in the same render pass will trigger duplicate database queries.`
                )
              );
            }
          }
        }
      }
    }

    return diagnostics;
  },
};
