import type { FileAnalysis, GraphNode } from "../../engine/src/index.js";
import type { Graph } from "graphlib";
import type { KnowledgeRegistry } from "./knowledge/registry.js";

// Re-export knowledge types so consumers of the rules package can use them
export type { KnowledgeConcept, KnowledgeConstraint } from "./knowledge/schema.js";

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

export type Severity = "error" | "warning" | "info";

// ---------------------------------------------------------------------------
// Diagnostic — enriched with semantic guidance from knowledge packs
// ---------------------------------------------------------------------------

export interface Diagnostic {
  // ── Location ──────────────────────────────────────────────────────────────
  file: string;
  line?: number;

  // ── Identity ──────────────────────────────────────────────────────────────
  severity: Severity;
  ruleId: string;
  message: string;

  // ── Knowledge-driven enrichment ──────────────────────────────────────────
  /** Why this violation matters in production Next.js applications. */
  whyItMatters?: string;

  /** Concrete, actionable quick fixes sourced from the knowledge pack. */
  quickFixes?: string[];

  /** High-level architectural recommendations for the affected domain. */
  architectureSuggestions?: string[];

  /**
   * Performance or rendering optimisation guidance relevant to this violation.
   */
  optimizationGuidance?: string[];

  /** Production risks that occur if this violation is left unaddressed. */
  productionRisks?: string[];

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
  analyses: FileAnalysis[];
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
