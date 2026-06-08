import type { RuntimeContext } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import fs from "node:fs";

/**
 * Derives the execution runtime of the Next.js component.
 */
export function detectRuntime(analysis: FileAnalysis, fileContent?: string): RuntimeContext {
  if (analysis.isClientComponent) {
    return "client";
  }

  const normalizedPath = analysis.filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith("middleware.ts") || normalizedPath.endsWith("middleware.js")) {
    return "edge";
  }

  if (analysis.isEdgeRuntime) {
    return "edge";
  }

  // Detect explicit segment configuration: export const runtime = 'edge'
  const content = fileContent !== undefined ? fileContent : (() => {
    try {
      if (fs.existsSync(analysis.filePath)) {
        return fs.readFileSync(analysis.filePath, "utf8");
      }
    } catch {}
    return null;
  })();

  if (content !== null && /export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(content)) {
    return "edge";
  }

  return "server";
}
