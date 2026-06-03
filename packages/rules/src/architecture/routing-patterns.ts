import { Rule, RuleContext, Diagnostic } from "../types.js";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";
import { Project, SyntaxKind, Node } from "ts-morph";
import { readFileSync } from "node:fs";

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
 * Checks if the expression being awaited references any of the variables in the set.
 */
function expressionReferencesVariables(awaitExpr: Node, variables: Set<string>): boolean {
  const expression = (awaitExpr as any).getExpression();
  if (!expression) return false;
  
  const identifiers = expression.getDescendantsOfKind(SyntaxKind.Identifier);
  for (const id of identifiers) {
    if (variables.has(id.getText())) {
      return true;
    }
  }
  return false;
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
 * Helper to get the body node of a function or initialization.
 */
function getFunctionBody(node: Node): Node | undefined {
  if (node.getKind() === SyntaxKind.FunctionDeclaration ||
      node.getKind() === SyntaxKind.FunctionExpression ||
      node.getKind() === SyntaxKind.ArrowFunction ||
      node.getKind() === SyntaxKind.MethodDeclaration) {
    return (node as any).getBody();
  }
  if (node.getKind() === SyntaxKind.VariableDeclaration) {
    const init = (node as any).getInitializer();
    if (init) {
      return getFunctionBody(init);
    }
  }
  return undefined;
}

/**
 * Checks if the JSX returned by a function contains any independent sibling elements
 * relative to the provided fetched variables.
 */
function hasIndependentSiblingsForSingleFetch(funcBody: Node, dataVars: Set<string>): boolean {
  const allReturns = funcBody.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  const returns = allReturns.filter(ret => {
    const ancestor = ret.getFirstAncestor(n => 
      n.getKind() === SyntaxKind.FunctionDeclaration ||
      n.getKind() === SyntaxKind.ArrowFunction ||
      n.getKind() === SyntaxKind.FunctionExpression ||
      n.getKind() === SyntaxKind.MethodDeclaration
    );
    return ancestor === funcBody.getParent();
  });

  function unwrapParentheses(node: Node): Node {
    if (node.getKind() === SyntaxKind.ParenthesizedExpression) {
      const inner = (node as any).getExpression();
      if (inner) return unwrapParentheses(inner);
    }
    return node;
  }

  function nodeReferencesVariables(n: Node, variables: Set<string>): boolean {
    const identifiers = n.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const id of identifiers) {
      if (variables.has(id.getText())) {
        return true;
      }
    }
    return false;
  }

  function checkSplit(node: Node): boolean {
    let children: Node[] = [];
    if (node.getKind() === SyntaxKind.JsxElement) {
      children = (node as any).getJsxChildren();
    } else if (node.getKind() === SyntaxKind.JsxFragment) {
      children = (node as any).getJsxChildren();
    }

    const nonWhitespace = children.filter(c => {
      if (c.getKind() === SyntaxKind.JsxText) {
        return c.getText().trim().length > 0;
      }
      return true;
    });

    if (nonWhitespace.length >= 2) {
      let hasDep = false;
      let hasIndep = false;
      for (const child of nonWhitespace) {
        if (nodeReferencesVariables(child, dataVars)) {
          hasDep = true;
        } else {
          hasIndep = true;
        }
      }
      if (hasDep && hasIndep) {
        return true;
      }
    }

    for (const child of nonWhitespace) {
      if (checkSplit(child)) {
        return true;
      }
    }

    return false;
  }

  if (returns.length === 0) {
    const unwrapped = unwrapParentheses(funcBody);
    return checkSplit(unwrapped);
  }

  for (const ret of returns) {
    const expr = ret.getExpression();
    if (expr) {
      const unwrapped = unwrapParentheses(expr);
      if (checkSplit(unwrapped)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Rule: routing-patterns
 *
 * Implements:
 * 1. RO-001: Non-routing files co-located in a route segment folder (hybrid Layer-1 + Layer-2)
 * 2. RO-003: Parallel route slots (@slot) missing a sibling default.tsx
 * 3. RO-004: Intercepting routes with incorrect hierarchy or missing @slot parent
 * 4. RO-005: Async data fetch in page.tsx without a Suspense boundary
 * 5. CA-007: revalidatePath("/") broad cache invalidation after single-entity mutation
 */

// ── Layer-1 fast-path: these folder names are NEVER route segments ─────────────
const ORGANIZATIONAL_FOLDERS = new Set([
  "components", "component",
  "shared", "share",
  "lib", "libs",
  "utils", "util", "utilities",
  "hooks", "hook",
  "helpers", "helper",
  "types", "type",
  "constants", "const",
  "styles", "style", "css",
  "assets", "icons", "images",
  "providers", "provider",
  "context", "contexts",
  "store", "stores",
  "config", "configs",
  "services", "service",
  "api", "apis",     // api/ folders are organizational — actual route handlers are route.ts
  "server",          // app/server/ is a conventional server-only utility folder
  "client",          // app/client/ same pattern
  "data",
  "schemas", "schema",
  "models", "model",
  "tests", "__tests__", "test", "spec",
  "__mocks__", "mocks",
  "fixtures",
]);

// ── Next.js App Router reserved routing file names (basename without extension)
const ROUTING_FILE_BASENAMES = new Set([
  "page",
  "layout",
  "template",
  "loading",
  "error",
  "not-found",
  "global-error",
  "default",
  "route",
  "middleware",
  "instrumentation",
  "sitemap",
  "opengraph-image",
  "twitter-image",
  "robots",
  "manifest",
  "icon",
  "apple-icon",
]);

/**
 * Returns true if any ancestor segment (up to app/) is an organizational folder.
 * This is the Layer-1 fast path.
 */
function isUnderOrganizationalFolder(segments: string[]): boolean {
  // segments is the path parts after /app/ excluding the filename
  return segments.slice(0, -1).some(seg => {
    // Strip route group parens and @ prefix for comparison
    const clean = seg.replace(/^\((.+)\)$/, "$1").replace(/^@/, "");
    return ORGANIZATIONAL_FOLDERS.has(clean);
  });
}

/**
 * Layer-2 structural check: is this folder actually a route segment?
 * A folder is a route segment if it contains at least one routing file.
 */
function folderContainsRoutingFile(folderPath: string): boolean {
  try {
    const entries = readdirSync(folderPath);
    return entries.some(entry => {
      const base = entry.replace(/\.[^.]+$/, "");
      return ROUTING_FILE_BASENAMES.has(base);
    });
  } catch {
    return false;
  }
}

function folderContainsPageRouteFile(folderPath: string): boolean {
  try {
    const entries = readdirSync(folderPath);
    return entries.some(entry => {
      const base = entry.replace(/\.[^.]+$/, "");
      return base === "page" || base === "route";
    });
  } catch {
    return false;
  }
}

function resolveImportPath(currentFilePath: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith(".")) return null;
  const currentDir = path.dirname(currentFilePath);
  const absoluteNoExt = path.resolve(currentDir, moduleSpecifier);
  const extensions = [".tsx", ".ts", ".jsx", ".js"];
  for (const ext of extensions) {
    const p = absoluteNoExt + ext;
    if (existsSync(p)) {
      return p;
    }
    const indexP = path.resolve(absoluteNoExt, "index" + ext);
    if (existsSync(indexP)) {
      return indexP;
    }
  }
  return null;
}

function isAsyncDataFetchingComponent(analysis: any): boolean {
  if (analysis.isClientComponent) return false;
  
  const hasFetch = analysis.fetchCalls && analysis.fetchCalls.length > 0;
  
  let hasDbFetch = false;
  try {
    const fileContent = readFileSync(analysis.filePath, "utf-8");
    hasDbFetch = /\bawait\s+(fetch|get[A-Z]|\w+DB|\w+\.find|\w+\.query|db\.)/g.test(fileContent);
  } catch {}

  const isAsync = analysis.hasAsyncComponent || (() => {
    try {
      const fileContent = readFileSync(analysis.filePath, "utf-8");
      return /export\s+default\s+async\s+function/.test(fileContent) ||
             /export\s+default\s+async\s+\(/.test(fileContent) ||
             /export\s+async\s+function/.test(fileContent);
    } catch {
      return false;
    }
  })();

  return !!(isAsync && (hasFetch || hasDbFetch));
}

function calculateTarget(
  parentParts: string[],
  isRoot: boolean,
  upLevels: number,
  targetName: string,
  subsequentSegments: string[]
): string {
  let baseParts: string[] = [];
  if (isRoot) {
    baseParts = [];
  } else {
    if (upLevels > parentParts.length) {
      baseParts = [];
    } else {
      baseParts = parentParts.slice(0, parentParts.length - upLevels);
    }
  }
  return [...baseParts, targetName, ...subsequentSegments].join("/");
}

export const routingPatterns: Rule = {
  id: "routing-patterns",

  meta: {
    description: "Detect routing folder structure violations and missing parallel route fallbacks.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const ro001Constraint = context.knowledgeRegistry.getConstraint("routing", "RO-001");
    const ro003Constraint = context.knowledgeRegistry.getConstraint("routing", "RO-003");

    // Pre-calculate all known default.tsx files in the analyses
    const hasDefaultFileMap = new Map<string, boolean>();
    for (const analysis of context.analyses) {
      const norm = analysis.filePath.replace(/\\/g, "/");
      if (
        norm.endsWith("/default.tsx") ||
        norm.endsWith("/default.jsx") ||
        norm.endsWith("/default.js")
      ) {
        const dir = norm.substring(0, norm.lastIndexOf("/"));
        hasDefaultFileMap.set(dir, true);
      }
    }

    for (const analysis of context.analyses) {
      const filePath = analysis.filePath;
      const normPath = filePath.replace(/\\/g, "/");

      // Only care about files inside the App Router ('app' directory)
      const appIndex = normPath.indexOf("/app/");
      if (appIndex === -1) continue;

      const relativeAppPath = normPath.substring(appIndex + 5); // path after "/app/"
      const pathSegments = relativeAppPath.split("/");
      const filename = pathSegments[pathSegments.length - 1]!;
      const ext = path.extname(filename);
      const baseFilename = filename.substring(0, filename.length - ext.length);

      // Skip declaration and config files
      if (filename.endsWith(".d.ts") || filename.startsWith("config.")) continue;

      // Check if any segment starts with underscore (Next.js private folder — always exempt)
      const hasPrivateParent = pathSegments.slice(0, -1).some(seg => seg.startsWith("_"));

      // ── RO-001: Non-routing file in a route segment ──────────────────────────
      if (!hasPrivateParent && !ROUTING_FILE_BASENAMES.has(baseFilename)) {
        // Layer-1 fast path: if ANY ancestor directory is an organizational folder, skip immediately
        const directParentSeg = pathSegments.length >= 2
          ? pathSegments[pathSegments.length - 2]!
          : "";
        const cleanParent = directParentSeg.replace(/^\((.+)\)$/, "$1").replace(/^@/, "");

        const underOrg = isUnderOrganizationalFolder(pathSegments);

        if (!underOrg && pathSegments.length > 1) {
          // Layer-2: verify the parent folder is actually a route segment
          const parentFolderPath = normPath.substring(0, normPath.lastIndexOf("/"));
          const absoluteParent = filePath.substring(0, filePath.lastIndexOf(path.sep));
          const parentIsRouteSegment = folderContainsPageRouteFile(absoluteParent);

          if (parentIsRouteSegment) {
            diagnostics.push({
              file: filePath,
              line: 1,
              severity: ro001Constraint?.severity ?? "warning",
              ruleId: this.id,
              id: ro001Constraint?.id ?? "RO-001",
              message: `Non-routing file '${filename}' co-located in route segment '/app/${pathSegments.slice(0, -1).join("/")}'. ${ro001Constraint?.problem ?? "Move it to a private folder (prefix with _) or to an organizational folder like app/components/."}`,
              whyItMatters: ro001Constraint?.whyItMatters ?? "Non-routing files in route segments can cause accidental route exposure or bundler confusion.",
              quickFixes: ro001Constraint?.quickFixes ?? [],
              architectureSuggestions: ro001Constraint?.architectureSuggestions ?? [],
              optimizationGuidance: ro001Constraint?.optimizationGuidance ?? [],
              productionRisks: ro001Constraint?.productionRisks ?? [],
              examples: ro001Constraint?.examples,
              fix: ro001Constraint?.quickFixes?.[0],
            });
          }
        }
      }

      // ── RO-003: Parallel route slot missing default.tsx ──────────────────────
      const isPage = baseFilename === "page";
      const hasParallelSlot = pathSegments.some(seg => seg.startsWith("@"));

      if (isPage && hasParallelSlot) {
        const currentDir = normPath.substring(0, normPath.lastIndexOf("/"));
        const slotSegment = pathSegments.find(seg => seg.startsWith("@"))!;

        if (!hasDefaultFileMap.has(currentDir)) {
          diagnostics.push({
            file: filePath,
            line: 1,
            severity: ro003Constraint?.severity ?? "error",
            ruleId: this.id,
            id: ro003Constraint?.id ?? "RO-003",
            message: `Missing default fallback file in parallel route slot '${slotSegment}' at '/app/${pathSegments.slice(0, -1).join("/")}'. Omitting a default.tsx (or default.jsx) fallback file inside Parallel Route slots (@slot) will cause 404 errors during clientside page reload or navigation.`,
            whyItMatters: ro003Constraint?.whyItMatters ?? "A missing default fallback will cause a 404 crash on browser reload.",
            quickFixes: ro003Constraint?.quickFixes ?? [],
            architectureSuggestions: ro003Constraint?.architectureSuggestions ?? [],
            optimizationGuidance: ro003Constraint?.optimizationGuidance ?? [],
            productionRisks: ro003Constraint?.productionRisks ?? [],
            examples: ro003Constraint?.examples,
            fix: ro003Constraint?.quickFixes?.[0],
          });
        }
      }

      // ── RO-004: Intercepting route incorrect hierarchy / missing @slot ────────
      const interceptingSegment = pathSegments.find(seg =>
        /^\(\.\)/.test(seg) || /^\(\.\.\)/.test(seg) || /^\(\.\.\.\)/.test(seg)
      );

      if (interceptingSegment) {
        const idx = pathSegments.indexOf(interceptingSegment);
        const parentParts = pathSegments.slice(0, idx);
        const subsequentSegments = pathSegments.slice(idx + 1, -1);

        let prefix = "";
        let targetName = "";
        let upLevels = 0;
        let isRoot = false;

        if (interceptingSegment.startsWith("(...)")) {
          prefix = "(...)";
          targetName = interceptingSegment.substring(5);
          isRoot = true;
        } else if (interceptingSegment.startsWith("(.)")) {
          prefix = "(.)";
          targetName = interceptingSegment.substring(3);
          upLevels = 0;
        } else {
          let temp = interceptingSegment;
          while (temp.startsWith("(..)")) {
            prefix += "(..)";
            upLevels++;
            temp = temp.substring(4);
          }
          targetName = temp;
        }

        const calculatedTarget = calculateTarget(parentParts, isRoot, upLevels, targetName, subsequentSegments);

        // Build activeRoutes from context.analyses
        const activeRoutes = new Set<string>();
        for (const a of context.analyses) {
          const norm = a.filePath.replace(/\\/g, "/");
          const aAppIndex = norm.indexOf("/app/");
          if (aAppIndex === -1) continue;
          const aRel = norm.substring(aAppIndex + 5);
          const parts = aRel.split("/");
          const file = parts[parts.length - 1]!;
          const base = file.replace(/\.[^.]+$/, "");
          if (base === "page" || base === "route") {
            const routeDir = parts.slice(0, -1).join("/");
            activeRoutes.add(routeDir);
          }
        }

        // Verify if target route exists at the calculated target path
        if (!activeRoutes.has(calculatedTarget)) {
          let suggestedPrefix = "";
          const prefixCandidates = [
            { label: "(.)", root: false, levels: 0 },
            { label: "(..)", root: false, levels: 1 },
            { label: "(..)(..)", root: false, levels: 2 },
            { label: "(...)", root: true, levels: 0 },
          ];

          for (const cand of prefixCandidates) {
            const candidateTarget = calculateTarget(parentParts, cand.root, cand.levels, targetName, subsequentSegments);
            if (activeRoutes.has(candidateTarget)) {
              suggestedPrefix = cand.label;
              break;
            }
          }

          if (suggestedPrefix) {
            diagnostics.push({
              file: filePath,
              line: 1,
              severity: "error",
              ruleId: this.id,
              id: "RO-004",
              message: `Intercepting route '${interceptingSegment}' points to incorrect hierarchy level. The target route is located at a different depth. Did you mean to use '${suggestedPrefix}${targetName}' instead?`,
              whyItMatters: "Intercepting routes must accurately match the target segment's nesting level relative to the intercepting route location, or Next.js will fail to match the route and fallback to a standard navigation.",
              quickFixes: [
                `Rename folder '${interceptingSegment}' to '${suggestedPrefix}${targetName}' to match the target route level.`
              ],
              architectureSuggestions: [
                `Verify target route structure: '${calculatedTarget}' was expected, but route exists at a different level.`
              ],
              optimizationGuidance: [],
              productionRisks: [
                "Intercepting route fails to trigger, causing fallback to standard page navigation."
              ]
            });
          } else {
            diagnostics.push({
              file: filePath,
              line: 1,
              severity: "warning",
              ruleId: this.id,
              id: "RO-004",
              message: `Intercepting route '${interceptingSegment}' target '${calculatedTarget}' could not be resolved to any active route in your app directory.`,
              whyItMatters: "Intercepting routes must target a valid active route segment that contains a page.tsx or route.ts file.",
              quickFixes: [
                "Ensure the target folder exists and contains a page.tsx or route.ts file.",
                "Check the spelling of the target route name."
              ],
              architectureSuggestions: [],
              optimizationGuidance: [],
              productionRisks: ["Broken route: intercepting route will not resolve."]
            });
          }
        }

        // Sibling slot check
        const isNestedInSlot = pathSegments.some(seg => seg.startsWith("@"));
        let hasSiblingSlot = isNestedInSlot;
        if (!hasSiblingSlot) {
          const parentAppRelative = parentParts.join("/");
          hasSiblingSlot = context.analyses.some(a => {
            const n = a.filePath.replace(/\\/g, "/");
            const aAppIndex = n.indexOf("/app/");
            if (aAppIndex === -1) return false;
            const aRel = n.substring(aAppIndex + 5);
            const aParts = aRel.split("/");
            if (aParts.length <= parentParts.length) return false;
            const aParent = aParts.slice(0, parentParts.length).join("/");
            if (aParent !== parentAppRelative) return false;
            const siblingSeg = aParts[parentParts.length];
            return siblingSeg ? siblingSeg.startsWith("@") : false;
          });

          if (!hasSiblingSlot) {
            diagnostics.push({
              file: filePath,
              line: 1,
              severity: "warning",
              ruleId: this.id,
              id: "RO-004",
              message: `Intercepting route '${interceptingSegment}' has no sibling parallel route slot (@modal or similar) at the same layout level. Intercepting routes require a matching @slot parallel route in the parent layout to render the intercepted content alongside the original page.`,
              whyItMatters: "Without a matching @slot, the intercepted route has nowhere to render and will fall back to a full page navigation, defeating the purpose of the interception.",
              quickFixes: [
                "Create a sibling @modal directory with a page.tsx and default.tsx in the same parent layout folder.",
                "Ensure the parent layout.tsx references both the default children slot and the @modal slot.",
              ],
              architectureSuggestions: [
                "Structure: app/feed/@modal/(.)photo/[id]/page.tsx + app/feed/@modal/default.tsx + app/feed/layout.tsx receiving { children, modal } props.",
              ],
              optimizationGuidance: [],
              productionRisks: ["Full page navigation instead of modal overlay when intercepting route is triggered."],
            });
          }
        }
      }

      // ── RO-005: Async components & Suspense boundary checks ──────────────────
      
      // 1. Root check on page files containing direct awaits
      if (
        baseFilename === "page" &&
        !analysis.isClientComponent
      ) {
        let content = "";
        try {
          content = readFileSync(filePath, "utf-8");
        } catch {
          // ignore
        }

        if (content) {
          const hasSuspense = content.includes("<Suspense") || content.includes("React.Suspense");
          const hasDirectAwait = /\bawait\s+(fetch|get[A-Z]|\w+\(\))/g.test(content);
          const isAsync = /export\s+default\s+async\s+function/.test(content) ||
                          /export\s+default\s+async\s+\(/.test(content);

          if (isAsync) {
            let finalFetchCount = 0;
            let finalIsWaterfall = false;
            let shouldSuppressRo005 = false;

            try {
              const project = new Project();
              const sourceFile = project.createSourceFile("_temp_ro005_root.tsx", content);
              const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
              let defaultExportNode: Node | undefined;
              if (defaultExportSymbol) {
                const decls = defaultExportSymbol.getDeclarations();
                if (decls.length > 0) {
                  defaultExportNode = decls[0];
                }
              }

              let funcNode: Node | undefined;
              if (defaultExportNode) {
                if (defaultExportNode.getKind() === SyntaxKind.FunctionDeclaration ||
                    defaultExportNode.getKind() === SyntaxKind.ArrowFunction ||
                    defaultExportNode.getKind() === SyntaxKind.FunctionExpression) {
                  funcNode = defaultExportNode;
                } else if (defaultExportNode.getKind() === SyntaxKind.VariableDeclaration) {
                  const init = (defaultExportNode as any).getInitializer();
                  if (init && (
                    init.getKind() === SyntaxKind.ArrowFunction ||
                    init.getKind() === SyntaxKind.FunctionExpression
                  )) {
                    funcNode = init;
                  }
                }
              }

              if (funcNode) {
                const body = getFunctionBody(funcNode);
                if (body) {
                  const allAwaits = body.getDescendantsOfKind(SyntaxKind.AwaitExpression);
                  const directAwaits = allAwaits.filter(aw => isDirectAwaitInFunction(aw, funcNode!));
                  
                  finalFetchCount = directAwaits.length;
                  finalIsWaterfall = finalFetchCount > 1 && !content.includes("Promise.all");

                  // RO-005 suppression logic
                  if (finalFetchCount === 0) {
                    shouldSuppressRo005 = true;
                  } else if (finalFetchCount === 1) {
                    const awaitExpr = directAwaits[0]!;
                    const dataVars = getVariablesDefinedByAwait(awaitExpr);
                    if (dataVars.size > 0) {
                      const hasIndep = hasIndependentSiblingsForSingleFetch(body, dataVars);
                      if (!hasIndep) {
                        shouldSuppressRo005 = true;
                      }
                    }
                  }

                  // RO-007 sequential waterfall logic
                  const awaitsForWaterfall = directAwaits.filter(aw => {
                    const expression = aw.getExpression();
                    if (!expression) return false;
                    const expressionText = expression.getText();
                    return !expressionText.startsWith("Promise.all") && 
                           !expressionText.startsWith("Promise.allSettled") && 
                           !expressionText.startsWith("Promise.race");
                  });

                  if (awaitsForWaterfall.length >= 2) {
                    const definedVariables = new Set<string>();
                    const independentAwaits: Node[] = [];

                    for (const aw of awaitsForWaterfall) {
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
                      const lines = independentAwaits.map(aw => aw.getStartLineNumber());
                      diagnostics.push({
                        file: filePath,
                        line: lines[0]!,
                        severity: "warning",
                        ruleId: this.id,
                        id: "RO-007",
                        message: `Sequential Async Waterfall: Multiple independent async fetches or queries are awaited sequentially (lines ${lines.join(", ")}). Use Promise.all() to execute them in parallel and reduce rendering latency.`,
                        whyItMatters: "Awaiting multiple independent promises sequentially forces serial resolution, extending page load time. Running them in parallel with Promise.all() optimizes loading times.",
                        quickFixes: [
                          "Use Promise.all() to run independent requests in parallel: const [a, b] = await Promise.all([fetchA(), fetchB()]);"
                        ],
                        architectureSuggestions: [
                          "Keep async operations independent and bundle them using Promise.all() or Promise.allSettled()."
                        ],
                        optimizationGuidance: [],
                        productionRisks: [
                          "Substantially higher TTFB and rendering delays."
                        ]
                      });
                    }
                  }
                } else {
                  shouldSuppressRo005 = true;
                }
              } else {
                shouldSuppressRo005 = true;
              }
            } catch (e) {
              // ignore
            }

            if (hasDirectAwait && !hasSuspense && !shouldSuppressRo005) {
              diagnostics.push({
                file: filePath,
                line: 1,
                severity: "info",
                ruleId: this.id,
                id: "RO-005",
                fetchCount: finalFetchCount,
                isWaterfall: finalIsWaterfall,
                message: `Streaming Opportunity: Wrap data fetch in Suspense boundary. In Next.js App Router, top-level async pages are standard and fully supported — but wrapping data fetching sections in Suspense is a recommended optimization to enable progressive HTML streaming and improve perceived load times.`,
                whyItMatters: "Without Suspense, Next.js cannot stream partial HTML to the browser while data loads. The user sees a blank page until all fetches resolve, increasing Time to First Byte and degrading LCP.",
                quickFixes: [
                  "Extract the async data-fetching part into a separate async component.",
                  "Wrap the extracted component: <Suspense fallback={<Skeleton />}><DataComponent /></Suspense>",
                ],
                architectureSuggestions: [
                  "Design pages as a static shell that renders instantly, with Suspense-wrapped async components for each independent data boundary.",
                ],
                optimizationGuidance: [
                  "Each Suspense boundary creates an independent streaming chunk — align boundaries with independent data sources.",
                ],
                productionRisks: [
                  "Full TTFB delay equal to slowest data fetch for the entire page",
                  "Degraded Core Web Vitals (LCP) under slow network or database conditions",
                ],
              });
            }
          }
        }
      }

      // ── RO-006: Layout awaits blocking rendering ──────────────────────────
      if (baseFilename === "layout" && !analysis.isClientComponent) {
        let content = "";
        try {
          content = readFileSync(filePath, "utf-8");
        } catch {
          // ignore
        }

        if (content) {
          const hasDirectAwait = /\bawait\s+(fetch|db\.|prisma\.|drizzle\.|get[A-Z]|\w+\(\))/g.test(content);
          const isAsync = /export\s+default\s+async\s+function/.test(content) ||
                          /export\s+default\s+async\s+\(/.test(content);

          if (isAsync && hasDirectAwait) {
            let finalFetchCount = 0;
            let finalIsWaterfall = false;
            let shouldFlag = false;
            let isCritical = false;

            try {
              const project = new Project();
              const sourceFile = project.createSourceFile("_temp_ro006_root.tsx", content);
              const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
              let defaultExportNode: Node | undefined;
              if (defaultExportSymbol) {
                const decls = defaultExportSymbol.getDeclarations();
                if (decls.length > 0) {
                  defaultExportNode = decls[0];
                }
              }

              let funcNode: Node | undefined;
              if (defaultExportNode) {
                if (defaultExportNode.getKind() === SyntaxKind.FunctionDeclaration ||
                    defaultExportNode.getKind() === SyntaxKind.ArrowFunction ||
                    defaultExportNode.getKind() === SyntaxKind.FunctionExpression) {
                  funcNode = defaultExportNode;
                } else if (defaultExportNode.getKind() === SyntaxKind.VariableDeclaration) {
                  const init = (defaultExportNode as any).getInitializer();
                  if (init && (
                    init.getKind() === SyntaxKind.ArrowFunction ||
                    init.getKind() === SyntaxKind.FunctionExpression
                  )) {
                    funcNode = init;
                  }
                }
              }

              if (funcNode) {
                const body = getFunctionBody(funcNode);
                if (body) {
                  const allAwaits = body.getDescendantsOfKind(SyntaxKind.AwaitExpression);
                  const directAwaits = allAwaits.filter(aw => isDirectAwaitInFunction(aw, funcNode!));
                  
                  finalFetchCount = directAwaits.length;
                  finalIsWaterfall = finalFetchCount > 1 && !content.includes("Promise.all");

                  if (finalFetchCount > 0) {
                    shouldFlag = true;

                    // Check for critical keywords in layout awaits (e.g. auth, session, tenant)
                    const CRITICAL_WORDS = /\b(auth|session|user|member|profile|role|permission|tenant|token|jwt|credential|login|security)\b/i;
                    for (const aw of directAwaits) {
                      const text = aw.getText();
                      const parent = aw.getParent();
                      let varName = "";
                      if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
                        varName = (parent as any).getName();
                      }
                      if (CRITICAL_WORDS.test(text) || CRITICAL_WORDS.test(varName)) {
                        isCritical = true;
                        break;
                      }
                    }
                  }
                }
              }
            } catch (e) {
              shouldFlag = true;
            }

            if (shouldFlag) {
              const isAuthGate = isCritical || 
                /redirect\(|notFound\(|auth\(|getServerSession\(|clerk|supabase/i.test(content);

              if (isAuthGate) {
                diagnostics.push({
                  file: filePath,
                  line: 1,
                  severity: "info",
                  ruleId: this.id,
                  id: "LAYOUT_AUTH_GATE",
                  fetchCount: finalFetchCount || undefined,
                  isWaterfall: finalIsWaterfall || undefined,
                  message: `Expected Authentication Boundary: this layout blocks rendering to resolve authentication, session, or tenant details. This is an expected pattern for layouts that must guard route access. If children can render without this data, consider wrapping the block in <Suspense>.`,
                  whyItMatters: "Authentication gates and route guards must resolve user session details before mounting child pages or executing nested subtrees.",
                  quickFixes: [
                    "No fix needed. Confirm auth gating is required at this layout boundary.",
                  ],
                  architectureSuggestions: [
                    "Keep layout auth checks focused on route validation. Consider delegating non-sensitive rendering sections to Suspense-wrapped child components.",
                  ],
                  optimizationGuidance: [
                    "If children do not require auth data, consider wrapping the protected sections in a nested layout or route group, allowing the root layout to remain completely static.",
                  ],
                  productionRisks: [],
                });
              } else {
                diagnostics.push({
                  file: filePath,
                  line: 1,
                  severity: "warning",
                  ruleId: this.id,
                  id: "RO-006",
                  fetchCount: finalFetchCount || undefined,
                  isWaterfall: finalIsWaterfall || undefined,
                  message: `Layout awaits data fetching/database query directly in render body. This blocks the entire page route subtree from rendering. Consider extracting the data-dependent layout sections into child components wrapped in <Suspense>.`,
                  whyItMatters: "When layout renders, any direct await blocks the layout component from returning its shell. This delays rendering the layout's HTML and blocks all children (nested pages and layouts) from mounting or streaming in parallel.",
                  quickFixes: [
                    "Extract the async data-fetching logic into a separate async component.",
                    "Render that component inside the layout, wrapped in a <Suspense> boundary: <Suspense fallback={<HeaderSkeleton />}><HeaderComponent /></Suspense>",
                  ],
                  architectureSuggestions: [
                    "Layouts should act as static shell components. They should mount instantly without waiting for network or database requests.",
                  ],
                  optimizationGuidance: [
                    "Wrap data-dependent components inside the layout in Suspense to allow child pages to render independently while layout data is loading.",
                  ],
                  productionRisks: [
                    "Severe TTFB and LCP latency across the entire route subtree.",
                    "Complete loss of streaming and parallel loading efficiency.",
                  ],
                });
              }
            }

            // Check for Sequential independent awaits (RO-007) in Layout
            try {
              const project = new Project();
              const sourceFile = project.createSourceFile("_temp_ro007_layout.tsx", content);
              const defaultExportSymbol = sourceFile.getDefaultExportSymbol();
              let defaultExportNode: Node | undefined;
              if (defaultExportSymbol) {
                const decls = defaultExportSymbol.getDeclarations();
                if (decls.length > 0) {
                  defaultExportNode = decls[0];
                }
              }

              let funcNode: Node | undefined;
              if (defaultExportNode) {
                if (defaultExportNode.getKind() === SyntaxKind.FunctionDeclaration ||
                    defaultExportNode.getKind() === SyntaxKind.ArrowFunction ||
                    defaultExportNode.getKind() === SyntaxKind.FunctionExpression) {
                  funcNode = defaultExportNode;
                } else if (defaultExportNode.getKind() === SyntaxKind.VariableDeclaration) {
                  const init = (defaultExportNode as any).getInitializer();
                  if (init && (
                    init.getKind() === SyntaxKind.ArrowFunction ||
                    init.getKind() === SyntaxKind.FunctionExpression
                  )) {
                    funcNode = init;
                  }
                }
              }

              if (funcNode) {
                const body = getFunctionBody(funcNode);
                if (body) {
                  const allAwaits = body.getDescendantsOfKind(SyntaxKind.AwaitExpression);
                  const directAwaits = allAwaits.filter(aw => isDirectAwaitInFunction(aw, funcNode!));
                  
                  const awaitsForWaterfall = directAwaits.filter(aw => {
                    const expression = aw.getExpression();
                    if (!expression) return false;
                    const expressionText = expression.getText();
                    return !expressionText.startsWith("Promise.all") && 
                           !expressionText.startsWith("Promise.allSettled") && 
                           !expressionText.startsWith("Promise.race");
                  });

                  if (awaitsForWaterfall.length >= 2) {
                    const definedVariables = new Set<string>();
                    const independentAwaits: Node[] = [];

                    for (const aw of awaitsForWaterfall) {
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
                      const lines = independentAwaits.map(aw => aw.getStartLineNumber());
                      diagnostics.push({
                        file: filePath,
                        line: lines[0]!,
                        severity: "warning",
                        ruleId: this.id,
                        id: "RO-007",
                        message: `Sequential Async Waterfall: Multiple independent async fetches or queries are awaited sequentially (lines ${lines.join(", ")}). Use Promise.all() to execute them in parallel and reduce rendering latency.`,
                        whyItMatters: "Awaiting multiple independent promises sequentially forces serial resolution, extending page load time. Running them in parallel with Promise.all() optimizes loading times.",
                        quickFixes: [
                          "Use Promise.all() to run independent requests in parallel: const [a, b] = await Promise.all([fetchA(), fetchB()]);"
                        ],
                        architectureSuggestions: [
                          "Keep async operations independent and bundle them using Promise.all() or Promise.allSettled()."
                        ],
                        optimizationGuidance: [],
                        productionRisks: [
                          "Substantially higher TTFB and rendering delays."
                        ]
                      });
                    }
                  }
                }
              }
            } catch (e) {
              // ignore
            }
          }
        }
      }

      // 2. JSX-level tracing of imported async data-fetching components
      if (!analysis.isClientComponent && analysis.importDetails) {
        const fileImportsAsyncFetch = [];
        
        for (const imp of analysis.importDetails) {
          const targetPath = resolveImportPath(filePath, imp.moduleSpecifier);
          if (!targetPath) continue;
          
          const childAnalysis = context.analyses.find(a => 
            path.normalize(a.filePath).replace(/\\/g, "/") === path.normalize(targetPath).replace(/\\/g, "/")
          );
          if (!childAnalysis) continue;
          
          if (isAsyncDataFetchingComponent(childAnalysis)) {
            const names = [];
            if (imp.defaultImport) names.push(imp.defaultImport);
            for (const named of imp.namedImports || []) {
              names.push(named);
            }
            if (names.length > 0) {
              fileImportsAsyncFetch.push({ names, childPath: childAnalysis.filePath });
            }
          }
        }

        if (fileImportsAsyncFetch.length > 0) {
          let parentContent = "";
          try {
            parentContent = readFileSync(filePath, "utf-8");
          } catch {}
          
          if (parentContent) {
            const project = new Project();
            const sourceFile = project.createSourceFile("_temp_ro005.tsx", parentContent);
            
            for (const item of fileImportsAsyncFetch) {
              for (const name of item.names) {
                const selfClosing = sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
                  .filter(el => el.getTagNameNode().getText() === name);
                const opening = sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
                  .filter(el => el.getTagNameNode().getText() === name);
                
                const elements = [...selfClosing, ...opening];
                for (const el of elements) {
                  let node = el.getParent();
                  let wrappedInSuspense = false;
                  while (node) {
                    const kind = node.getKind();
                    if (kind === SyntaxKind.JsxElement) {
                      const op = node.asKind(SyntaxKind.JsxElement)?.getOpeningElement();
                      const tag = op?.getTagNameNode().getText();
                      if (tag === "Suspense" || tag === "React.Suspense") {
                        wrappedInSuspense = true;
                        break;
                      }
                    }
                    node = node.getParent();
                  }
                  
                  if (!wrappedInSuspense) {
                    const line = el.getStartLineNumber();
                    const childName = path.basename(item.childPath);
                    diagnostics.push({
                      file: filePath,
                      line,
                      severity: "info",
                      ruleId: this.id,
                      id: "RO-005",
                      message: `Async child component '<${name} />' (from '${childName}') performs data fetches or database queries but is rendered without a wrapping Suspense boundary. This blocks the entire page rendering waterfall. Wrap it in <Suspense fallback={<Loading />}>.`,
                      whyItMatters: "When an async server component is rendered without a Suspense boundary, React must block rendering the parent component until the child's promise resolves, creating a sequential loading waterfall.",
                      quickFixes: [
                        `Wrap <${name} /> inside a <Suspense fallback={<Skeleton />}> boundary.`
                      ],
                      architectureSuggestions: [
                        "Use Suspense to enable streaming HTML and allow parts of the page to load independently."
                      ],
                      optimizationGuidance: [],
                      productionRisks: [
                        "Sequential server-side rendering waterfalls and increased TTFB."
                      ]
                    });
                  }
                }
              }
            }
          }
        }
      }
    }

    // ── CA-007: Over-invalidation — revalidatePath("/") after single-entity mutation
    for (const analysis of context.analyses) {
      if (!analysis.hasTopLevelUseServer && !analysis.filePath.includes("actions")) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("revalidatePath")) continue;

      const project = new Project();
      const sourceFile = project.createSourceFile("_temp_ca007.ts", content);
      const functions = [
        ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
        ...sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ];

      for (const func of functions) {
        const bodyText = func.getBody()?.getText() ?? "";

        // Detect broad revalidatePath patterns — root "/" or high-traffic paths
        const broadRevalidate = /revalidatePath\(\s*['"`]\/['"`]\s*\)/.test(bodyText) ||
                                /revalidatePath\(\s*['"`]\/[a-z-]+['"`]\s*\)/.test(bodyText);

        // Detect single-entity mutation signals
        const singleEntityMutation =
          /\bwhere\s*:\s*\{[^}]*\bid\b/.test(bodyText) ||        // ORM: where: { id: ... }
          /\/(posts|users|products|items|orders)\/\$?\{/.test(bodyText) || // URL: /users/${id}
          /\bfetch\([^)]*\/\d+['"`]/.test(bodyText) ||           // fetch(".../{id}")
          /\b(update|patch|delete)\w*\(/.test(bodyText);          // update/delete call

        if (broadRevalidate && singleEntityMutation) {
          const line = func.getStartLineNumber();
          diagnostics.push({
            file: analysis.filePath,
            line,
            severity: "warning",
            ruleId: this.id,
            id: "CA-007",
            message: `Broad cache invalidation detected: revalidatePath("/") invalidates the entire route cache tree after what appears to be a single-entity mutation. This is unnecessarily expensive at scale. Prefer surgical invalidation with revalidateTag("entity-${"{id}"}") targeting only the affected cache entries.`,
            whyItMatters: "revalidatePath('/') purges every cached route in the application, triggering full re-renders of all pages on next visit. For a single record update, this wastes server compute proportional to your entire page count.",
            quickFixes: [
              "Replace revalidatePath('/') with revalidateTag('entity-type') using a tag applied to the specific data source.",
              "Apply cache tags when fetching: fetch(url, { next: { tags: ['user-123'] } })",
              "Then invalidate surgically: revalidateTag('user-123')",
            ],
            architectureSuggestions: [
              "Adopt entity-scoped cache tags as a team convention: every data function tags its results with the entity type + ID.",
              "Design mutation flows as: mutate → revalidateTag(entity-tag) → redirect()",
            ],
            optimizationGuidance: [
              "revalidateTag() is O(1) — it marks one cache entry stale.",
              "revalidatePath('/') is O(all routes) — it rebuilds the entire cache tree.",
            ],
            productionRisks: [
              "Cache stampede: all routes become uncached simultaneously under high traffic",
              "Increased server load proportional to site complexity after every mutation",
            ],
          });
        }
      }
    }

    // ── RV-003: Dynamic revalidatePath Missing Type Parameter ────────────────
    for (const analysis of context.analyses) {
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("revalidatePath")) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_rv003.ts", content);
        const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

        for (const call of calls) {
          if (call.getExpression().getText() === "revalidatePath") {
            const args = call.getArguments();
            if (args.length > 0) {
              const firstArg = args[0];
              const isStaticLiteral = firstArg.isKind(SyntaxKind.StringLiteral) || firstArg.isKind(SyntaxKind.NoSubstitutionTemplateLiteral);
              const firstArgText = firstArg.getText();
              const isDynamic = !isStaticLiteral || firstArgText.includes("[") || firstArgText.includes("]");
              if (isDynamic) {
                const hasSecondArg = args.length >= 2;
                const secondArgText = hasSecondArg ? args[1].getText().replace(/['"`]/g, "").trim() : "";
                if (secondArgText !== "page" && secondArgText !== "layout") {
                  const line = call.getStartLineNumber();
                  diagnostics.push({
                    file: analysis.filePath,
                    line,
                    severity: "warning",
                    ruleId: this.id,
                    id: "RV-003",
                    message: `Dynamic revalidatePath Missing Type Parameter: revalidatePath() is called on a dynamic route segment '${firstArgText}' without specifying the type argument ('page' or 'layout').`,
                    whyItMatters: "Next.js treats single-argument revalidatePath() calls as literal string paths. When invalidating dynamic routes (e.g. /blog/[slug]), you must provide the second 'type' argument ('page' or 'layout') or the cache will fail to clear.",
                    quickFixes: [
                      "Add the 'page' or 'layout' string literal as the second argument: revalidatePath('/blog/[slug]', 'page')"
                    ],
                    architectureSuggestions: [
                      "Always provide the second 'type' parameter to revalidatePath when targeting dynamic routes to ensure proper cache invalidation."
                    ],
                    optimizationGuidance: [],
                    productionRisks: [
                      "Stale dynamic routes served indefinitely to users after mutations."
                    ]
                  });
                }
              }
            }
          }
        }
      } catch (e) {
        // ignore parsing errors
      }
    }

    return diagnostics;
  },
};
