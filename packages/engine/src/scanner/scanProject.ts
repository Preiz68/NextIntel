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

import fg, { Options as FgOptions } from "fast-glob";
import fs from "node:fs";
import path from "node:path";

import {
  EXCLUDED_DIRS,
  ROOT_CONFIG_FILES,
  SCAN_TARGETS,
  SOURCE_EXTENSIONS,
} from "./constants.js";
import { normalizePath, toRelativePath } from "./normalizePath.js";

// ─── Public types ────────────────────────────────────────────────────────────

/** Options accepted by `scanProject`. */
export interface ScanOptions {
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
export type ExtensionBreakdown = Record<string, number>;

/** Statistics returned alongside the file list. */
export interface ScanStats {
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
export interface ScanResult {
  /** Sorted list of absolute, normalised POSIX paths. */
  files: string[];
  /** Diagnostic statistics for the scan. */
  stats: ScanStats;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Build the fast-glob negative patterns for excluded directories. */
function buildIgnorePatterns(extra: string[] = []): string[] {
  const dirs = [...EXCLUDED_DIRS, ...extra];
  // Match the directory at any depth in the tree.
  return dirs.flatMap((d) => [`**/${d}`, `**/${d}/**`]);
}

/**
 * Resolve which directories to scan.
 *
 * Strategy
 * ────────
 * 1.  For every SCAN_TARGET check whether `<root>/<target>` exists.
 * 2.  If neither `app/` nor `src/app/` exists we fall back to `src/` (when
 *     it exists) so that src-only monorepo packages are still covered.
 * 3.  When `scanRootFallback` is true, surface any *other* top-level dirs.
 */
function resolveTargetDirs(
  root: string,
  extra: string[],
  scanRootFallback: boolean,
): { existing: string[]; missing: string[] } {
  const targets = [...SCAN_TARGETS, ...extra];
  const existing: string[] = [];
  const missing: string[] = [];

  for (const t of targets) {
    const abs = path.join(root, t);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
      existing.push(abs);
    } else {
      missing.push(t);
    }
  }

  if (scanRootFallback && existing.length === 0) {
    // Last resort: scan the root itself.
    existing.push(root);
  }

  return { existing, missing };
}

/** Accumulate per-directory and per-extension stats from a file list. */
function buildStats(
  files: string[],
  root: string,
  scannedRoots: string[],
  missingTargets: string[],
  durationMs: number,
): ScanStats {
  const byDirectory: Record<string, number> = {};
  const byExtension: ExtensionBreakdown = {};

  for (const f of files) {
    // Directory segment = first path component after root.
    const rel = toRelativePath(f, root); // e.g. "./app/page.tsx"
    const segment = rel.split("/")[1] ?? "(root)"; // "app"

    byDirectory[segment] = (byDirectory[segment] ?? 0) + 1;

    const ext = path.extname(f).replace(".", "") || "(no-ext)";
    byExtension[ext] = (byExtension[ext] ?? 0) + 1;
  }

  return {
    totalFiles: files.length,
    byDirectory,
    byExtension,
    scannedRoots,
    missingTargets,
    durationMs,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
export async function scanProject(
  root: string,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const {
    additionalTargets = [],
    additionalExcludes = [],
    scanRootFallback = false,
    includeDotFiles = false,
    maxDepth = 0,
  } = options;

  const t0 = Date.now();

  // ── 1. Resolve & validate root ───────────────────────────────────────────
  const normalRoot = normalizePath(root);

  if (!fs.existsSync(normalRoot)) {
    throw new Error(
      `[scanProject] Root directory does not exist: ${normalRoot}`,
    );
  }
  if (!fs.statSync(normalRoot).isDirectory()) {
    throw new Error(
      `[scanProject] Root path is not a directory: ${normalRoot}`,
    );
  }

  // ── 2. Determine which directories to scan ───────────────────────────────
  const { existing: scannedRoots, missing: missingTargets } = resolveTargetDirs(
    normalRoot,
    additionalTargets,
    scanRootFallback,
  );

  // ── 3. Build glob pattern ────────────────────────────────────────────────
  const extPattern = `**/*.{${SOURCE_EXTENSIONS.join(",")}}`;
  const ignoreGlobs = buildIgnorePatterns(additionalExcludes);

  const fgOptions: FgOptions = {
    cwd: normalRoot,
    absolute: true, // return absolute paths
    onlyFiles: true,
    dot: includeDotFiles,
    ignore: ignoreGlobs,
    ...(maxDepth > 0 ? { deep: maxDepth } : {}),
    // Ensures consistent cross-platform results.
    followSymbolicLinks: false,
  };

  // ── 4. Run globs in all target directories in parallel ───────────────────
  const globPatterns = scannedRoots.map(
    (dir) => `${normalizePath(dir)}/${extPattern}`,
  );

  // Also pick up well-known root-level config files.
  const configPatterns = ROOT_CONFIG_FILES.map((f) => `${normalRoot}/${f}`);

  const [sourceFiles, configFiles] = await Promise.all([
    scannedRoots.length > 0
      ? fg(globPatterns, fgOptions)
      : Promise.resolve<string[]>([]),
    fg(configPatterns, { absolute: true, onlyFiles: true }),
  ]);

  // ── 5. Merge, de-duplicate, normalise, sort ──────────────────────────────
  const seen = new Set<string>();
  const files: string[] = [];

  for (const raw of [...sourceFiles, ...configFiles]) {
    const norm = normalizePath(raw);
    if (!seen.has(norm)) {
      seen.add(norm);
      files.push(norm);
    }
  }

  files.sort();

  // ── 6. Assemble result ───────────────────────────────────────────────────
  const durationMs = Date.now() - t0;

  const stats = buildStats(
    files,
    normalRoot,
    scannedRoots.map((r) => normalizePath(r)),
    missingTargets,
    durationMs,
  );

  return { files, stats };
}
