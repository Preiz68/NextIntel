import type { SemanticFileAnalysis, GraphNode } from "engine";
import type { Graph } from "graphlib";
import type { KnowledgeRegistry } from "./knowledge/registry.js";

// Re-export knowledge types so consumers of the rules package can use them
export type {
  KnowledgeConcept,
  KnowledgeConstraint,
} from "./knowledge/schema.js";

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info";
export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * How safe / authoritative the primary fix recommendation is.
 *
 * - HIGH   : deterministic, officially documented by Next.js, architecture-safe
 * - MEDIUM : correct fix that requires structural refactoring or has valid trade-offs
 * - LOW    : workaround, partial mitigation, or context-dependent suppression
 */
export type FixConfidence = "HIGH" | "MEDIUM" | "LOW";

/**
 * Multi-dimensional architecture impact scores attached to every scored violation.
 * All values are in the range 0–10.
 */
export interface ImpactScores {
  /** Likelihood / severity of a React hydration mismatch */
  hydration: number;
  /** Rendering breakage — crashes, blank pages, fiber errors */
  rendering: number;
  /** Client bundle size bloat caused by the violation */
  bundleSize: number;
  /** Next.js / browser cache invalidation or bypass severity */
  caching: number;
  /** Exposure of sensitive data, auth bypasses, injection risk */
  security: number;
  /** Excess server CPU/memory load, unnecessary DB round-trips */
  serverLoad: number;
}

export type ExecutionPhase =
  | "rsc-render"
  | "client-render"
  | "hydration"
  | "server-action-execution"
  | "bundler-graph-resolution";

export type RuleCategory =
  | "security"
  | "runtime"
  | "hydration"
  | "architecture"
  | "bundler";

export type ExecutionOwnership =
  | "server-only"
  | "client-only"
  | "shared-isomorphic"
  | "server-entry"
  | "client-entry"
  | "edge-runtime"
  | "action-runtime";

export type RuntimeEnvironment = "node" | "browser" | "edge" | "shared";

export type BoundaryType =
  | "RSC_RENDER"
  | "CLIENT_RENDER"
  | "SERVER_ACTION_EXECUTION"
  | "ROUTE_HANDLER_EXECUTION"
  | "HYDRATION";

export type BoundaryTransition =
  | "client-to-server"
  | "server-to-client"
  | "server-to-browser-api"
  | "hydration-divergence"
  | "action-to-db"
  | "edge-to-node";

export type RuleKind =
  | "security"
  | "runtime"
  | "hydration"
  | "architecture"
  | "performance"
  | "bundle"
  | "cache";

export type DetectionMode = "deterministic" | "heuristic" | "graph-inferred";

// ---------------------------------------------------------------------------
// RuleSpec — the canonical data object for every rule (Option A)
// Owned exclusively by rule-registry.ts. Rule files carry detection only.
// ---------------------------------------------------------------------------

export interface RuleSpec {
  /** Constraint ID — e.g. "SA-AUTH-001" */
  id: string;

  /** Human-readable rule name */
  name: string;

  /** Category used by the scoring engine weight table */
  category: RuleCategory;

  /** Base severity weight 1–10, fed into scoring formula */
  severityBase: number;

  /** Execution phases where this rule is active */
  phases: ExecutionPhase[];

  /** AST / import / pattern matchers (informational — detection is in run()) */
  triggers: {
    nodeType?: string[];
    imports?: string[];
    patterns?: RegExp[];
  };

  /** Which Next.js boundary this rule guards */
  boundary: string;

  /** Structured violation message — machine-generated output fields */
  message: {
    cause: string;
    impact: string;
    ruleExplanation: string;
  };

  /** Fix recommendations surfaced in the output formatter */
  fix: {
    primary: string;
    /**
     * How authoritative the primary fix is.
     * HIGH = canonical framework-recommended fix.
     * MEDIUM = correct but involves architectural refactoring.
     * LOW = workaround / suppression that may not address the root cause.
     */
    confidence?: FixConfidence;
    /** One-sentence explanation of why the fix has this confidence rating. */
    confidenceReason?: string;
    architecture?: string;
    alternatives?: string[];
  };

  severity: SeverityLevel;
  kind: RuleKind;
  confidence: number;
  detectionMode: DetectionMode;
}

// ---------------------------------------------------------------------------
// Diagnostic — enriched with semantic guidance from knowledge packs
// ---------------------------------------------------------------------------

export interface Diagnostic {
  // ── Location ──────────────────────────────────────────────────────────────
  file: string;
  line?: number;
  column?: number;

  // ── Identity ──────────────────────────────────────────────────────────────
  severity: Severity;
  ruleId: string;
  id: string; // Constraint ID (e.g. SC-BROWSER-API-001)
  message: string;
  isGuarded?: boolean;

  // ── Knowledge-driven enrichment ──────────────────────────────────────────
  /** Why this violation matters in production Next.js applications. */
  whyItMatters: string;

  /** Concrete, actionable quick fixes sourced from the knowledge pack. */
  quickFixes: string[];

  /** High-level architectural recommendations for the affected domain. */
  architectureSuggestions: string[];

  /** Performance or rendering optimisation guidance relevant to this violation. */
  optimizationGuidance: string[];

  /** Production risks that occur if this violation is left unaddressed. */
  productionRisks: string[];

  /**
   * Code examples from the knowledge pack (valid / invalid patterns).
   * Keys are "valid" and "invalid".
   */
  examples?: {
    valid: string[];
    invalid: string[];
  };

  /**
   * Legacy single-fix string — preserved for backward compatibility with
   * consumers that only read `fix`. Prefer `quickFixes` in new code.
   */
  fix?: string;
}

// ---------------------------------------------------------------------------
// RuleContext — the full evaluation context passed to every rule
// ---------------------------------------------------------------------------

export interface RuleContext {
  analyses: SemanticFileAnalysis[];
  graph: Graph;
  nodes: Map<string, GraphNode>;
  edges: any[];

  /**
   * The global knowledge registry, loaded once at engine start-up.
   * Rules use this to query constraints, forbidden patterns, fixes, and
   * architectural guidance from the knowledge packs at evaluation time.
   */
  knowledgeRegistry: KnowledgeRegistry;
}

// ---------------------------------------------------------------------------
// Rule — the contract every rule must satisfy
// ---------------------------------------------------------------------------

export interface Rule {
  id: string;

  meta: {
    description: string;
    severity: Severity;
  };

  run(context: RuleContext): Diagnostic[];
}
