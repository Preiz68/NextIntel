"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ALL_BUILT_IN_HOOKS: () => ALL_BUILT_IN_HOOKS,
  BROWSER_APIS: () => BROWSER_APIS,
  BROWSER_GLOBALS: () => BROWSER_GLOBALS,
  EXCLUDED_DIRS: () => EXCLUDED_DIRS,
  NEXT_BUILT_IN_HOOKS: () => NEXT_BUILT_IN_HOOKS,
  REACT_BUILT_IN_HOOKS: () => REACT_BUILT_IN_HOOKS,
  ROOT_CONFIG_FILES: () => ROOT_CONFIG_FILES,
  SCAN_TARGETS: () => SCAN_TARGETS,
  SOURCE_EXTENSIONS: () => SOURCE_EXTENSIONS,
  analyzeFile: () => analyzeFile,
  analyzeFiles: () => analyzeFiles,
  bfs: () => bfs,
  buildGraph: () => buildGraph,
  detectCycles: () => detectCycles,
  dfs: () => dfs,
  findPath: () => findPath,
  getCyclicNodes: () => getCyclicNodes,
  getDependencies: () => getDependencies,
  getDependents: () => getDependents,
  getEntryPoints: () => getEntryPoints,
  getMostImported: () => getMostImported,
  getSinks: () => getSinks,
  isInsideDir: () => isInsideDir,
  normalizePath: () => normalizePath,
  resetProject: () => resetProject,
  scanProject: () => scanProject,
  summarizeGraph: () => summarizeGraph,
  toAsciiTree: () => toAsciiTree,
  toRelativePath: () => toRelativePath
});
module.exports = __toCommonJS(index_exports);

// src/scanner/scanProject.ts
var import_fast_glob = __toESM(require("fast-glob"), 1);
var import_node_fs = __toESM(require("fs"), 1);
var import_node_path2 = __toESM(require("path"), 1);

// src/scanner/constants.ts
var SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts"
];
var EXCLUDED_DIRS = [
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "build"
];
var SCAN_TARGETS = [
  "app",
  "pages",
  "components",
  "src",
  "lib",
  "hooks",
  "utils",
  "types",
  "styles",
  "config",
  "middleware"
];
var ROOT_CONFIG_FILES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "middleware.ts",
  "middleware.js",
  "instrumentation.ts",
  "instrumentation.js"
];

// src/scanner/normalizePath.ts
var import_node_path = __toESM(require("path"), 1);
function normalizePath(input, cwd = process.cwd()) {
  const absolute = import_node_path.default.isAbsolute(input) ? import_node_path.default.normalize(input) : import_node_path.default.resolve(cwd, input);
  return absolute.split(import_node_path.default.sep).join("/");
}
function toRelativePath(filePath, root) {
  const normalFile = normalizePath(filePath);
  const normalRoot = normalizePath(root).replace(/\/?$/, "/");
  if (!normalFile.startsWith(normalRoot)) {
    return normalFile;
  }
  const relative = normalFile.slice(normalRoot.length);
  return `./${relative}`;
}
function isInsideDir(filePath, dir) {
  const normalFile = normalizePath(filePath);
  const normalDir = normalizePath(dir).replace(/\/?$/, "/");
  return normalFile.startsWith(normalDir);
}

