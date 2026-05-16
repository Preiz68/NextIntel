import { Graph } from 'graphlib';

/**
 * scanProject.ts
 * Production-grade Next.js project scanner powered by fast-glob.
 *
 * Usage
 * ─────
 *   import { scanProject } from "./scanProject";
 *
 *   const result = await scanProject("/path/to/my-next-app");
 *   console.log(result.files);   // absolute normalised paths
 *   console.log(result.stats);   // breakdown by directory + extension
 */
/** Options accepted by `scanProject`. */
interface ScanOptions {
    /**
     * Extra directories (relative to `root`) to scan in addition to the
     * built-in targets.
     */
    additionalTargets?: string[];
    /**
     * Extra directory names to exclude in addition to the built-in list.
     * Pass bare names (e.g. `"__mocks__"`), not glob patterns.
     */
    additionalExcludes?: string[];
    /**
     * When `true`, the scanner also traverses directories that are not in
     * the target list but exist at the project root (e.g. a custom `server/`
     * folder). Defaults to `false`.
     */
    scanRootFallback?: boolean;
    /**
     * When `true`, dot-files and dot-directories (other than the built-in
     * excluded ones) are included. Defaults to `false`.
     */
    includeDotFiles?: boolean;
    /**
     * Maximum directory depth to traverse (relative to each scan-target root).
     * `0` means unlimited. Defaults to `0`.
     */
    maxDepth?: number;
}
/** Per-extension file counts. */
type ExtensionBreakdown = Record<string, number>;
/** Statistics returned alongside the file list. */
interface ScanStats {
    /** Total number of matched files. */
    totalFiles: number;
    /** How many files were found in each scanned directory segment. */
    byDirectory: Record<string, number>;
    /** How many files have each extension. */
    byExtension: ExtensionBreakdown;
    /** Absolute paths of the actual directories that were globbed. */
    scannedRoots: string[];
    /** Directories that were listed as targets but do not exist on disk. */
    missingTargets: string[];
    /** Wall-clock time (ms) the scan took. */
    durationMs: number;
}
/** Full result returned by `scanProject`. */
interface ScanResult {
    /** Sorted list of absolute, normalised POSIX paths. */
    files: string[];
    /** Diagnostic statistics for the scan. */
    stats: ScanStats;
}
/**
 * Recursively scan a Next.js project for TypeScript / JavaScript source files.
 *
 * @param root    - Absolute or relative path to the project root.
 * @param options - Optional tuning parameters.
 * @returns       Sorted file list and diagnostic statistics.
 *
 * @example
 * ```ts
 * const { files, stats } = await scanProject("/projects/my-app");
 * // files → ["/projects/my-app/app/page.tsx", "/projects/my-app/components/Button.tsx", …]
 * ```
 */
declare function scanProject(root: string, options?: ScanOptions): Promise<ScanResult>;

/**
 * normalizePath.ts
 * Utilities for producing consistent, absolute POSIX-style paths.
 */
/**
 * Convert any path to an absolute, normalised, forward-slash path.
 *
 * • Resolves relative paths against `cwd` (defaults to `process.cwd()`).
 * • Collapses `.` / `..` segments.
 * • Converts Windows back-slashes to forward slashes so that paths are
 *   safe to use in fast-glob patterns and comparable across platforms.
 *
 * @param input - Absolute or relative path to normalise.
 * @param cwd   - Base directory used when `input` is relative.
 * @returns     Normalised absolute POSIX path.
 */
declare function normalizePath(input: string, cwd?: string): string;
/**
 * Strip a leading `root` prefix from `filePath` and return the remainder
 * as a normalised relative path (always starts with `./`).
 *
 * Useful for generating human-readable paths in reports.
 *
 * @param filePath - Absolute path to shorten.
 * @param root     - Root prefix to strip.
 * @returns        Relative POSIX path beginning with `./`.
 */
declare function toRelativePath(filePath: string, root: string): string;
/**
 * Return `true` when `filePath` is nested somewhere inside `dir`.
 *
 * @param filePath - Path to test.
 * @param dir      - Candidate ancestor directory.
 */
declare function isInsideDir(filePath: string, dir: string): boolean;

/**
 * constants.ts
 * Central configuration for the Next.js project scanner.
 */
/** File extensions recognised as TypeScript / JavaScript source files. */
declare const SOURCE_EXTENSIONS: readonly ["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"];
type SourceExtension = (typeof SOURCE_EXTENSIONS)[number];
/**
 * Directory names that are always excluded from scanning, regardless of
 * where they appear in the tree.
 */
