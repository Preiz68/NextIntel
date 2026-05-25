import type { RuntimeContext } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import fs from "node:fs";

/**
 * Derives the execution runtime of the Next.js component.
 */
export function detectRuntime(analysis: FileAnalysis): RuntimeContext {
  if (analysis.isClientComponent) {
    return "client";
  }

  const normalizedPath = analysis.filePath.replace(/\\/g, "/");
  if (normalizedPath.endsWith("middleware.ts") || normalizedPath.endsWith("middleware.js")) {
    return "edge";
  }

  // Detect explicit segment configuration: export const runtime = 'edge'
  if (fs.existsSync(analysis.filePath)) {
    try {
      const content = fs.readFileSync(analysis.filePath, "utf8");
      if (/export\s+const\s+runtime\s*=\s*['"]edge['"]/.test(content)) {
        return "edge";
      }
    } catch (e) {
      // ignore
    }
  }

  return "server";
}