// src/scanner/scanProject.ts
function buildIgnorePatterns(extra = []) {
  const dirs = [...EXCLUDED_DIRS, ...extra];
  return dirs.flatMap((d) => [`**/${d}`, `**/${d}/**`]);
}
function resolveTargetDirs(root, extra, scanRootFallback) {
  const targets = [...SCAN_TARGETS, ...extra];
  const existing = [];
  const missing = [];
  for (const t of targets) {
    const abs = import_node_path2.default.join(root, t);
    if (import_node_fs.default.existsSync(abs) && import_node_fs.default.statSync(abs).isDirectory()) {
      existing.push(abs);
    } else {
      missing.push(t);
    }
  }
  if (scanRootFallback && existing.length === 0) {
    existing.push(root);
  }
  return { existing, missing };
}
function buildStats(files, root, scannedRoots, missingTargets, durationMs) {
  const byDirectory = {};
  const byExtension = {};
  for (const f of files) {
    const rel = toRelativePath(f, root);
    const segment = rel.split("/")[1] ?? "(root)";
    byDirectory[segment] = (byDirectory[segment] ?? 0) + 1;
    const ext = import_node_path2.default.extname(f).replace(".", "") || "(no-ext)";
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
  }
  return {
    totalFiles: files.length,
    byDirectory,
    byExtension,
    scannedRoots,
    missingTargets,
    durationMs
  };
}
async function scanProject(root, options = {}) {
  const {
    additionalTargets = [],
    additionalExcludes = [],
    scanRootFallback = false,
    includeDotFiles = false,
    maxDepth = 0
  } = options;
  const t0 = Date.now();
  const normalRoot = normalizePath(root);
  if (!import_node_fs.default.existsSync(normalRoot)) {
    throw new Error(
      `[scanProject] Root directory does not exist: ${normalRoot}`
    );
  }
  if (!import_node_fs.default.statSync(normalRoot).isDirectory()) {
    throw new Error(
      `[scanProject] Root path is not a directory: ${normalRoot}`
    );
  }
  const { existing: scannedRoots, missing: missingTargets } = resolveTargetDirs(
    normalRoot,
    additionalTargets,
    scanRootFallback
  );
  const extPattern = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;
  const ignoreGlobs = buildIgnorePatterns(additionalExcludes);
  const fgOptions = {
    cwd: normalRoot,
    absolute: true,
    // return absolute paths
    onlyFiles: true,
    dot: includeDotFiles,
    ignore: ignoreGlobs,
    ...maxDepth > 0 ? { deep: maxDepth } : {},
    // Ensures consistent cross-platform results.
    followSymbolicLinks: false
  };
  const globPatterns = scannedRoots.map(
    (dir) => `${normalizePath(dir)}/${extPattern}`
  );
  const configPatterns = ROOT_CONFIG_FILES.map((f) => `${normalRoot}/${f}`);
  const [sourceFiles, configFiles] = await Promise.all([
    scannedRoots.length > 0 ? (0, import_fast_glob.default)(globPatterns, fgOptions) : Promise.resolve([]),
    (0, import_fast_glob.default)(configPatterns, { absolute: true, onlyFiles: true })
  ]);
  const seen = /* @__PURE__ */ new Set();
  const files = [];
  for (const raw of [...sourceFiles, ...configFiles]) {
    const norm = normalizePath(raw);
    if (!seen.has(norm)) {
      seen.add(norm);
      files.push(norm);
    }
  }
  files.sort();
  const durationMs = Date.now() - t0;
  const stats = buildStats(
    files,
    normalRoot,
    scannedRoots.map((r) => normalizePath(r)),
    missingTargets,
    durationMs
  );
  return { files, stats };
}

// src/analyzer/analyzeFile.ts
var import_ts_morph5 = require("ts-morph");
var import_node_path3 = __toESM(require("path"), 1);
var import_node_fs2 = __toESM(require("fs"), 1);

// src/analyzer/extractImports.ts
function extractImports(sourceFile) {
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
      isTypeOnly
    };
  });
}

