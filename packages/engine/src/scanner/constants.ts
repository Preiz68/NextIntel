/**
 * constants.ts
 * Central configuration for the Next.js project scanner.
 */

/** File extensions recognised as TypeScript / JavaScript source files. */
export const SOURCE_EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "mts",
  "cts",
] as const;

export type SourceExtension = (typeof SOURCE_EXTENSIONS)[number];

/**
 * Directory names that are always excluded from scanning, regardless of
 * where they appear in the tree.
 */
export const EXCLUDED_DIRS = [
  "node_modules",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "build",
] as const;

export type ExcludedDir = (typeof EXCLUDED_DIRS)[number];

/**
 * Top-level directory segments that the scanner targets.
 * Covers both root-level layouts (app/, pages/, components/)
 * and src-prefixed equivalents (src/app, src/pages, …).
 */
export const SCAN_TARGETS = [
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
  "middleware",
] as const;

export type ScanTarget = (typeof SCAN_TARGETS)[number];

/**
 * Files that are well-known Next.js configuration / entry-point files
 * and should always be included even when they sit at the project root
 * rather than inside a scan-target directory.
 */
export const ROOT_CONFIG_FILES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "middleware.ts",
  "middleware.js",
  "instrumentation.ts",
  "instrumentation.js",
] as const;
