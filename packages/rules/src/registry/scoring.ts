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

  // 2. Adjust based on execution context/phase
  const adjusted = { ...baseProfile };
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
  let finalScore = rawScore * confidenceFactor;

  // 5. Add a small propagation penalty for deeper transitive dependencies
  if (propagationDepth > 1) {
    finalScore = Math.min(10.0, finalScore + Math.min(2.0, (propagationDepth - 1) * 0.15));
  }

  // 6. Map to SeverityLevel
  const level = toSeverityLevel(finalScore);

  return {
    score: Math.round(finalScore * 100) / 100,
    level,
    impactScores: adjusted,
  };
}

export function toSeverityLevel(score: number): SeverityLevel {
  if (score >= 8.0) return "CRITICAL";
  if (score >= 6.0) return "HIGH";
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
