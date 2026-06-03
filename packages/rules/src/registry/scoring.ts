import type { ExecutionPhase, SeverityLevel, RuleCategory } from "../types.js";
import { getRuleSpec } from "./rule-registry.js";

// ---------------------------------------------------------------------------
// Multi-axis Risk Vector
// ---------------------------------------------------------------------------

export interface RiskVector {
  rendering: number;   // SSR/RSC impact
  hydration: number;   // hydration mismatch risk
  security: number;    // leakage / auth risk
  bundle: number;      // client size impact
  runtime: number;     // runtime crash probability
  cache: number;       // invalidation / caching risk
}

// ---------------------------------------------------------------------------
// Rule Category Base Impacts
// ---------------------------------------------------------------------------

export const RULE_IMPACT: Record<RuleCategory, RiskVector> = {
  CLIENT_GRAPH_LEAK: {
    rendering: 8,
    runtime: 10,
    security: 9,
    bundle: 10,
    hydration: 0,
    cache: 0,
  },
  RSC_API_VIOLATION: {
    rendering: 7,
    runtime: 10,
    security: 0,
    bundle: 0,
    hydration: 0,
    cache: 3,
  },
  HYDRATION_MISMATCH: {
    rendering: 6,
    hydration: 10,
    security: 0,
    bundle: 0,
    runtime: 0,
    cache: 0,
  },
  SERVER_ACTION_MISUSE: {
    rendering: 0,
    runtime: 8,
    security: 7,
    bundle: 0,
    hydration: 0,
    cache: 0,
  },
  DYNAMIC_RENDER_TRIGGER: {
    rendering: 8,
    runtime: 0,
    security: 0,
    bundle: 0,
    hydration: 0,
    cache: 8,
  },
};

// ---------------------------------------------------------------------------
// Rule-specific Risk Vector Profiles
// ---------------------------------------------------------------------------

export const RULE_SCORING_PROFILES: Record<string, RiskVector> = {
  "SC-BROWSER-API-001": { rendering: 10, hydration: 6, security: 0, bundle: 0, runtime: 10, cache: 2 },
  "SC-HOOK-USAGE-001": { rendering: 10, hydration: 7, security: 0, bundle: 0, runtime: 10, cache: 2 },
  "SC-EVENT-HANDLER-001": { rendering: 9, hydration: 5, security: 1, bundle: 1, runtime: 8, cache: 1 },
  "SC-CONTEXT-001": { rendering: 8, hydration: 5, security: 0, bundle: 0, runtime: 7, cache: 1 },
  "SC-MUTATION-001": { rendering: 7, hydration: 6, security: 4, bundle: 0, runtime: 7, cache: 8 },
  "SC-SERIALIZATION-001": { rendering: 8, hydration: 8, security: 2, bundle: 3, runtime: 6, cache: 2 },
  "SC-THIRD-PARTY-001": { rendering: 8, hydration: 5, security: 3, bundle: 6, runtime: 7, cache: 2 },

  "CC-ASYNC-CLIENT-001": { rendering: 10, hydration: 10, security: 0, bundle: 10, runtime: 10, cache: 8 },
  "CC-RUNTIME-LEAK-001": { rendering: 9, hydration: 6, security: 7, bundle: 8, runtime: 9, cache: 3 },
  "CC-SERVER-IMPORT-001": { rendering: 7, hydration: 4, security: 8, bundle: 10, runtime: 7, cache: 5 },
  "CC-ROUTE-HANDLER-001": { rendering: 5, hydration: 2, security: 3, bundle: 2, runtime: 4, cache: 8 },

  "HY-RENDER-BROWSER-API-001": { rendering: 8, hydration: 10, security: 0, bundle: 0, runtime: 6, cache: 4 },
  "HY-NON-DETERMINISTIC-001": { rendering: 6, hydration: 10, security: 0, bundle: 0, runtime: 5, cache: 3 },
  "HY-RENDER-MUTATION-001": { rendering: 7, hydration: 8, security: 2, bundle: 0, runtime: 6, cache: 5 },


  "SA-AUTH-001": { rendering: 5, hydration: 3, security: 10, bundle: 0, runtime: 7, cache: 2 },
  "SA-VALIDATION-001": { rendering: 4, hydration: 2, security: 9, bundle: 0, runtime: 6, cache: 2 },
  "SA-SERIALIZATION-001": { rendering: 7, hydration: 2, security: 3, bundle: 2, runtime: 6, cache: 3 },
  "SA-MUTATION-READ-001": { rendering: 2, hydration: 0, security: 1, bundle: 0, runtime: 3, cache: 9 },
  "SA-BROWSER-API-001": { rendering: 10, hydration: 0, security: 0, bundle: 0, runtime: 10, cache: 2 },

  "RU-001-CRITICAL": { rendering: 10, hydration: 10, security: 10, bundle: 10, runtime: 10, cache: 10 },
  "RU-001-HIGH": { rendering: 8, hydration: 8, security: 8, bundle: 8, runtime: 8, cache: 8 },

  "DYNAMIC_RENDER_TRIGGER-001": { rendering: 5, hydration: 0, security: 0, bundle: 0, runtime: 3, cache: 8 },
  "DYNAMIC_RENDER_TRIGGER-003": { rendering: 8, hydration: 0, security: 0, bundle: 0, runtime: 6, cache: 8 },
  "RSC_API_VIOLATION-005": { rendering: 9, hydration: 0, security: 0, bundle: 0, runtime: 9, cache: 3 },
  "DF-007": { rendering: 10, hydration: 0, security: 10, bundle: 10, runtime: 10, cache: 8 },
  "RO-006": { rendering: 9, hydration: 0, security: 0, bundle: 0, runtime: 7, cache: 8 },
  "CC-HYDRATION-ABUSE-001": { rendering: 4, hydration: 9, security: 0, bundle: 9, runtime: 6, cache: 2 },
  "DF-009": { rendering: 3, hydration: 0, security: 0, bundle: 0, runtime: 4, cache: 7 },
  "DF-010": { rendering: 3, hydration: 0, security: 0, bundle: 0, runtime: 4, cache: 7 },
};

