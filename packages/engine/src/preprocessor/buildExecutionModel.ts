import fs from "node:fs";
import path from "node:path";
import type { FileAnalysis } from "../analyzer/types.js";
import type { FrameworkExecutionModel } from "./types.js";
import type { SourceFile } from "ts-morph";

function isNonSerializable(expr: any): boolean {
  if (!expr) return false;
  const kind = expr.getKindName();
  if (
    kind === "ArrowFunction" ||
    kind === "FunctionExpression" ||
    kind === "ClassExpression" ||
    kind === "ClassDeclaration" ||
    kind === "FunctionDeclaration"
  ) {
    return true;
  }
  if (kind === "Identifier") {
    try {
      const type = expr.getType();
      if (type) {
        if (type.getCallSignatures().length > 0 || type.isClass()) {
          return true;
        }
      }
    } catch {
      // ignore type checking errors
    }
    try {
      const symbol = expr.getSymbol();
      if (symbol) {
        const decls = symbol.getDeclarations();
        for (const decl of decls) {
          const declKind = decl.getKindName();
          if (
            declKind === "FunctionDeclaration" ||
            declKind === "ClassDeclaration" ||
            declKind === "ArrowFunction" ||
            declKind === "FunctionExpression" ||
            declKind === "MethodDeclaration"
          ) {
            return true;
          }
          if (declKind === "VariableDeclaration") {
            const init = (decl as any).getInitializer();
            if (init) {
              const initKind = init.getKindName();
              if (
                initKind === "ArrowFunction" ||
                initKind === "FunctionExpression" ||
                initKind === "ClassExpression"
              ) {
                return true;
              }
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return false;
}

function isThirdParty(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("react") ||
    specifier.startsWith("next")
  ) {
    return false;
  }
  return true;
}

// Node.js specific libraries that are incompatible with the Edge runtime
const EDGE_INCOMPATIBLE_IMPORTS = [
  "fs",
  "node:fs",
  "path",
  "node:path",
  "child_process",
  "node:child_process",
  "os",
  "node:os",
  "cluster",
  "node:cluster",
  "dgram",
  "node:dgram",
  "dns",
  "node:dns",
  "http2",
  "node:http2",
  "net",
  "node:net",
  "readline",
  "node:readline",
  "repl",
  "node:repl",
  "tls",
  "node:tls",
  "v8",
  "node:v8",
  "vm",
  "node:vm",
  "worker_threads",
  "node:worker_threads"
];

export function buildExecutionModel(
  analysis: FileAnalysis,
  sourceFile?: SourceFile
): FrameworkExecutionModel {
  const filePath = analysis.filePath;
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath, ext);
  const normalizedPath = filePath.replace(/\\/g, "/");

  // Load file content for deep AST/text-based checks if it exists
  let content = "";
  if (fs.existsSync(filePath)) {
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      // ignore
    }
  }

  // 1. DIRECTIVE DETECTION
  let hasUseClient = analysis.isClientComponent;
  let hasUseServer = analysis.hasTopLevelUseServer;
  let hasInlineUseServer = false;

  if (sourceFile) {
    // Check top-level statements for "use client" or "use server"
    const statements = sourceFile.getStatements();
    for (const statement of statements) {
      if (statement.getKindName() === "ExpressionStatement") {
        const expr = (statement as any).getExpression();
        if (expr && expr.getKindName() === "StringLiteral") {
          const text = expr.getLiteralText();
          if (text === "use client") {
            hasUseClient = true;
          } else if (text === "use server") {
            hasUseServer = true;
          }
        }
      }
    }

    // Check inline "use server" inside any functions/methods
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "ExpressionStatement") {
        const expr = (node as any).getExpression();
        if (expr && expr.getKindName() === "StringLiteral" && expr.getLiteralText() === "use server") {
          const isTopLevel = node.getParent() === sourceFile;
          if (!isTopLevel) {
            hasInlineUseServer = true;
          }
        }
      }
    });
  }

  const usesServerActions = hasUseServer || hasInlineUseServer;

  // 2. EXPORTS / CONFIGURATIONS DETECT
  let segmentRuntime: string | null = null;
  let segmentDynamic: string | null = null;
  let segmentRevalidate: number | null = null;

  if (content) {
    const runtimeMatch = content.match(/export\s+const\s+runtime\s*=\s*['"](edge|nodejs)['"]/);
    if (runtimeMatch && runtimeMatch[1]) {
      segmentRuntime = runtimeMatch[1];
    }

    const dynamicMatch = content.match(/export\s+const\s+dynamic\s*=\s*['"](force-static|force-dynamic|error|auto)['"]/);
    if (dynamicMatch && dynamicMatch[1]) {
      segmentDynamic = dynamicMatch[1];
    }

    const revalMatch = content.match(/export\s+const\s+revalidate\s*=\s*(\d+|false)/);
    if (revalMatch && revalMatch[1]) {
      if (revalMatch[1] !== "false") {
        segmentRevalidate = Number(revalMatch[1]);
      }
    }
  }

  const isPageOrLayout = ["page", "layout"].includes(basename);
  const isMiddleware = basename === "middleware";
  const isRouteHandler = basename === "route";

  // 3. APIS & HOOKS CLASSIFICATION
  const usesServerApis: string[] = [];
  const usesBrowserApis: string[] = [];
  const usesClientHooks: string[] = [];
  const usesNextRuntimeAPIs: string[] = [];

  // Identify server APIs via imports and direct usage
  const serverApiModules = ["next/headers", "next/cache", "server-only", "next-auth", "@prisma/client", "drizzle-orm"];
  const serverApiNamedExports = new Set(["cookies", "headers", "draftMode", "unstable_noStore", "revalidatePath", "revalidateTag"]);
  const requestContextExports = new Set(["cookies", "headers", "draftMode", "unstable_noStore"]);

  analysis.importDetails.forEach((imp) => {
    if (serverApiModules.some((mod) => imp.moduleSpecifier.includes(mod))) {
      usesServerApis.push(imp.moduleSpecifier);
    }
    if (imp.moduleSpecifier.startsWith("next/")) {
      usesNextRuntimeAPIs.push(imp.moduleSpecifier);
    }
  });

  // Check imports of request-scoped and server-only named exports
  analysis.importDetails.forEach((imp) => {
    imp.namedImports.forEach((named) => {
      if (serverApiNamedExports.has(named) || requestContextExports.has(named)) {
        usesServerApis.push(`${named}()`);
      }
      if (["redirect", "notFound", "useRouter", "usePathname", "useSearchParams"].includes(named)) {
        usesNextRuntimeAPIs.push(named);
      }
    });
  });

  // AST Check for usage of server APIs
  const serverApiCallNames = new Set(["cookies", "headers", "draftMode", "unstable_noStore", "revalidatePath", "revalidateTag"]);
  if (sourceFile) {
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "CallExpression") {
        const expr = (node as any).getExpression();
        const name = expr.getText();
        if (serverApiCallNames.has(name)) {
          const apiCall = `${name}()`;
          if (!usesServerApis.includes(apiCall)) {
            usesServerApis.push(apiCall);
          }
        }
      }
    });
  }

  // Identify Browser APIs from analysis
  analysis.browserAPIs.forEach((apiUsage) => {
    usesBrowserApis.push(apiUsage.api);
  });

  // AST Check for Browser APIs with transitive aliases & shadowed scopes
  if (sourceFile) {
    const browserGlobals = ["window", "document", "localStorage", "sessionStorage", "navigator", "location", "history", "indexedDB", "screen", "alert", "confirm", "prompt"];
    const aliases = new Set<string>();

    // First pass: find variables initialized to browser globals or existing aliases
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "VariableDeclaration") {
        const name = (node as any).getName();
        const init = (node as any).getInitializer();
        if (init) {
          const initText = init.getText().trim();
          if (browserGlobals.includes(initText) || aliases.has(initText)) {
            aliases.add(name);
          }
        }
      }
    });

    // Second pass: find references to browser globals or aliases
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "Identifier") {
        const name = node.getText();
        if (browserGlobals.includes(name) || aliases.has(name)) {
          // Verify it is not shadowed in the local scope
          let isShadowed = false;
          try {
            const symbol = node.getSymbol();
            if (symbol) {
              const decls = symbol.getDeclarations();
              isShadowed = decls.some(decl => decl.getSourceFile() === sourceFile && decl !== node.getParent());
            }
          } catch {
            // ignore
          }

          if (!isShadowed || aliases.has(name)) {
            let originalApi = name;
            if (aliases.has(name)) {
              originalApi = `window (alias: ${name})`;
            }
            if (!usesBrowserApis.includes(originalApi)) {
              usesBrowserApis.push(originalApi);
            }
          }
        }
      }
    });
  }

  // Identify Client Hooks from analysis
  analysis.hookDetails.forEach((hook) => {
    usesClientHooks.push(hook.name);
  });

  // AST Check for Client Hooks and Custom Hooks
  if (sourceFile) {
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "CallExpression") {
        const expr = (node as any).getExpression();
        const name = expr.getText();
        if (/^use[A-Z]/.test(name) || ["useState", "useEffect", "useMemo", "useLayoutEffect", "useContext", "useReducer", "useCallback", "useRef", "useImperativeHandle", "useDebugValue", "useDeferredValue", "useTransition", "useId", "useSyncExternalStore", "useInsertionEffect"].includes(name)) {
          if (!usesClientHooks.includes(name)) {
            usesClientHooks.push(name);
          }
        }
      }
    });
  }

  // 4. COMPONENT TYPE INFERENCE
  let componentType: "server" | "client" | "mixed" | "unknown" = "unknown";
  if (hasUseClient && hasUseServer) {
    componentType = "mixed";
  } else if (hasUseClient) {
    componentType = "client";
  } else if (hasUseServer) {
    componentType = "server"; // Server Actions file context
  } else if (isPageOrLayout && analysis.hasAsyncComponent) {
    componentType = "server";
  } else if (analysis.isClientComponent) {
    componentType = "client";
  } else if (analysis.isServerComponent) {
    componentType = "server";
  } else {
    componentType = "unknown";
  }

  // Detect Context usage (createContext or useContext)
  let usesContext = false;
  if (sourceFile) {
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "Identifier") {
        const text = node.getText();
        if (text === "createContext" || text === "useContext") {
          usesContext = true;
          if (text === "useContext" && !usesClientHooks.includes("useContext")) {
            usesClientHooks.push("useContext");
          }
          if (text === "createContext" && !usesClientHooks.includes("createContext")) {
            usesClientHooks.push("createContext");
          }
        }
      }
    });
  }

  // 5. RUNTIME INFERENCE
  let runtime: "node" | "edge" | "browser" | "mixed" | "invalid" = "node";

  // Identify Edge Incompatible Imports
  const edgeIncompatibleUsed = analysis.imports.filter((imp) => 
    EDGE_INCOMPATIBLE_IMPORTS.some((bad) => imp === bad || imp.startsWith(`${bad}/`))
  );

  if (componentType === "client") {
    runtime = usesBrowserApis.length > 0 ? "browser" : "mixed";
    
    if (usesServerApis.some(api => api.includes("next/headers") || api.includes("cookies") || api.includes("headers") || api.includes("server-only") || api.includes("draftMode") || api.includes("unstable_noStore"))) {
      runtime = "invalid";
    }
  } else {
    if (segmentRuntime === "edge" || isMiddleware) {
      runtime = "edge";
    } else {
      runtime = "node";
    }

    if (usesBrowserApis.length > 0) {
      runtime = "invalid";
    }

    if (runtime === "edge" && edgeIncompatibleUsed.length > 0) {
      runtime = "invalid";
    }
  }

  // 6. RENDERING MODE INFERENCE
  let renderingMode: "static" | "dynamic" | "streaming" | "unknown" = "static";
  const hasDynamicTriggers = 
    usesServerApis.some((api) => api.includes("cookies") || api.includes("headers") || api.includes("unstable_noStore") || api.includes("draftMode")) ||
    segmentDynamic === "force-dynamic" ||
    (content && (content.includes("searchParams") && (isPageOrLayout || isRouteHandler)));

  const hasSuspense = content && (content.includes("<Suspense") || content.includes("Suspense"));

  if (segmentDynamic === "force-static" && hasDynamicTriggers) {
    renderingMode = "unknown"; // Caching contradiction
  } else if (hasDynamicTriggers) {
    renderingMode = "dynamic";
  } else if (hasSuspense) {
    renderingMode = "streaming";
  } else {
    renderingMode = "static";
  }

  // 7. HYDRATION RISK LEVEL
  let hydrationRiskLevel: "low" | "medium" | "high" | "critical" = "low";
  const nonDeterministicInRender: string[] = [];
  const browserGlobalsInRender: string[] = [];

  if (content && componentType === "client") {
    const lines = content.split("\n");
    let insideSafeScope = false;
    let braceCount = 0;

    lines.forEach((lineText) => {
      if (/useEffect\s*\(|useLayoutEffect\s*\(/.test(lineText)) {
        insideSafeScope = true;
        braceCount = (lineText.match(/\{/g) || []).length - (lineText.match(/\}/g) || []).length;
      } else if (insideSafeScope) {
        braceCount += (lineText.match(/\{/g) || []).length - (lineText.match(/\}/g) || []).length;
        if (braceCount <= 0) {
          insideSafeScope = false;
        }
      }

      const insideHandler = /onClick|onChange|onSubmit|onKeyDown|onKeyUp|onFocus|onBlur/.test(lineText);
      const isDeferred = insideSafeScope || insideHandler;

      if (!isDeferred) {
        if (lineText.includes("Math.random(")) {
          nonDeterministicInRender.push("Math.random()");
        }
        if (lineText.includes("Date.now(") || lineText.includes("new Date(")) {
          nonDeterministicInRender.push("Date.now() / new Date()");
        }
        if (/\b(window|document|localStorage|sessionStorage|navigator)\b/.test(lineText)) {
          if (!lineText.includes("typeof window") && !lineText.includes("typeof document")) {
            const apiMatch = lineText.match(/\b(window|document|localStorage|sessionStorage|navigator)\b/)?.[0] || "window";
            browserGlobalsInRender.push(apiMatch);
          }
        }
      }
    });

    if (browserGlobalsInRender.length > 0) {
      hydrationRiskLevel = "critical";
    } else if (nonDeterministicInRender.length > 0) {
      hydrationRiskLevel = "high";
    } else if (usesBrowserApis.length > 0 || usesClientHooks.length > 0) {
      hydrationRiskLevel = "medium";
    }
  }

  // 8. FETCH STRATEGY & CACHE CONFLICTS
  const fetchStrategy = {
    hasFetch: analysis.fetchCalls.length > 0,
    cacheMode: null as string | null,
    revalidate: null as number | null,
    conflicts: [] as string[]
  };

  if (fetchStrategy.hasFetch) {
    const cacheModes = analysis.fetchCalls.map(f => f.cacheValue).filter(Boolean) as string[];
    const revalidateVals = analysis.fetchCalls.map(f => f.revalidateValue).filter((v) => v !== null && v !== undefined);

    if (cacheModes.length > 0) {
      fetchStrategy.cacheMode = cacheModes[0] ?? null;
    }
    if (revalidateVals.length > 0) {
      const firstVal = revalidateVals[0];
      if (firstVal !== undefined) {
        if (typeof firstVal === "number") {
          fetchStrategy.revalidate = firstVal;
        } else if (typeof firstVal === "string") {
          const parsed = parseInt(firstVal, 10);
          if (!isNaN(parsed)) {
            fetchStrategy.revalidate = parsed;
          }
        }
      }
    }

    analysis.fetchCalls.forEach((f) => {
      if (f.cacheValue === "no-store" && f.revalidateValue !== null && f.revalidateValue !== undefined && Number(f.revalidateValue) > 0) {
        fetchStrategy.conflicts.push("cache: 'no-store' contradicts with revalidate > 0");
      }
      if (f.cacheValue === "force-cache" && f.revalidateValue === 0) {
        fetchStrategy.conflicts.push("cache: 'force-cache' contradicts with revalidate: 0");
      }
    });

    const uniqueCacheModes = new Set(cacheModes);
    if (uniqueCacheModes.size > 1) {
      fetchStrategy.conflicts.push("Inconsistent fetch options: multiple cache modes used in same file");
    }

    analysis.fetchCalls.forEach((f) => {
      if (f.isDynamic && !f.hasCacheConfig && !f.hasRevalidate) {
        fetchStrategy.conflicts.push("Missing caching strategy on dynamic fetch");
      }
    });
  }

  // 9. BOUNDARY VIOLATIONS
  const boundaryViolations: string[] = [];
  const architectureFlags: string[] = [];

  if (componentType === "client") {
    if (usesServerApis.some(api => api.includes("next/headers") || api.includes("cookies") || api.includes("headers") || api.includes("server-only") || api.includes("draftMode") || api.includes("unstable_noStore"))) {
      boundaryViolations.push("server APIs in client");
    }
  }

  if (componentType === "server") {
    if (usesClientHooks.length > 0) {
      boundaryViolations.push("hooks in server");
    }
    if (usesContext) {
      boundaryViolations.push("hooks in server");
    }
  }

  if (componentType === "mixed") {
    boundaryViolations.push("Mixed client component and server actions responsibility in one boundary");
  }

  if (componentType === "client" && analysis.hasAsyncComponent) {
    boundaryViolations.push("async client component");
  }

  // Event Handlers inside Server Components (JSX elements with attributes starting with "on" in a "server" component)
  if (componentType === "server" && sourceFile) {
    let hasEventHandlers = false;
    sourceFile.forEachDescendant((node) => {
      if (node.getKindName() === "JsxAttribute") {
        const name = (node as any).getNameNode().getText();
        if (typeof name === "string" && name.startsWith("on")) {
          hasEventHandlers = true;
          if (!usesClientHooks.includes(name)) {
            usesClientHooks.push(name);
          }
        }
      }
    });
    if (hasEventHandlers) {
      boundaryViolations.push("event handler in server component");
    }
  }

  // Serialization Checks (Non-serializable props passed to Client Components from Server Components)
  if (componentType === "server" && sourceFile) {
    let hasNonSerializable = false;
    sourceFile.forEachDescendant((node) => {
      const kind = node.getKindName();
      if (kind === "JsxOpeningElement" || kind === "JsxSelfClosingElement") {
        const tagNameNode = (node as any).getTagNameNode();
        if (tagNameNode) {
          const tagName = tagNameNode.getText();
          if (tagName && tagName[0] === tagName[0].toUpperCase()) {
            const attributes = (node as any).getAttributes();
            for (const attr of attributes) {
              if (attr.getKindName() === "JsxAttribute") {
                const init = attr.getInitializer();
                if (init && init.getKindName() === "JsxExpression") {
                  const expr = init.getExpression();
                  if (expr && isNonSerializable(expr)) {
                    hasNonSerializable = true;
                  }
                }
              }
            }
          }
        }
      }
    });
    if (hasNonSerializable) {
      boundaryViolations.push("non-serializable prop passed to client component");
    }
  }

  // Third-Party Components (used directly in Server Components)
  if (componentType === "server" && sourceFile) {
    let hasThirdPartyComponent = false;
    sourceFile.forEachDescendant((node) => {
      const kind = node.getKindName();
      if (kind === "JsxOpeningElement" || kind === "JsxSelfClosingElement") {
        const tagNameNode = (node as any).getTagNameNode();
        if (tagNameNode) {
          const tagName = tagNameNode.getText();
          if (tagName && tagName[0] === tagName[0].toUpperCase()) {
            let baseTagName = tagName;
            if (tagName.includes(".")) {
              baseTagName = tagName.split(".")[0];
            }
            const imp = analysis.importDetails.find(i => 
              i.namedImports.includes(baseTagName) || 
              i.defaultImport === baseTagName || 
              i.namespaceImport === baseTagName
            );
            if (imp && isThirdParty(imp.moduleSpecifier)) {
              hasThirdPartyComponent = true;
            }
          }
        }
      }
    });
    if (hasThirdPartyComponent) {
      boundaryViolations.push("third-party component used directly in server component");
      if (!architectureFlags.includes("uses-third-party-components")) {
        architectureFlags.push("uses-third-party-components");
      }
    }
  }

  // 10. OVER-HYDRATION RISK
  let overHydrationRisk: "low" | "medium" | "high" = "low";
  if (componentType === "client" && content) {
    const jsxTags = (content.match(/<[a-zA-Z]/g) || []).length;
    
    const hasHeavyServerLib = analysis.imports.some(imp => 
      imp.includes("@prisma") || 
      imp.includes("mongoose") || 
      imp.includes("pg") || 
      imp.includes("mysql2") || 
      imp.includes("sqlite3")
    );

    if (jsxTags > 40 || hasHeavyServerLib) {
      overHydrationRisk = "high";
    } else if (jsxTags > 20) {
      overHydrationRisk = "medium";
    }
  }

  // 11. RENDER STABILITY
  const renderStability = {
    deterministic: nonDeterministicInRender.length === 0 && browserGlobalsInRender.length === 0,
    instabilitySources: [...nonDeterministicInRender, ...browserGlobalsInRender.map(g => `Unguarded browser global: ${g}`)]
  };

  // 12. ARCHITECTURE FLAGS
  if (segmentDynamic) {
    architectureFlags.push(`dynamic-${segmentDynamic}`);
  }
  if (segmentRevalidate !== null) {
    architectureFlags.push(`revalidate-${segmentRevalidate}`);
  }
  if (content && content.includes("generateStaticParams")) {
    architectureFlags.push("has-static-params");
  }
  if (isMiddleware) {
    architectureFlags.push("middleware");
  }
  if (isRouteHandler) {
    architectureFlags.push("route-handler");
  }
  if (usesServerActions) {
    architectureFlags.push("server-action-context");
  }
  if (hasSuspense) {
    architectureFlags.push("suspense-boundaries");
  }
  if (usesServerApis.length > 0) {
    architectureFlags.push("uses-server-apis");
  }
  if (usesBrowserApis.length > 0) {
    architectureFlags.push("uses-browser-apis");
  }
  if (usesClientHooks.length > 0) {
    architectureFlags.push("uses-client-hooks");
  }

  return {
    componentType,
    isAsyncComponent: analysis.hasAsyncComponent,
    isAsync: analysis.hasAsyncComponent,
    usesServerActions,
    runtime,
    renderingMode,
    hydrationRiskLevel,
    usesServerApis,
    usesBrowserApis,
    usesClientHooks,
    usesNextRuntimeAPIs,
    fetchStrategy,
    boundaryViolations,
    renderStability,
    overHydrationRisk,
    architectureFlags
  };
}
