import type { SemanticKind, RuntimeType } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import path from "node:path";

/**
 * Derives the semantic role of the file based on Next.js App Router conventions
 * and AST findings (directives, imports, exports).
 */
export function detectSemanticKind(analysis: FileAnalysis): SemanticKind {
  const ext = path.extname(analysis.filePath);
  const basename = path.basename(analysis.filePath, ext);
  const normalizedPath = analysis.filePath.replace(/\\/g, "/");

  // 1. App Router Route Conventions
  if (basename === "page") return "page";
  if (basename === "layout") return "layout";
  if (basename === "template") return "template";
  if (basename === "loading") return "loading";
  if (basename === "error") return "error";
  if (basename === "not-found") return "not-found";
  if (basename === "global-error") return "global-error";
  if (basename === "default") return "default";

  // App Router API Routes
  if (basename === "route") return "route-handler";

  // Next.js Middleware
  if (basename === "middleware") return "middleware";

  // 2. Directives Checking
  if (analysis.hasTopLevelUseServer) {
    return "server-action";
  }

  // 3. Client Module (Explicit Directive)
  if (analysis.isClientComponent) {
    const hasReactImport = analysis.imports.some(imp => 
      imp.includes("react") || 
      imp.includes("next/link") || 
      imp.includes("next/image")
    );
    const hasComponentExport = analysis.exportDetails.some(
      exp => (exp.kind === "function" || exp.kind === "variable") && 
             (exp.name === "default" || /^[A-Z]/.test(exp.name))
    );
    if (hasReactImport || hasComponentExport) {
      return "client-component";
    }
    return "client-util";
  }

  // 4. Shared Module (No runtime behavior: no server/browser taints)
  const hasServerTaint = analysis.taints.some(t => t.type === "SERVER_ONLY" || t.type === "NODE_NATIVE_API" || t.type === "REQUEST_CONTEXT");
  const hasBrowserTaint = analysis.taints.some(t => t.type === "BROWSER_ONLY");

  if (!hasServerTaint && !hasBrowserTaint) {
    return "shared-util";
  }

  if (hasBrowserTaint && !hasServerTaint) {
    return "client-util";
  }

  // 5. Default to Server Module
  const hasComponentExport = analysis.exportDetails.some(
    exp => (exp.kind === "function" || exp.kind === "variable") && 
           (exp.name === "default" || /^[A-Z]/.test(exp.name))
  );
  if (hasComponentExport) {
    return "server-component";
  }
  return "server-util";
}

export function detectRuntimeType(semanticKind: SemanticKind): RuntimeType {
  switch (semanticKind) {
    case "client-component":
      return "CLIENT_COMPONENT";
    case "server-component":
    case "page":
    case "layout":
    case "template":
    case "loading":
    case "error":
    case "not-found":
    case "global-error":
    case "default":
      return "SERVER_COMPONENT";
    case "server-action":
    case "route-handler":
    case "middleware":
    case "server-util":
      return "SERVER_UTIL";
    default:
      return "SHARED_UTIL";
  }
}