const DEFAULT_PROFILE: RiskVector = {
  rendering: 5,
  hydration: 5,
  security: 3,
  bundle: 3,
  runtime: 5,
  cache: 3,
};

// ---------------------------------------------------------------------------
// Weighted deterministic score calculation
// ---------------------------------------------------------------------------

const WEIGHTS = {
  runtime: 0.30,
  security: 0.25,
  rendering: 0.15,
  hydration: 0.15,
  bundle: 0.10,
  cache: 0.05,
};

function normalize(v: RiskVector) {
  return {
    rendering: (v.rendering || 0) / 10,
    hydration: (v.hydration || 0) / 10,
    security: (v.security || 0) / 10,
    bundle: (v.bundle || 0) / 10,
    runtime: (v.runtime || 0) / 10,
    cache: (v.cache || 0) / 10,
  };
}

export function score(v: RiskVector): number {
  const n = normalize(v);
  return (
    n.runtime * WEIGHTS.runtime +
    n.security * WEIGHTS.security +
    n.rendering * WEIGHTS.rendering +
    n.hydration * WEIGHTS.hydration +
    n.bundle * WEIGHTS.bundle +
    n.cache * WEIGHTS.cache
  ) * 10;
}

export interface ScoringResult {
  score: number;
  level: SeverityLevel;
  impactScores: RiskVector;
}

