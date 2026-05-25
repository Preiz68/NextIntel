/**
 * normalizePath.ts
 * Utilities for producing consistent, absolute POSIX-style paths.
 */

import path from "node:path";

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
export function normalizePath(input: string, cwd = process.cwd()): string {
  const absolute = path.isAbsolute(input)
    ? path.normalize(input)
    : path.resolve(cwd, input);

  // Convert Windows separators → POSIX (no-op on Linux / macOS).
  let normalized = absolute.split(path.sep).join("/");
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

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
export function toRelativePath(filePath: string, root: string): string {
  const normalFile = normalizePath(filePath);
  const normalRoot = normalizePath(root).replace(/\/?$/, "/"); // ensure trailing slash

  if (!normalFile.startsWith(normalRoot)) {
    return normalFile; // not under root — return as-is
  }

  const relative = normalFile.slice(normalRoot.length);
  return `./${relative}`;
}

/**
 * Return `true` when `filePath` is nested somewhere inside `dir`.
 *
 * @param filePath - Path to test.
 * @param dir      - Candidate ancestor directory.
 */
export function isInsideDir(filePath: string, dir: string): boolean {
  const normalFile = normalizePath(filePath);
  const normalDir = normalizePath(dir).replace(/\/?$/, "/");
  return normalFile.startsWith(normalDir);
}