// src/analyzer/extractExports.ts
var import_ts_morph = require("ts-morph");
function getKind(declarations) {
  const first = declarations[0];
  if (!first) return "unknown";
  if (first.isKind(import_ts_morph.SyntaxKind.FunctionDeclaration) || first.isKind(import_ts_morph.SyntaxKind.FunctionExpression) || first.isKind(import_ts_morph.SyntaxKind.ArrowFunction))
    return "function";
  if (first.isKind(import_ts_morph.SyntaxKind.ClassDeclaration) || first.isKind(import_ts_morph.SyntaxKind.ClassExpression))
    return "class";
  if (first.isKind(import_ts_morph.SyntaxKind.VariableDeclaration)) return "variable";
  if (first.isKind(import_ts_morph.SyntaxKind.TypeAliasDeclaration)) return "type";
  if (first.isKind(import_ts_morph.SyntaxKind.InterfaceDeclaration)) return "interface";
  if (first.isKind(import_ts_morph.SyntaxKind.EnumDeclaration)) return "enum";
  return "unknown";
}
function extractExports(sourceFile) {
  const results = [];
  const exportMap = sourceFile.getExportedDeclarations();
  for (const [name, declarations] of exportMap.entries()) {
    const isDefault = name === "default";
    const isTypeOnly = sourceFile.getExportDeclarations().some(
      (ed) => ed.isTypeOnly() && ed.getNamedExports().some((ne) => ne.getName() === name)
    );
    results.push({
      name,
      isDefault,
      isTypeOnly,
      kind: getKind(declarations)
    });
  }
  return results;
}

// src/analyzer/extractHooks.ts
var import_ts_morph2 = require("ts-morph");

// src/analyzer/constants.ts
var REACT_BUILT_IN_HOOKS = /* @__PURE__ */ new Set([
  "useState",
  "useEffect",
  "useContext",
  "useReducer",
  "useCallback",
  "useMemo",
  "useRef",
  "useImperativeHandle",
  "useLayoutEffect",
  "useDebugValue",
  "useDeferredValue",
  "useTransition",
  "useId",
  "useSyncExternalStore",
  "useInsertionEffect",
  "useOptimistic",
  "useFormStatus",
  "useFormState",
  "useActionState"
]);
var NEXT_BUILT_IN_HOOKS = /* @__PURE__ */ new Set([
  "useRouter",
  "usePathname",
  "useSearchParams",
  "useParams",
  "useSelectedLayoutSegment",
  "useSelectedLayoutSegments",
  "useServerInsertedHTML"
]);
var ALL_BUILT_IN_HOOKS = /* @__PURE__ */ new Set([
  ...REACT_BUILT_IN_HOOKS,
  ...NEXT_BUILT_IN_HOOKS
]);
var BROWSER_APIS = [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "crypto",
  "performance",
  "screen",
  "alert",
  "confirm",
  "prompt",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "ServiceWorker",
  "Notification",
  "IntersectionObserver",
  "ResizeObserver",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "matchMedia",
  "getComputedStyle",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "CustomEvent",
  "FileReader"
];
var BROWSER_GLOBALS = new Set(BROWSER_APIS);

// src/analyzer/extractHooks.ts
var HOOK_PATTERN = /^use[A-Z]/;
function extractHooks(sourceFile) {
  const seen = /* @__PURE__ */ new Map();
  sourceFile.getDescendantsOfKind(import_ts_morph2.SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();
    let name;
    if (expr.isKind(import_ts_morph2.SyntaxKind.Identifier)) {
      name = expr.getText();
    }
    if (expr.isKind(import_ts_morph2.SyntaxKind.PropertyAccessExpression)) {
      const member = expr.getName();
      if (HOOK_PATTERN.test(member)) name = member;
    }
    if (!name || !HOOK_PATTERN.test(name)) return;
    if (!seen.has(name)) {
      seen.set(name, {
        name,
        isBuiltIn: ALL_BUILT_IN_HOOKS.has(name),
        isCustomHook: !ALL_BUILT_IN_HOOKS.has(name)
      });
    }
  });
  return [...seen.values()];
}