const HARD_GATED_SCORES: Record<string, number> = {
  // ── BLOCKER: Runtime fatal — crash or security leak ─────────────────────────
  // These are the ONLY rules that map to "error" severity.
  // Criteria: will throw at runtime OR leak secrets to the client.
  "CC-RUNTIME-LEAK-001": 9.5,
  "CC-SERVER-IMPORT-001": 9.5,
  "SA-BROWSER-API-001": 9.5,
  "SC-BROWSER-API-001": 9.5,
  "CC-ASYNC-CLIENT-001": 9.8,
  "RO-003": 9.2,          // missing default.tsx → 404 on reload (runtime fatal)
  "SC-MUTATION-001": 9.0,
  "no-mutations-in-server-render": 9.0,
  "RU-001-CRITICAL": 10.0,
  "SC-HOOK-USAGE-001": 9.5,
  "no-hooks-in-server-components": 9.5,
  "SC-EVENT-HANDLER-001": 9.0,
  "no-event-handlers-in-server-components": 9.0,
  "SC-CONTEXT-001": 9.0,
  "no-context-in-server-components": 9.0,

  // RE-003-EXPORT: output:'export' mode + missing generateStaticParams = build failure
  "RE-003-EXPORT": 9.5,

  // ── HIGH: Architecture break — degrades performance or breaks caching ────────
  // Maps to "warning" severity. Does NOT crash, but hurts production quality.
  "rendering-require-generate-static-params": 7.0,
  "RE-003": 7.0,
  "fetch-cache-config": 6.5,
  "DYNAMIC_RENDER_TRIGGER-001": 6.5,
  "DYNAMIC_RENDER_TRIGGER-003": 6.0,
  "DYNAMIC_RENDER_TRIGGER-004": 6.0,
  "DF-007": 7.8,
  "RO-006": 6.5,
  "LAYOUT_AUTH_GATE": 3.0,
  "RO-007": 6.0,
  "RE-003-OPT": 3.0,
  "RV-003": 7.0,
  "RE-005": 3.0,
  "PF-007": 3.0,
  "SC-SECURITY-002": 8.0,
  "CC-HYDRATION-ABUSE-001": 5.5,
  "DF-009": 3.5,
  "DF-010": 4.5,

  // ── DF-005: Waterfall severity tiered by latency saved ───────────────────────
  // Tier reflects actual impact: not all waterfalls are equal.
  "DF-005-MAJOR":    7.5,   // ≥500ms saved   → HIGH → warning (strong)
  "DF-005-MODERATE": 6.0,   // 100–499ms saved → HIGH → warning
  "DF-005-MINOR":    3.0,   // <100ms saved   → LOW  → info
  "DF-005":          6.0,   // fallback for legacy callers

  // ── WARNING: Dynamic layout — performance tradeoff, not a crash ──────────────
  // cookies()/headers() in layouts forces dynamic rendering, but streaming still works.
  // Severity depends on cookie purpose and layout depth.
  "DYNAMIC_LAYOUT_IMPACT-CRITICAL": 7.5,  // Cookie drives conditional subtree render
  "DYNAMIC_LAYOUT_IMPACT-AUTH":     6.0,  // Auth/session cookie — disables caching for all users
  "DYNAMIC_LAYOUT_IMPACT":          5.5,  // Unknown cookie purpose, root layout (default)
  "DYNAMIC_LAYOUT_IMPACT-NESTED":   4.0,  // Unknown cookie purpose, nested layout
  "DYNAMIC_LAYOUT_IMPACT-COSMETIC": 2.5,  // Theme/locale cookie — low impact, INFO

  // ── INFO: Streaming opportunity / best-practice advisory ────────────────────
  // RO-005 base score; engine scales UP based on fetchCount/isWaterfall.
  // single fetch → INFO (3.0), multiple fetches → WARNING (5.5), waterfall → HIGH (7.0)
  "RO-005": 3.0,

  // ── RE-003-DYNAMIC: Route is already dynamic — generateStaticParams not required ─
  "RE-003-DYNAMIC": 2.0,

  // ── INFO: Low-risk observations ────────────────────────────────────────────
  "DF-006": 3.0,
  "CA-006": 2.0,
  "DYNAMIC_RENDER_TRIGGER-004-ANALYTICS": 1.5, // analytics mutations are fire-and-forget
};

/**
 * Calculate a multi-dimensional, context-aware severity score for a constraint.
 */
export function calculateSeverityScore(
  ruleId: string,
  phase: ExecutionPhase,
  confidence: number = 1.0,
  propagationDepth: number = 1,
  isGuarded: boolean = false,
): ScoringResult {
  // 1. Resolve base profile
  let baseProfile = RULE_SCORING_PROFILES[ruleId];
  if (!baseProfile) {
    const spec = getRuleSpec(ruleId);
    if (spec && spec.category && RULE_IMPACT[spec.category]) {
      baseProfile = RULE_IMPACT[spec.category];
    } else {
      baseProfile = DEFAULT_PROFILE;
    }
  }

  const adjusted = { ...baseProfile };

  // Check for hard-gated overrides
  let finalScore = HARD_GATED_SCORES[ruleId];
  if (finalScore !== undefined) {
    if (isGuarded) {
      finalScore = Math.min(3.5, finalScore * 0.5);
    }
    const level = toSeverityLevel(finalScore);
    return {
      score: Math.round(finalScore * 100) / 100,
      level,
      impactScores: adjusted,
    };
  }

  // 2. Adjust based on execution context/phase
  if (phase === "CLIENT_RENDER" || phase === "HYDRATION") {
    // Browser phases don't crash Node server runtimes
    adjusted.rendering = Math.max(0, adjusted.rendering - 2);
  }

  // 3. Compute overall severity via deterministic formula
  let rawScore = score(adjusted);

  if (isGuarded) {
    rawScore = Math.min(3.5, rawScore * 0.5);
  }

  // 4. Adjust slightly for confidence (0.8 at minimum confidence, 1.0 at full)
  const confidenceFactor = 0.8 + 0.2 * Math.min(1.0, Math.max(0.0, confidence));
  let computedScore = rawScore * confidenceFactor;

  // 5. Add a small propagation penalty for deeper transitive dependencies
  if (propagationDepth > 1) {
    computedScore = Math.min(10.0, computedScore + Math.min(2.0, (propagationDepth - 1) * 0.15));
  }

  // 6. Map to SeverityLevel
  const level = toSeverityLevel(computedScore);

  return {
    score: Math.round(computedScore * 100) / 100,
    level,
    impactScores: adjusted,
  };
}

