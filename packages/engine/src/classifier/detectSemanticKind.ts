import type { SemanticKind } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import path from "node:path";

/**
 * Derives the semantic role of the file based on Next.js conventions.
 */
export function detectSemanticKind(analysis: FileAnalysis): SemanticKind {
  const ext = path.extname(analysis.filePath);
  const basename = path.basename(analysis.filePath, ext); // e.g. "page", "layout"
  const normalizedPath = analysis.filePath.replace(/\\/g, "/");

  // App Router Special Files
  if (basename === "page") return "page";
  if (basename === "layout") return "layout";
  if (basename === "template") return "template";
  if (basename === "loading") return "loading";
  if (basename === "error") return "error";
  if (basename === "not-found") return "not-found";
  if (basename === "global-error") return "global-error";
  if (basename === "default") return "default";
  
  // App Router API
  if (basename === "route") return "route-handler";
  
  // Middleware
  if (basename === "middleware") return "middleware";

  // Server Actions (heuristic: has 'use server' and is not a special Next.js component file)
  if (analysis.isServerComponent) {
    // If it's a utility file that exports actions (indicated by use server)
    // Wait, in Next.js 'use server' at the top of a file makes all its exports Server Actions.
    // However, analyzeFile marks `isServerComponent: true` for BOTH default RSCs (no directive)
    // AND explicit 'use server' directives.
    // Let's rely on standard RSC vs Client Component fallback.
    // If we wanted to precisely identify pure Server Action files, we'd check if 'use server'
    // was specifically parsed. For now, we fallback to component vs util.
  }

  // Component heuristics
  const hasReactImport = analysis.imports.some(imp => imp.includes("react"));
  const hasComponentExport = analysis.exportDetails.some(
    exp => exp.kind === "function" && /^[A-Z]/.test(exp.name)
  );

  if (hasReactImport || hasComponentExport) {
    if (analysis.isClientComponent) return "client-component";
    return "server-component";
  }

  // Default to utility if it doesn't look like a React component or special file
  return "util";
}
