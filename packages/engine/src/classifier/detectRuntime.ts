import type { RuntimeContext } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";

/**
 * Derives the execution runtime of the file.
 * Next.js App Router defaults to Node.js ('server') unless specified otherwise.
 */
export function detectRuntime(analysis: FileAnalysis): RuntimeContext {
  // We can look for `export const runtime = 'edge'` in the raw AST analysis,
  // but since `FileAnalysis` doesn't currently extract the *values* of variable exports
  // (only their names), we will default to 'server'.
  // If the engine's extractExports is enhanced in the future to capture variable values,
  // this function can check `analysis.exportDetails.find(e => e.name === 'runtime')`.

  // Client components execute in the browser (client), but are ALSO prerendered on the server.
  // We classify their primary target runtime as 'client'.
  if (analysis.isClientComponent) {
    return "client";
  }

  // Middleware defaults to Edge runtime
  const normalizedPath = analysis.filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith("middleware.ts") || normalizedPath.endsWith("middleware.js")) {
    return "edge";
  }

  return "server";
}