export function toSeverityLevel(score: number): SeverityLevel {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 6.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  return "LOW";
}

/**
 * Maps a SeverityLevel to the diagnostic-facing severity string.
 *
 * Tier mapping:
 * - CRITICAL (≥9.0) → "error"   : runtime crashes, secret leaks, 404s on reload
 * - HIGH     (≥6.0) → "warning" : breaks caching / static optimization at scale
 * - MEDIUM   (≥4.0) → "warning" : performance tradeoff, not a crash (e.g. layout dynamic impact)
 * - LOW      (<4.0) → "info"    : best-practice advisory / streaming opportunity
 */
export function toDiagnosticSeverity(
  level: SeverityLevel,
): "error" | "warning" | "info" {
  if (level === "CRITICAL") return "error";
  if (level === "HIGH" || level === "MEDIUM") return "warning";
  return "info";
}

/**
 * Context-aware score override for rules whose severity must scale
 * based on runtime metadata attached to the diagnostic.
 *
 * Called by engine.ts AFTER the base score is resolved, allowing rules
 * to pass context (fetchCount, isWaterfall, layoutDepth) that drives
 * severity escalation without baking it into the static HARD_GATED_SCORES table.
 *
 * Note: Purpose-specific DYNAMIC_LAYOUT_IMPACT IDs (-AUTH, -COSMETIC, -CRITICAL, -NESTED)
 * are directly scored via HARD_GATED_SCORES — no override needed.
 * DF-005 tier IDs (-MINOR, -MODERATE, -MAJOR) are also directly scored.
 *
 * @returns Overridden score, or the original baseScore if no context match.
 */
export function applyContextualScoreOverride(
  ruleId: string,
  baseScore: number,
  context: {
    fetchCount?: number;
    isWaterfall?: boolean;
    layoutDepth?: number; // 0 = root layout, 1+ = nested
    isCriticalLayoutPath?: boolean; // Auth/session/tenant layout awaits
  },
): number {
  // ── RO-005: Suspense Streaming Opportunity ─────────────────────────────────
  // Scale: INFO (single fetch) → WARNING (parallel) → HIGH (sequential waterfall)
  if (ruleId === "RO-005") {
    const { fetchCount = 1, isWaterfall = false } = context;
    if (isWaterfall) {
      // Sequential awaits without Promise.all = definite latency waterfall
      return 7.0; // HIGH → maps to warning (architecture concern)
    }
    if (fetchCount >= 2) {
      // Multiple fetches in one component = streaming opportunity worth flagging
      return 5.5; // MEDIUM → maps to warning
    }
    // Single fetch: async component without Suspense is valid, just an INFO hint
    return 3.0; // LOW → maps to info
  }

  // ── RO-006: Layout Await Blocks Rendering ──────────────────────────────────
  if (ruleId === "RO-006") {
    if (context.isCriticalLayoutPath) {
      return 3.0; // LOW → maps to info (auth/session/tenant layouts are expected to block)
    }
    return baseScore; // Default 6.5 -> warning
  }

  // ── DYNAMIC_LAYOUT_IMPACT: fallback for generic/unknown cookie purpose ──────
  // Purpose-specific IDs (DYNAMIC_LAYOUT_IMPACT-AUTH, -COSMETIC, -CRITICAL, -NESTED)
  // are already scored via HARD_GATED_SCORES and need no contextual override.
  // This branch only handles the legacy generic ID as a depth-aware fallback.
  if (ruleId === "DYNAMIC_LAYOUT_IMPACT") {
    const depth = context.layoutDepth ?? 0;
    if (depth === 0) {
      return 5.5; // MEDIUM → warning: affects entire app's caching (unknown cookie purpose)
    }
    return 4.0; // MEDIUM → warning: affects only nested subtree
  }

  return baseScore;
}

// ---------------------------------------------------------------------------
// Audit & ROI Metadata
// ---------------------------------------------------------------------------

