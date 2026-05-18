import type { FileAnalysis } from "../analyzer/types.js";

// ---------------------------------------------------------------------------
// 1. Core Semantic Types
// ---------------------------------------------------------------------------

export type SemanticKind =
  | "page"
  | "layout"
  | "template"
  | "loading"
  | "error"
  | "not-found"
  | "global-error"
  | "default"
  | "route-handler"
  | "middleware"
  | "server-action"
  | "client-component"
  | "server-component"
  | "util"
  | "unknown";

export type RuntimeContext = "server" | "client" | "edge";

export type DynamicTrigger =
  | "cookies"
  | "headers"
  | "searchParams"
  | "noStore"
  | "force-dynamic"
  | "unstable_noStore";

// ---------------------------------------------------------------------------
// 2. Extracted Semantics
// ---------------------------------------------------------------------------

export interface RenderingSemantics {
  mode: "static" | "dynamic" | "isr" | "ppr";
  triggers: DynamicTrigger[];
  revalidate: number | "force-cache" | false;
  hasGenerateStaticParams: boolean;
}

export interface HydrationSemantics {
  isHydrationBoundary: boolean;
  hasRenderSafeBrowserApis: boolean;
  hydrationRisks: string[];
}

export interface EnhancedFetchCall {
  line: number;
  url: string | "dynamic";
  cacheStrategy: "force-cache" | "no-store" | "revalidate" | "implicit-dynamic";
  revalidateValue?: number | string | null;
  renderingImplication: "blocks-static-prerender" | "safe-static" | "dynamic-escalation";
}

// ---------------------------------------------------------------------------
// 3. The Enriched Semantic Payload
// ---------------------------------------------------------------------------

/**
 * An evolution of the raw AST FileAnalysis.
 * Contains both raw syntactical extractions (imports, exports, hooks) AND
 * the inferred Next.js framework semantic classifications.
 */
export interface SemanticFileAnalysis extends Omit<FileAnalysis, "fetchCalls"> {
  // Enhanced fetch calls with caching & rendering implications
  fetchCalls: EnhancedFetchCall[];

  // Inferred framework role
  semanticKind: SemanticKind;

  // Expected execution environment
  runtime: RuntimeContext;

  // React/Next.js rendering strategy behavior
  rendering: RenderingSemantics;

  // RSC payload boundary and client hydration status
  hydration: HydrationSemantics;

  // Knowledge layer integration (IDs of failed constraints, e.g., "SC-001")
  violatedConstraints: string[];
}
