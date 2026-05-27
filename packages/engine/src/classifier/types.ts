import type { FileAnalysis } from "../analyzer/types.js";
import type { FrameworkExecutionModel } from "../preprocessor/types.js";

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
  | "shared-util"
  | "client-util"
  | "server-util"
  | "mixed-runtime-util"
  | "unknown";

export type RuntimeContext = "server" | "client" | "edge";

export type RuntimeType =
  | "SERVER_COMPONENT"
  | "CLIENT_COMPONENT"
  | "SERVER_UTIL"
  | "SHARED_UTIL";

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
  mode: "static" | "dynamic" | "isr" | "ppr" | "conflicting-cache-intent";
  triggers: DynamicTrigger[];
  revalidate: number | "force-cache" | false | null;
  hasGenerateStaticParams: boolean;
  hasConflictingDeclarations: boolean;
}

export interface NonDeterministicExpr {
  line: number;
  expression: string;
  isSafelyDeferred: boolean;
}

export interface BrowserGlobalInRender {
  line: number;
  global: string;
  isSafelyGuarded: boolean;
}

export interface HydrationSemantics {
  isHydrationBoundary: boolean;
  hasRenderSafeBrowserApis: boolean;
  hydrationRisks: string[];
  riskLevel: "none" | "low" | "high";
  nonDeterministicExpressions: NonDeterministicExpr[];
  browserGlobalsInRender: BrowserGlobalInRender[];
}

export interface BoundarySemantics {
  hasServerOnlyApisInClient: boolean;
  hasClientHooksInServer: boolean;
  hasAsyncClientComponent: boolean;
  overHydrationRisk: boolean;
  violations: string[];
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

  runtimeType: RuntimeType;

  // React/Next.js rendering strategy behavior
  rendering: RenderingSemantics;

  // RSC payload boundary and client hydration status
  hydration: HydrationSemantics;

  // Boundary crossing and over-hydration analytics
  boundaries: BoundarySemantics;

  // Knowledge layer integration (IDs of failed constraints, e.g., "SC-001")
  violatedConstraints: string[];

  // Structured Next.js execution model pre-processed for rules
  executionModel: FrameworkExecutionModel;
}

