/**
 * boundary-resolver.ts
 *
 * Deterministic Next.js App Router execution model.
 *
 * This module replaces AI reasoning with an explicit model of:
 *   - WHERE code executes (Node.js / Browser / Webpack / Mutation Boundary)
 *   - WHEN it executes (which phase in the App Router pipeline)
 *   - WHAT runtime context exists at that moment
 *
 * Next.js App Router execution timeline:
 *
 *   1. rsc-render                Server — builds React tree, no browser APIs
 *   2. bundler-graph-resolution  Webpack — resolves client/server module split
 *   3. hydration                 Browser — syncs server HTML with React fiber
 *   4. client-render             Browser — React reconciler handles updates
 *   5. server-action-execution   Server — POST mutation boundary
 */

import type { ExecutionPhase } from "../types.js";

// ---------------------------------------------------------------------------
// Input model
// ---------------------------------------------------------------------------

export interface FileMeta {
  /** Semantic kind from SemanticFileAnalysis */
  kind: string;
  /** Whether the file declares 'use client' */
  isClientComponent: boolean;
  /** Whether the file is a Server Component */
  isServerComponent: boolean;
  /** Whether the file is a server action module */
  isServerAction: boolean;
  /** Absolute path — used for heuristic matching */
  filePath: string;
}

export interface NodeContext {
  /** True when the violation involves a browser-only global (localStorage, window…) */
  isHydrationSensitive: boolean;
  /** True when the violation is an import crossing client→server */
  isClientToServerImport: boolean;
}

// ---------------------------------------------------------------------------
// Runtime environment labels (output metadata only)
// ---------------------------------------------------------------------------

export type RuntimeEnv =
  | "Node.js (Server Runtime)"
  | "Browser (Client Runtime)"
  | "Webpack (Build Engine)"
  | "Server Runtime (Mutation Boundary)";

export interface BoundaryResolution {
  phase: ExecutionPhase;
  runtime: RuntimeEnv;
  stageOrder: number;
  stageLabel: string;
}

// ---------------------------------------------------------------------------
// Phase → runtime mapping (complete, exhaustive)
// ---------------------------------------------------------------------------

const PHASE_META: Record<ExecutionPhase, Omit<BoundaryResolution, "phase">> = {
  "RSC_RENDER": {
    runtime: "Node.js (Server Runtime)",
    stageOrder: 1,
    stageLabel: "RSC tree construction",
  },
  "BUNDLER_RESOLUTION": {
    runtime: "Webpack (Build Engine)",
    stageOrder: 2,
    stageLabel: "module graph resolution",
  },
  "HYDRATION": {
    runtime: "Browser (Client Runtime)",
    stageOrder: 3,
    stageLabel: "client-side hydration",
  },
  "CLIENT_RENDER": {
    runtime: "Browser (Client Runtime)",
    stageOrder: 4,
    stageLabel: "client fiber reconciliation",
  },
  "SERVER_ACTION": {
    runtime: "Server Runtime (Mutation Boundary)",
    stageOrder: 5,
    stageLabel: "mutation invocation",
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the precise execution phase and runtime for a given violation.
 *
 * Priority order matches the App Router execution model:
 *   1. Server action files → always mutation boundary
 *   2. Client-to-server import edges → always bundler phase
 *   3. Client components with hydration-sensitive APIs → hydration phase
 *   4. Client components (general) → client render
 *   5. Server components / pages / layouts → RSC render
 */
export function resolveBoundary(
  fileMeta: FileMeta,
  nodeCtx: NodeContext,
): BoundaryResolution {
  let phase: ExecutionPhase;

  if (fileMeta.isServerAction || fileMeta.kind === "server-action") {
    phase = "SERVER_ACTION";
  } else if (nodeCtx.isClientToServerImport) {
    phase = "BUNDLER_RESOLUTION";
  } else if (fileMeta.isClientComponent && nodeCtx.isHydrationSensitive) {
    phase = "HYDRATION";
  } else if (fileMeta.isClientComponent) {
    phase = "CLIENT_RENDER";
  } else {
    phase = "RSC_RENDER";
  }

  return { phase, ...PHASE_META[phase] };
}

/**
 * Look up phase metadata directly without computing from file context.
 * Used when the phase is already known (e.g. from the rule spec's phases[]).
 */
export function phaseMetadata(phase: ExecutionPhase): BoundaryResolution {
  return { phase, ...PHASE_META[phase] };
}
