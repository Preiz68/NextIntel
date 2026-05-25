import type { ExecutionPhase, SeverityLevel, ImpactScores } from "../types.js";


// ---------------------------------------------------------------------------
// Contextual phase multipliers applied PER-DIMENSION
// ---------------------------------------------------------------------------

/** When a violation executes in the browser, it cannot affect server load. */
const BROWSER_PHASES = new Set<ExecutionPhase>(["client-render", "hydration"]);

/** When a violation executes at the bundler level it does not affect runtime rendering. */
const BUNDLER_PHASES = new Set<ExecutionPhase>(["bundler-graph-resolution"]);

/** When a violation executes at the server-action boundary. */
const ACTION_PHASES = new Set<ExecutionPhase>(["server-action-execution"]);

// ---------------------------------------------------------------------------
// Rule-specific impact score profiles
// ---------------------------------------------------------------------------
// Each key matches a constraint ID emitted by the rules engine.
// All values are in the range 0-10.

export const RULE_SCORING_PROFILES: Record<string, ImpactScores> = {

  // ── Server Component rules ──────────────────────────────────────────────

  "SC-BROWSER-API-001": {
    hydration:   6,
    rendering:  10,
    bundleSize:  0,
    caching:     2,
    security:    0,
    serverLoad:  9,
  },

  "SC-HOOK-USAGE-001": {
    hydration:   7,
    rendering:  10,
    bundleSize:  0,
    caching:     2,
    security:    0,
    serverLoad:  9,
  },

  "SC-EVENT-HANDLER-001": {
    hydration:   5,
    rendering:   9,
    bundleSize:  1,
    caching:     1,
    security:    1,
    serverLoad:  7,
  },

  "SC-CONTEXT-001": {
    hydration:   5,
    rendering:   8,
    bundleSize:  0,
    caching:     1,
    security:    0,
    serverLoad:  6,
  },

  "SC-MUTATION-001": {
    hydration:   6,
    rendering:   7,
    bundleSize:  0,
    caching:     8,
    security:    4,
    serverLoad:  7,
  },

  "SC-SERIALIZATION-001": {
    hydration:   8,
    rendering:   8,
    bundleSize:  3,
    caching:     2,
    security:    2,
    serverLoad:  5,
  },

  "SC-THIRD-PARTY-001": {
    hydration:   5,
    rendering:   8,
    bundleSize:  6,
    caching:     2,
    security:    3,
    serverLoad:  7,
  },

  // ── Client Component rules ──────────────────────────────────────────────

  "CC-ASYNC-CLIENT-001": {
    hydration:  10,
    rendering:  10,
    bundleSize: 10,
    caching:     8,
    security:    0,
    serverLoad:  0, // This is a client-only crash — no server load impact
  },

  "CC-RUNTIME-LEAK-001": {
    hydration:   6,
    rendering:   9,
    bundleSize:  8,
    caching:     3,
    security:    7,
    serverLoad:  0, // Executes in client bundle — no server load impact
  },

  "CC-SERVER-IMPORT-001": {
    hydration:   4,
    rendering:   7,
    bundleSize: 10,
    caching:     5,
    security:    8,
    serverLoad:  0, // Bundler-phase violation — no server runtime load
  },

  "CC-ROUTE-HANDLER-001": {
    hydration:   2,
    rendering:   5,
    bundleSize:  2,
    caching:     8,
    security:    3,
    serverLoad:  6,
  },

  // ── Hydration rules ─────────────────────────────────────────────────────

  "HY-RENDER-BROWSER-API-001": {
    hydration:  10,
    rendering:   8,
    bundleSize:  0,
    caching:     4,
    security:    0,
    serverLoad:  0, // Browser-side mismatch — no server load impact
  },

  // ── Server Action rules ─────────────────────────────────────────────────

  "SA-AUTH-001": {
    hydration:   3,
    rendering:   5,
    bundleSize:  0,
    caching:     2,
    security:   10,
    serverLoad:  7,
  },

  "SA-VALIDATION-001": {
    hydration:   2,
    rendering:   4,
    bundleSize:  0,
    caching:     2,
    security:    9,
    serverLoad:  6,
  },

  "SA-SERIALIZATION-001": {
    hydration:   2,
    rendering:   7,
    bundleSize:  2,
    caching:     3,
    security:    3,
    serverLoad:  6,
  },

  "SA-MUTATION-READ-001": {
    hydration:   0,
    rendering:   2,
    bundleSize:  0,
    caching:     9,
    security:    1,
    serverLoad:  8,
  },

  "SA-READ-ACTION-001": {
    hydration:   0,
    rendering:   2,
    bundleSize:  0,
    caching:     9,
    security:    1,
    serverLoad:  8,
  },

  "SA-BROWSER-API-001": {
    hydration:   0,
    rendering:  10,
    bundleSize:  0,
    caching:     2,
    security:    0,
    serverLoad:  9,
  },

  "SA-ROUTE-HANDLER-001": {
    hydration:   1,
    rendering:   3,
    bundleSize:  1,
    caching:     5,
    security:    6,
    serverLoad:  5,
  },

  // ── Architecture / production / data rules (fallback IDs) ──────────────

  "CA-001": {
    hydration:   0,
    rendering:   2,
    bundleSize:  0,
    caching:    10,
    security:    1,
    serverLoad:  6,
  },

  "RV-002": {
    hydration:   1,
    rendering:   3,
    bundleSize:  0,
    caching:    10,
    security:    0,
    serverLoad:  5,
  },

  "BD-003": {
    hydration:   2,
    rendering:   4,
    bundleSize:  5,
    caching:     3,
    security:    2,
    serverLoad:  4,
  },

  "RO-002": {
    hydration:   0,
    rendering:   3,
    bundleSize:  1,
    caching:     2,
    security:    1,
    serverLoad:  2,
  },

  "RU-001": {
    hydration:   2,
    rendering:   5,
    bundleSize:  0,
    caching:     2,
    security:    3,
    serverLoad:  8,
  },

  "MW-002": {
    hydration:   1,
    rendering:   4,
    bundleSize:  2,
    caching:     4,
    security:    5,
    serverLoad:  6,
  },

  "DF-001": {
    hydration:   1,
    rendering:   5,
    bundleSize:  2,
    caching:     9,
    security:    1,
    serverLoad:  8,
  },

  "SE-001": {
    hydration:   0,
    rendering:   2,
    bundleSize:  5,
    caching:     1,
    security:   10,
    serverLoad:  2,
  },

  "OB-002": {
    hydration:   0,
    rendering:   1,
    bundleSize:  1,
    caching:     1,
    security:    2,
    serverLoad:  4,
  },

  "RU-001-CRITICAL": {
    hydration:  10,
    rendering:  10,
    bundleSize: 10,
    caching:    10,
    security:   10,
    serverLoad: 10,
  },

  "RU-001-HIGH": {
    hydration:   8,
    rendering:   8,
    bundleSize:  8,
    caching:     8,
    security:    8,
    serverLoad:  8,
  },
};