// src/analyzer/extractFetch.ts
var import_ts_morph3 = require("ts-morph");
function resolveStringLiteral(node) {
  if (node.isKind(import_ts_morph3.SyntaxKind.StringLiteral)) return node.getLiteralText();
  if (node.isKind(import_ts_morph3.SyntaxKind.NoSubstitutionTemplateLiteral))
    return node.getLiteralText();
  return null;
}
function resolveNumericLiteral(node) {
  if (node.isKind(import_ts_morph3.SyntaxKind.NumericLiteral))
    return Number(node.getLiteralText());
  return null;
}
function analyzeOptionsObject(obj) {
  let hasCacheConfig = false;
  let cacheValue = null;
  let hasRevalidate = false;
  let revalidateValue = null;
  const cacheProp = obj.getProperty("cache");
  if (cacheProp && import_ts_morph3.Node.isPropertyAssignment(cacheProp)) {
    hasCacheConfig = true;
    cacheValue = resolveStringLiteral(cacheProp.getInitializer());
  }
  const nextProp = obj.getProperty("next");
  if (nextProp && import_ts_morph3.Node.isPropertyAssignment(nextProp)) {
    const nextInit = nextProp.getInitializer();
    if (nextInit && import_ts_morph3.Node.isObjectLiteralExpression(nextInit)) {
      const revalidateProp = nextInit.getProperty("revalidate");
      if (revalidateProp && import_ts_morph3.Node.isPropertyAssignment(revalidateProp)) {
        hasRevalidate = true;
        const init = revalidateProp.getInitializer();
        revalidateValue = resolveNumericLiteral(init) ?? resolveStringLiteral(init) ?? init.getText();
      }
    }
  }
  const isDynamic = cacheValue === "no-store" || hasRevalidate && revalidateValue === 0;
  return {
    hasCacheConfig,
    cacheValue,
    hasRevalidate,
    revalidateValue,
    isDynamic
  };
}
function extractFetchCalls(sourceFile) {
  const results = [];
  sourceFile.getDescendantsOfKind(import_ts_morph3.SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();
    if (!expr.isKind(import_ts_morph3.SyntaxKind.Identifier)) return;
    if (expr.getText() !== "fetch") return;
    const args = call.getArguments();
    const optionsArg = args[1];
    if (optionsArg && import_ts_morph3.Node.isObjectLiteralExpression(optionsArg)) {
      results.push(analyzeOptionsObject(optionsArg));
    } else {
      results.push({
        hasCacheConfig: false,
        cacheValue: null,
        hasRevalidate: false,
        revalidateValue: null,
        isDynamic: false
      });
    }
  });
  return results;
}