declare const EXCLUDED_DIRS: readonly ["node_modules", ".next", "dist", "coverage", ".turbo", ".cache", "out", "build"];
type ExcludedDir = (typeof EXCLUDED_DIRS)[number];
/**
 * Top-level directory segments that the scanner targets.
 * Covers both root-level layouts (app/, pages/, components/)
 * and src-prefixed equivalents (src/app, src/pages, …).
 */
declare const SCAN_TARGETS: readonly ["app", "pages", "components", "src", "lib", "hooks", "utils", "types", "styles", "config", "middleware"];
type ScanTarget = (typeof SCAN_TARGETS)[number];
/**
 * Files that are well-known Next.js configuration / entry-point files
 * and should always be included even when they sit at the project root
 * rather than inside a scan-target directory.
 */
declare const ROOT_CONFIG_FILES: readonly ["next.config.ts", "next.config.js", "next.config.mjs", "middleware.ts", "middleware.js", "instrumentation.ts", "instrumentation.js"];

interface ImportInfo {
    moduleSpecifier: string;
    namedImports: string[];
    defaultImport: string | null;
    namespaceImport: string | null;
    isTypeOnly: boolean;
}
interface ExportInfo {
    name: string;
    isDefault: boolean;
    isTypeOnly: boolean;
    kind: "function" | "class" | "variable" | "type" | "interface" | "enum" | "unknown";
}
interface FetchCall {
    hasCacheConfig: boolean;
    cacheValue: string | null;
    hasRevalidate: boolean;
    revalidateValue: number | string | null;
    isDynamic: boolean;
}
interface HookUsage {
    name: string;
    isCustomHook: boolean;
    isBuiltIn: boolean;
}
interface BrowserAPIUsage {
    api: string;
    count: number;
}
interface FileAnalysis {
    filePath: string;
    isClientComponent: boolean;
    isServerComponent: boolean;
    imports: string[];
    importDetails: ImportInfo[];
    exports: string[];
    exportDetails: ExportInfo[];
    hooks: string[];
    hookDetails: HookUsage[];
    usesBrowserAPI: boolean;
    browserAPIs: BrowserAPIUsage[];
    fetchCalls: FetchCall[];
    hasAsyncComponent: boolean;
    errors: string[];
}

interface AnalyzeOptions {
    tsConfigPath?: string;
}
/**
 * Analyse a single TypeScript / JavaScript file and return a strongly typed
 * `FileAnalysis` object describing its imports, exports, hooks, fetch calls,
 * browser API usage, and client/server classification.
 *
 * @param filePath - Absolute path to the file.
 * @param options  - Optional path to the project's tsconfig.json.
 */
declare function analyzeFile(filePath: string, options?: AnalyzeOptions): Promise<FileAnalysis>;
/**
 * Analyse multiple files in parallel.
 * Failed files surface their error inside `FileAnalysis.errors` rather than
 * rejecting the whole batch.
 */
declare function analyzeFiles(filePaths: string[], options?: AnalyzeOptions): Promise<FileAnalysis[]>;
/** Reset the shared ts-morph Project (useful between test runs). */
declare function resetProject(): void;

declare const REACT_BUILT_IN_HOOKS: Set<string>;
declare const NEXT_BUILT_IN_HOOKS: Set<string>;
declare const ALL_BUILT_IN_HOOKS: Set<string>;
declare const BROWSER_APIS: readonly ["window", "document", "navigator", "location", "history", "localStorage", "sessionStorage", "indexedDB", "crypto", "performance", "screen", "alert", "confirm", "prompt", "XMLHttpRequest", "WebSocket", "Worker", "ServiceWorker", "Notification", "IntersectionObserver", "ResizeObserver", "MutationObserver", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "getComputedStyle", "addEventListener", "removeEventListener", "dispatchEvent", "CustomEvent", "FileReader"];
declare const BROWSER_GLOBALS: Set<"window" | "document" | "navigator" | "location" | "history" | "localStorage" | "sessionStorage" | "indexedDB" | "crypto" | "performance" | "screen" | "alert" | "confirm" | "prompt" | "XMLHttpRequest" | "WebSocket" | "Worker" | "ServiceWorker" | "Notification" | "IntersectionObserver" | "ResizeObserver" | "MutationObserver" | "requestAnimationFrame" | "cancelAnimationFrame" | "matchMedia" | "getComputedStyle" | "addEventListener" | "removeEventListener" | "dispatchEvent" | "CustomEvent" | "FileReader">;