/** Default profile applied when a rule ID is not found in RULE_SCORING_PROFILES. */
const DEFAULT_PROFILE: ImpactScores = {
  hydration:  5,
  rendering:  5,
  bundleSize: 3,
  caching:    3,
  security:   3,
  serverLoad: 3,
};

// ---------------------------------------------------------------------------
// Contextual weighting: apply phase-specific dimension overrides
// ---------------------------------------------------------------------------

function applyPhaseContextWeighting(
  scores: ImpactScores,
  phase: ExecutionPhase,
): ImpactScores {
  const adjusted = { ...scores };

  if (BROWSER_PHASES.has(phase)) {
    // Client-only violations cannot contribute to server compute load
    adjusted.serverLoad = 0;
  }

  if (BUNDLER_PHASES.has(phase)) {
    // Build-time violations don't cause runtime rendering crashes directly
    adjusted.rendering = Math.min(adjusted.rendering, 7);
    // But they do affect bundle size heavily — let that score stand
    adjusted.serverLoad = 0;
  }

  if (ACTION_PHASES.has(phase)) {
    // Server action crashes don't cause hydration mismatches
    adjusted.hydration = Math.min(adjusted.hydration, 3);
  }

  return adjusted;
}

// ---------------------------------------------------------------------------
// Weighted overall severity formula
// ---------------------------------------------------------------------------
// Weights must sum to 1.0:
//   Security            = 0.40
//   Runtime Crash       = 0.25
//   Boundary Violation  = 0.20
//   Propagation Depth   = 0.10
//   Cache Impact        = 0.05

function computeOverallSeverity(scores: ImpactScores, propagationDepth: number = 1): number {
  const security = scores.security;
  const runtimeCrash = scores.rendering;
  const boundaryViolation = Math.max(scores.hydration, scores.bundleSize);
  const cacheImpact = scores.caching;
  const propDepth = Math.min(10, propagationDepth);

  return (
    security * 0.40 +
    runtimeCrash * 0.25 +
    boundaryViolation * 0.20 +
    propDepth * 0.10 +
    cacheImpact * 0.05
  );
}

// ---------------------------------------------------------------------------
// Public types and exports
// ---------------------------------------------------------------------------

export interface ScoringResult {
  score: number;
  level: SeverityLevel;
  impactScores: ImpactScores;
}

/**
 * Calculate a multi-dimensional, context-aware severity score for a constraint.
 *
 * @param ruleId   - The constraint ID (e.g. "CC-ASYNC-CLIENT-001", "SA-AUTH-001")
 * @param phase    - The execution phase in which the violation occurs
 * @param confidence - Detection confidence factor (0-1); adjusts score slightly
 * @param propagationDepth - Traced dependency path depth
 */
export function calculateSeverityScore(
  ruleId: string,
  phase: ExecutionPhase,
  confidence: number = 1.0,
  propagationDepth: number = 1,
  isGuarded: boolean = false,
): ScoringResult {
  // 1. Look up base profile (fall back to defaults for unmapped rules)
  const baseProfile = RULE_SCORING_PROFILES[ruleId] ?? DEFAULT_PROFILE;

  // 2. Apply contextual phase weighting
  const contextualScores = applyPhaseContextWeighting(baseProfile, phase);

  // 3. Compute overall severity via weighted formula
  let rawOverall = computeOverallSeverity(contextualScores, propagationDepth);

  if (isGuarded) {
    rawOverall = Math.min(3.5, rawOverall * 0.5);
  }

  // 4. Adjust slightly for confidence (0.8 at minimum confidence, 1.0 at full)
  const confidenceFactor = 0.8 + 0.2 * Math.min(1.0, Math.max(0.0, confidence));
  const adjustedScore = rawOverall * confidenceFactor;

  // 5. Map to SeverityLevel
  const level = toSeverityLevel(adjustedScore);

  return {
    score: Math.round(adjustedScore * 100) / 100,
    level,
    impactScores: contextualScores,
  };
}

export function toSeverityLevel(score: number): SeverityLevel {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  return "LOW";
}

export function toDiagnosticSeverity(
  level: SeverityLevel,
): "error" | "warning" | "info" {
  if (level === "CRITICAL" || level === "HIGH") return "error";
  if (level === "MEDIUM") return "warning";
  return "info";
}