// src/analyzer/extractBrowserApis.ts
var import_ts_morph4 = require("ts-morph");
function extractBrowserAPIs(sourceFile) {
  const counts = /* @__PURE__ */ new Map();
  sourceFile.getDescendantsOfKind(import_ts_morph4.SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    if (!BROWSER_GLOBALS.has(name)) return;
    const parent = id.getParent();
    if (!parent) return;
    if (parent.isKind(import_ts_morph4.SyntaxKind.PropertyAccessExpression)) {
      if (parent.getNameNode() === id) return;
    }
    if (parent.isKind(import_ts_morph4.SyntaxKind.ImportSpecifier) || parent.isKind(import_ts_morph4.SyntaxKind.ImportClause) || parent.isKind(import_ts_morph4.SyntaxKind.ExportSpecifier) || parent.isKind(import_ts_morph4.SyntaxKind.NamespaceImport))
      return;
    if (parent.isKind(import_ts_morph4.SyntaxKind.TypeReference) || parent.isKind(import_ts_morph4.SyntaxKind.QualifiedName))
      return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return [...counts.entries()].map(([api, count]) => ({ api, count }));
}

// src/analyzer/analyzeFile.ts
var sharedProject = null;
function getProject(tsConfigPath) {
  if (sharedProject) return sharedProject;
  sharedProject = new import_ts_morph5.Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4,
      // JsxEmit.ReactJSX
      strict: false
    }
  });
  return sharedProject;
}
function detectDirective(sourceFile) {
  const statements = sourceFile.getStatements();
  const first = statements[0];
  if (!first) return { isClient: false, isServer: false };
  const text = first.getText().trim().replace(/;$/, "");
  if (text === '"use client"' || text === "'use client'") {
    return { isClient: true, isServer: false };
  }
  if (text === '"use server"' || text === "'use server'") {
    return { isClient: false, isServer: true };
  }
  return { isClient: false, isServer: true };
}
function detectAsyncComponent(sourceFile) {
  const exportedDecls = sourceFile.getExportedDeclarations();
  for (const [, declarations] of exportedDecls.entries()) {
    for (const decl of declarations) {
      if ("isAsync" in decl && typeof decl.isAsync === "function") {
        if (decl.isAsync()) return true;
      }
    }
  }
  return false;
}
function resolveScriptKind(filePath) {
  const ext = import_node_path3.default.extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return import_ts_morph5.ScriptKind.TSX;
    case ".ts":
      return import_ts_morph5.ScriptKind.TS;
    case ".jsx":
      return import_ts_morph5.ScriptKind.JSX;
    case ".mjs":
    case ".cjs":
    case ".js":
      return import_ts_morph5.ScriptKind.JS;
    default:
      return import_ts_morph5.ScriptKind.TS;
  }
}
async function analyzeFile(filePath, options = {}) {
  const errors = [];
  if (!import_node_fs2.default.existsSync(filePath)) {
    throw new Error(`[analyzeFile] File not found: ${filePath}`);
  }
  let sourceFile;
  try {
    const project = getProject(options.tsConfigPath);
    const scriptKind = resolveScriptKind(filePath);
    sourceFile = project.getSourceFile(filePath) ?? project.addSourceFileAtPath(filePath);
    if (!sourceFile) {
      sourceFile = project.createSourceFile(
        filePath,
        import_node_fs2.default.readFileSync(filePath, "utf8"),
        { scriptKind, overwrite: true }
      );
    }
  } catch (err) {
    throw new Error(
      `[analyzeFile] Failed to parse ${filePath}: ${err.message}`
    );
  }
  let importDetails = [];
  let exportDetails = [];
  let hookDetails = [];
  let fetchCalls = [];
  let browserAPIs = [];
  let directive = { isClient: false, isServer: false };
  let hasAsyncComponent = false;
  try {
    importDetails = extractImports(sourceFile);
  } catch (e) {
    errors.push(`imports: ${e.message}`);
  }
  try {
    exportDetails = extractExports(sourceFile);
  } catch (e) {
    errors.push(`exports: ${e.message}`);
  }
  try {
    hookDetails = extractHooks(sourceFile);
  } catch (e) {
    errors.push(`hooks: ${e.message}`);
  }
  try {
    fetchCalls = extractFetchCalls(sourceFile);
  } catch (e) {
    errors.push(`fetch: ${e.message}`);
  }
  try {
    browserAPIs = extractBrowserAPIs(sourceFile);
  } catch (e) {
    errors.push(`browserAPIs: ${e.message}`);
  }
  try {
    directive = detectDirective(sourceFile);
  } catch (e) {
    errors.push(`directive: ${e.message}`);
  }
  try {
    hasAsyncComponent = detectAsyncComponent(sourceFile);
  } catch (e) {
    errors.push(`async: ${e.message}`);
  }
  return {
    filePath,
    isClientComponent: directive.isClient,
    isServerComponent: directive.isServer,
    imports: importDetails.map((i) => i.moduleSpecifier),
    importDetails,
    exports: exportDetails.map((e) => e.name),
    exportDetails,
    hooks: hookDetails.map((h) => h.name),
    hookDetails,
    usesBrowserAPI: browserAPIs.length > 0,
    browserAPIs,
    fetchCalls,
    hasAsyncComponent,
    errors
  };
}
async function analyzeFiles(filePaths, options = {}) {
  return Promise.all(
    filePaths.map(
      (fp) => analyzeFile(fp, options).catch(
        (err) => ({
          filePath: fp,
          isClientComponent: false,
          isServerComponent: false,
          imports: [],
          importDetails: [],
          exports: [],
          exportDetails: [],
          hooks: [],
          hookDetails: [],
          usesBrowserAPI: false,
          browserAPIs: [],
          fetchCalls: [],
          hasAsyncComponent: false,
          errors: [err.message]
        })
      )
    )
  );
}
function resetProject() {
  sharedProject = null;
}