interface GraphNode {
    id: string;
    filePath: string;
    isClientComponent: boolean;
    isServerComponent: boolean;
    hasDefaultExport: boolean;
    kind: "page" | "component" | "hook" | "util" | "action" | "unknown";
}
interface GraphEdge {
    from: string;
    to: string;
    importedNames: string[];
    isTypeOnly: boolean;
}
interface CycleReport {
    hasCycles: boolean;
    cycles: string[][];
}
interface PathResult {
    found: boolean;
    path: string[];
}
interface GraphSummary {
    totalNodes: number;
    totalEdges: number;
    entryPoints: string[];
    sinks: string[];
    cycles: CycleReport;
    mostImported: {
        id: string;
        count: number;
    }[];
    clientNodes: string[];
    serverNodes: string[];
}
interface TraversalOptions {
    maxDepth?: number;
    direction?: "inbound" | "outbound";
}

interface BuildGraphResult {
    graph: Graph;
    nodes: Map<string, GraphNode>;
    edges: GraphEdge[];
}
declare function buildGraph(analyses: FileAnalysis[], projectRoot: string): BuildGraphResult;

declare function detectCycles(graph: Graph): CycleReport;
declare function getCyclicNodes(report: CycleReport): Set<string>;

/**
 * BFS from `startId` following outbound edges (A imports B).
 * Returns nodes in visit order.
 */
declare function bfs(graph: Graph, startId: string, options?: TraversalOptions): string[];
/**
 * DFS from `startId`. Returns nodes in visit order.
 */
declare function dfs(graph: Graph, startId: string, options?: TraversalOptions): string[];
/**
 * Find the shortest path between two nodes using BFS.
 */
declare function findPath(graph: Graph, fromId: string, toId: string): PathResult;
/**
 * All files that `fileId` directly or transitively imports.
 */
declare function getDependencies(graph: Graph, fileId: string, options?: TraversalOptions): string[];
/**
 * All files that directly or transitively import `fileId`.
 */
declare function getDependents(graph: Graph, fileId: string, options?: TraversalOptions): string[];
/**
 * Files with no outbound edges (nothing imported from them that's in the graph).
 */
declare function getSinks(graph: Graph): string[];
/**
 * Files with no inbound edges — nothing imports them.
 */
declare function getEntryPoints(graph: Graph): string[];
/**
 * Return nodes ranked by how many other files import them (inbound degree).
 */
declare function getMostImported(graph: Graph, topN?: number): {
    id: string;
    count: number;
}[];
declare function summarizeGraph(graph: Graph, nodes: Map<string, GraphNode>): GraphSummary;
/**
 * Print an ASCII dependency tree rooted at `startId`.
 *
 * A node is only flagged (↩ circular) if it appears in the *current DFS path*,
 * not merely if it has been visited anywhere in the tree. This matches the
 * actual definition of a back-edge / cycle.
 *
 * Nodes visited via a different branch are printed normally (they are shared
 * dependencies, not cycles) but are not expanded a second time to avoid
 * infinite recursion and keep the output readable.
 */
declare function toAsciiTree(graph: Graph, startId: string, nodes: Map<string, GraphNode>, options?: TraversalOptions & {
    labels?: "full" | "basename";
}): string;

export { ALL_BUILT_IN_HOOKS, type AnalyzeOptions, BROWSER_APIS, BROWSER_GLOBALS, type BrowserAPIUsage, type BuildGraphResult, type CycleReport, EXCLUDED_DIRS, type ExcludedDir, type ExportInfo, type ExtensionBreakdown, type FetchCall, type FileAnalysis, type GraphEdge, type GraphNode, type GraphSummary, type HookUsage, type ImportInfo, NEXT_BUILT_IN_HOOKS, type PathResult, REACT_BUILT_IN_HOOKS, ROOT_CONFIG_FILES, SCAN_TARGETS, SOURCE_EXTENSIONS, type ScanOptions, type ScanResult, type ScanStats, type ScanTarget, type SourceExtension, type TraversalOptions, analyzeFile, analyzeFiles, bfs, buildGraph, detectCycles, dfs, findPath, getCyclicNodes, getDependencies, getDependents, getEntryPoints, getMostImported, getSinks, isInsideDir, normalizePath, resetProject, scanProject, summarizeGraph, toAsciiTree, toRelativePath };