export interface RuleAuditMetadata {
  effort: number; // in minutes
  impact: "Huge" | "Medium" | "Small";
  category: "🚫 ARCHITECTURAL VIOLATIONS" | "⚠️ PERFORMANCE RISKS" | "💡 OPTIMIZATION OPPORTUNITIES";
}

const AUDIT_METADATA_MAP: Record<string, RuleAuditMetadata> = {
  // ── Blocker / Architectural Violations ──────────────────────────────────────
  "CC-RUNTIME-LEAK-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "CC-SERVER-IMPORT-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SA-BROWSER-API-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SC-BROWSER-API-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "CC-ASYNC-CLIENT-001": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "RO-003": { effort: 1, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SC-MUTATION-001": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "no-mutations-in-server-render": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "RU-001-CRITICAL": { effort: 15, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SC-HOOK-USAGE-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "no-hooks-in-server-components": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SC-EVENT-HANDLER-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "no-event-handlers-in-server-components": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SC-CONTEXT-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "no-context-in-server-components": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "RE-003-EXPORT": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SA-AUTH-001": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SA-VALIDATION-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "SA-SERIALIZATION-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "HY-RENDER-BROWSER-API-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "HY-NON-DETERMINISTIC-001": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "HY-RENDER-MUTATION-001": { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "DF-007": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "DYNAMIC_LAYOUT_IMPACT-CRITICAL": { effort: 15, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "DYNAMIC_LAYOUT_IMPACT-AUTH": { effort: 10, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },
  "DYNAMIC_RENDER_TRIGGER-004": { effort: 2, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" },

  // ── Performance Risks ──────────────────────────────────────────────────────
  "RE-003": { effort: 5, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "fetch-cache-config": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DYNAMIC_RENDER_TRIGGER-001": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DYNAMIC_RENDER_TRIGGER-003": { effort: 10, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DF-001": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DF-005": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DF-005-MAJOR": { effort: 5, impact: "Huge", category: "⚠️ PERFORMANCE RISKS" },
  "DF-005-MODERATE": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DF-005-MINOR": { effort: 2, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DYNAMIC_LAYOUT_IMPACT": { effort: 10, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "DYNAMIC_LAYOUT_IMPACT-NESTED": { effort: 10, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "RO-006": { effort: 10, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "RO-007": { effort: 5, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "RV-003": { effort: 2, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "CC-HYDRATION-ABUSE-001": { effort: 5, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" },
  "SC-SECURITY-002": { effort: 5, impact: "Medium", category: "🚫 ARCHITECTURAL VIOLATIONS" },

  // ── Optimization Opportunities ──────────────────────────────────────────────
  "RO-005": { effort: 20, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "LAYOUT_AUTH_GATE": { effort: 1, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "RE-003-OPT": { effort: 2, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "RE-005": { effort: 5, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "PF-007": { effort: 5, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DYNAMIC_LAYOUT_IMPACT-COSMETIC": { effort: 5, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "RE-003-DYNAMIC": { effort: 1, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DF-006": { effort: 10, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "CA-006": { effort: 10, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DYNAMIC_RENDER_TRIGGER-004-ANALYTICS": { effort: 1, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DF-009": { effort: 5, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" },
  "DF-010": { effort: 10, impact: "Medium", category: "💡 OPTIMIZATION OPPORTUNITIES" },
};

export function getRuleAuditMetadata(
  ruleId: string,
  severityLevel: SeverityLevel,
  context?: {
    fetchCount?: number;
    isWaterfall?: boolean;
    layoutDepth?: number;
  }
): RuleAuditMetadata {
  // Context-aware overrides first
  if (ruleId === "RO-005" && context) {
    if (context.isWaterfall) {
      return { effort: 15, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" };
    }
    if (context.fetchCount && context.fetchCount >= 2) {
      return { effort: 20, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" };
    }
  }

  const mapped = AUDIT_METADATA_MAP[ruleId];
  if (mapped) return mapped;

  // Fallbacks based on severity level
  if (severityLevel === "CRITICAL") {
    return { effort: 5, impact: "Huge", category: "🚫 ARCHITECTURAL VIOLATIONS" };
  } else if (severityLevel === "HIGH" || severityLevel === "MEDIUM") {
    return { effort: 5, impact: "Medium", category: "⚠️ PERFORMANCE RISKS" };
  } else {
    return { effort: 10, impact: "Small", category: "💡 OPTIMIZATION OPPORTUNITIES" };
  }
}