// src/graph/buildGraph.ts
var import_graphlib = require("graphlib");
var import_node_path4 = __toESM(require("path"), 1);
var import_node_fs3 = __toESM(require("fs"), 1);

// src/graph/constants.ts
var KIND_PATTERNS = {
  page: [/\/app\/.*\/page\.[tj]sx?$/, /\/pages\/.*\.[tj]sx?$/],
  component: [/\/components?\//, /\/ui\//],
  hook: [/\/hooks?\//, /use[A-Z][^/]*\.[tj]sx?$/],
  action: [/\/actions?\//, /action\.[tj]sx?$/],
  util: [/\/utils?\//, /\/lib\//, /\/helpers?\//, /\/services?\//],
  unknown: []
};
var EXTERNAL_MODULE_PREFIXES = ["react", "next", "node:"];

// src/graph/buildGraph.ts
function classifyKind(filePath) {
  for (const [kind, patterns] of Object.entries(KIND_PATTERNS)) {
    if (kind === "unknown") continue;
    if (patterns.some((re) => re.test(filePath))) {
      return kind;
    }
  }
  return "unknown";
}
function inferIsServerComponent(filePath, isClientComponent) {
  if (isClientComponent) return false;
  return /\.[tj]sx$/.test(filePath);
}
function resolveSpecifier(specifier, fromFile, projectRoot, knownFiles) {
  if (!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("@/")) {
    return null;
  }
  if (EXTERNAL_MODULE_PREFIXES.some((p) => specifier.startsWith(p))) {
    return null;
  }
  const base = specifier.startsWith("@/") ? import_node_path4.default.join(projectRoot, specifier.slice(2)) : import_node_path4.default.resolve(import_node_path4.default.dirname(fromFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    import_node_path4.default.join(base, "index.ts"),
    import_node_path4.default.join(base, "index.tsx"),
    import_node_path4.default.join(base, "index.js")
  ];
  for (const candidate of candidates) {
    const normalized = candidate.split(import_node_path4.default.sep).join("/");
    if (knownFiles.has(normalized)) return normalized;
    if (import_node_fs3.default.existsSync(candidate)) return candidate.split(import_node_path4.default.sep).join("/");
  }
  return null;
}
function buildGraph(analyses, projectRoot) {
  const graph = new import_graphlib.Graph({
    directed: true,
    multigraph: false,
    compound: false
  });
  const nodes = /* @__PURE__ */ new Map();
  const edges = [];
  const knownFiles = new Set(analyses.map((a) => a.filePath));
  for (const analysis of analyses) {
    const node = {
      id: analysis.filePath,
      filePath: analysis.filePath,
      isClientComponent: analysis.isClientComponent,
      // Infer server component from file extension + absence of "use client".
      isServerComponent: analysis.isServerComponent || inferIsServerComponent(analysis.filePath, analysis.isClientComponent),
      hasDefaultExport: analysis.exports.includes("default"),
      kind: classifyKind(analysis.filePath)
    };
    nodes.set(analysis.filePath, node);
    graph.setNode(analysis.filePath, node);
  }
  for (const analysis of analyses) {
    for (const importDetail of analysis.importDetails) {
      const resolved = resolveSpecifier(
        importDetail.moduleSpecifier,
        analysis.filePath,
        projectRoot,
        knownFiles
      );
      if (!resolved) continue;
      if (!graph.hasNode(resolved)) {
        const node = {
          id: resolved,
          filePath: resolved,
          isClientComponent: false,
          isServerComponent: inferIsServerComponent(resolved, false),
          hasDefaultExport: false,
          kind: classifyKind(resolved)
        };
        nodes.set(resolved, node);
        graph.setNode(resolved, node);
      }
      graph.setEdge(analysis.filePath, resolved);
      edges.push({
        from: analysis.filePath,
        to: resolved,
        importedNames: [
          ...importDetail.namedImports,
          ...importDetail.defaultImport ? [importDetail.defaultImport] : []
        ],
        isTypeOnly: importDetail.isTypeOnly
      });
    }
  }
  return { graph, nodes, edges };
}

// src/graph/detectCycles.ts
function detectCycles(graph) {
  const colors = /* @__PURE__ */ new Map();
  const cycles = [];
  for (const node of graph.nodes()) {
    colors.set(node, "white");
  }
  function dfs2(start) {
    const stack = [
      { node: start, iterator: graph.successors(start) ?? [] }
    ];
    const path5 = [start];
    const inPath = /* @__PURE__ */ new Set([start]);
    colors.set(start, "gray");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === void 0) break;
      if (top.iterator.length === 0) {
        colors.set(top.node, "black");
        path5.pop();
        inPath.delete(top.node);
        stack.pop();
        continue;
      }
      const neighbor = top.iterator.shift();
      if (neighbor === void 0) continue;
      const color = colors.get(neighbor);
      if (color === "gray" && inPath.has(neighbor)) {
        const cycleStart = path5.indexOf(neighbor);
        const cycle = path5.slice(cycleStart);
        cycles.push(cycle);
        continue;
      }
      if (color === "white") {
        colors.set(neighbor, "gray");
        path5.push(neighbor);
        inPath.add(neighbor);
        stack.push({
          node: neighbor,
          iterator: graph.successors(neighbor) ?? []
        });
      }
    }
  }
  for (const node of graph.nodes()) {
    if (colors.get(node) === "white") {
      dfs2(node);
    }
  }
  function normalizeKey(cycle) {
    const minIdx = cycle.reduce(
      (best, node, i) => node < cycle[best] ? i : best,
      0
    );
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    return rotated.join("|");
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = cycles.filter((cycle) => {
    const key = normalizeKey(cycle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    hasCycles: unique.length > 0,
    cycles: unique
  };
}
function getCyclicNodes(report) {
  const nodes = /* @__PURE__ */ new Set();
  for (const cycle of report.cycles) {
    for (const node of cycle) nodes.add(node);
  }
  return nodes;
}

// src/graph/traversal.ts
function bfs(graph, startId, options = {}) {
  const { maxDepth = 0, direction = "outbound" } = options;
  const visited = /* @__PURE__ */ new Set();
  const queue = [
    { id: startId, depth: 0 }
  ];
  const result = [];
  while (queue.length > 0) {
    const { id, depth } = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    result.push(id);
    if (maxDepth > 0 && depth >= maxDepth) continue;
    const neighbors = direction === "outbound" ? graph.successors(id) ?? [] : graph.predecessors(id) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push({ id: neighbor, depth: depth + 1 });
      }
    }
  }
  return result;
}
function dfs(graph, startId, options = {}) {
  const { maxDepth = 0, direction = "outbound" } = options;
  const visited = /* @__PURE__ */ new Set();
  const result = [];
  function visit(id, depth) {
    if (visited.has(id)) return;
    visited.add(id);
    result.push(id);
    if (maxDepth > 0 && depth >= maxDepth) return;
    const neighbors = direction === "outbound" ? graph.successors(id) ?? [] : graph.predecessors(id) ?? [];
    for (const neighbor of neighbors) visit(neighbor, depth + 1);
  }
  visit(startId, 0);
  return result;
}
function findPath(graph, fromId, toId) {
  if (!graph.hasNode(fromId) || !graph.hasNode(toId)) {
    return { found: false, path: [] };
  }
  const visited = /* @__PURE__ */ new Set();
  const parentMap = /* @__PURE__ */ new Map();
  const queue = [fromId];
  parentMap.set(fromId, null);
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === toId) {
      const path5 = [];
      let node = toId;
      while (node !== null) {
        path5.unshift(node);
        node = parentMap.get(node) ?? null;
      }
      return { found: true, path: path5 };
    }
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of graph.successors(current) ?? []) {
      if (!visited.has(neighbor)) {
        parentMap.set(neighbor, current);
        queue.push(neighbor);
      }
    }
  }
  return { found: false, path: [] };
}
function getDependencies(graph, fileId, options) {
  return bfs(graph, fileId, { ...options, direction: "outbound" }).slice(1);
}
function getDependents(graph, fileId, options) {
  return bfs(graph, fileId, { ...options, direction: "inbound" }).slice(1);
}
function getSinks(graph) {
  return graph.nodes().filter((n) => (graph.successors(n) ?? []).length === 0);
}
function getEntryPoints(graph) {
  return graph.nodes().filter((n) => (graph.predecessors(n) ?? []).length === 0);
}
function getMostImported(graph, topN = 10) {
  return graph.nodes().map((id) => ({ id, count: (graph.predecessors(id) ?? []).length })).sort((a, b) => b.count - a.count).slice(0, topN);
}
function summarizeGraph(graph, nodes) {
  const cycles = detectCycles(graph);
  const clientNodes = [];
  const serverNodes = [];
  for (const [id, node] of nodes.entries()) {
    if (node.isClientComponent) clientNodes.push(id);
    if (node.isServerComponent) serverNodes.push(id);
  }
  return {
    totalNodes: graph.nodeCount(),
    totalEdges: graph.edgeCount(),
    entryPoints: getEntryPoints(graph),
    sinks: getSinks(graph),
    cycles,
    mostImported: getMostImported(graph),
    clientNodes,
    serverNodes
  };
}
function toAsciiTree(graph, startId, nodes, options = {}) {
  const { maxDepth = 0, labels = "basename" } = options;
  const lines = [];
  const globalSeen = /* @__PURE__ */ new Set();
  const currentPath = /* @__PURE__ */ new Set();
  function label(id) {
    if (labels === "full") return id;
    return id.split("/").pop() ?? id;
  }
  function walk(id, depth, prefix) {
    const node = nodes.get(id);
    const tag = node?.isClientComponent ? " [client]" : node?.isServerComponent ? " [server]" : "";
    if (currentPath.has(id)) {
      lines.push(`${prefix}${label(id)}${tag} (\u21A9 circular)`);
      return;
    }
    lines.push(`${prefix}${label(id)}${tag}`);
    if (globalSeen.has(id)) return;
    globalSeen.add(id);
    if (maxDepth > 0 && depth >= maxDepth) return;
    currentPath.add(id);
    const successors = graph.successors(id) ?? [];
    for (const successor of successors) {
      lines.push(`${prefix}\u2193`);
      walk(successor, depth + 1, prefix + "   ");
    }
    currentPath.delete(id);
  }
  walk(startId, 0, "");
  return lines.join("\n");
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ALL_BUILT_IN_HOOKS,
  BROWSER_APIS,
  BROWSER_GLOBALS,
  EXCLUDED_DIRS,
  NEXT_BUILT_IN_HOOKS,
  REACT_BUILT_IN_HOOKS,
  ROOT_CONFIG_FILES,
  SCAN_TARGETS,
  SOURCE_EXTENSIONS,
  analyzeFile,
  analyzeFiles,
  bfs,
  buildGraph,
  detectCycles,
  dfs,
  findPath,
  getCyclicNodes,
  getDependencies,
  getDependents,
  getEntryPoints,
  getMostImported,
  getSinks,
  isInsideDir,
  normalizePath,
  resetProject,
  scanProject,
  summarizeGraph,
  toAsciiTree,
  toRelativePath
});
