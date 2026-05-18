// Core types and engine
export * from "./types.js";
export * from "./registry/engine.js";

// Knowledge registry — exported so the VS Code extension and other consumers
// can query the registry independently of running the rule engine.
export { KnowledgeRegistry } from "./knowledge/registry.js";
export type {
  KnowledgeConcept,
  KnowledgeConstraint,
  KnowledgeExamples,
} from "./knowledge/schema.js";

// ── Rendering Layer Rules ────────────────────────────────────────────────────
import { noHooksInServerComponents } from "./rendering/no-hooks-in-server-components.js";
import { noBrowserApiInServerComponents } from "./rendering/no-browser-api-in-server-components.js";
import { noClientImportServerOnly } from "./rendering/no-client-import-server-only.js";
import { noBrowserGlobalsInClientRender } from "./rendering/no-browser-globals-in-client-render.js";
import { requireGenerateStaticParams } from "./rendering/require-generate-static-params.js";
import { streamingSuspenseBoundaries } from "./rendering/streaming-suspense-boundaries.js";

// ── Data Layer Rules ─────────────────────────────────────────────────────────
import { fetchCacheConfig } from "./data/fetch-cache-config.js";
import { revalidationCacheLifetime } from "./data/revalidation-cache-lifetime.js";

// ── Architecture Layer Rules ──────────────────────────────────────────────────
import { noCircularDeps } from "./architecture/no-circular-deps.js";
import { routingValidFiles } from "./architecture/routing-valid-files.js";
import { runtimeExecutionLimits } from "./architecture/runtime-execution-limits.js";
import { middlewareRuntimeConstraints } from "./architecture/middleware-runtime-constraints.js";

// ── Production Layer Rules ───────────────────────────────────────────────────
import { noUnoptimizedFetch } from "./production/no-unoptimized-fetch.js";
import { securityNoPublicSecrets } from "./production/security-no-public-secrets.js";
import { observabilityTelemetry } from "./production/observability-telemetry.js";

export const rules = [
  // Rendering Layer
  noHooksInServerComponents,
  noBrowserApiInServerComponents,
  noClientImportServerOnly,
  noBrowserGlobalsInClientRender,
  requireGenerateStaticParams,
  streamingSuspenseBoundaries,

  // Data Layer
  fetchCacheConfig,
  revalidationCacheLifetime,

  // Architecture Layer
  noCircularDeps,
  routingValidFiles,
  runtimeExecutionLimits,
  middlewareRuntimeConstraints,

  // Production Layer
  noUnoptimizedFetch,
  securityNoPublicSecrets,
  observabilityTelemetry,
];
