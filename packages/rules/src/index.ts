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

// Framework Knowledge Layer — typed semantic database of Next.js APIs
export { frameworkRegistry, FrameworkRegistry } from "./knowledge/framework-registry.js";
export type { FrameworkAPI, SemanticContext, FrameworkRuntime } from "./knowledge/framework-registry.js";

// ── Rendering Layer Rules ────────────────────────────────────────────────────
import { noHooksInServerComponents } from "./rendering/no-hooks-in-server-components.js";
import { noBrowserApiInServerComponents } from "./rendering/no-browser-api-in-server-components.js";
import { noClientImportServerOnly } from "./rendering/no-client-import-server-only.js";
import { noBrowserGlobalsInClientRender } from "./rendering/no-browser-globals-in-client-render.js";
import { requireGenerateStaticParams } from "./rendering/require-generate-static-params.js";
import { streamingSuspenseBoundaries } from "./rendering/streaming-suspense-boundaries.js";
import { noEventHandlersInServerComponents } from "./rendering/no-event-handlers-in-server-components.js";
import { noContextInServerComponents } from "./rendering/no-context-in-server-components.js";
import { noMutationsInServerRender } from "./rendering/no-mutations-in-server-render.js";
import { propsMustBeSerializable } from "./rendering/props-must-be-serializable.js";
import { wrapThirdPartyComponents } from "./rendering/wrap-third-party-components.js";
import { noRouteHandlersInClientComponents } from "./rendering/no-route-handlers-in-client-components.js";
import { noAsyncClientComponents } from "./rendering/no-async-client-components.js";
import { noServerApiInClientComponents } from "./rendering/no-server-api-in-client-components.js";

// ── Data Layer Rules ─────────────────────────────────────────────────────────
import { fetchCacheConfig } from "./data/fetch-cache-config.js";
import { revalidationCacheLifetime } from "./data/revalidation-cache-lifetime.js";

// ── Architecture Layer Rules ──────────────────────────────────────────────────
import { noCircularDeps } from "./architecture/no-circular-deps.js";
import { routingValidFiles } from "./architecture/routing-valid-files.js";
import { runtimeExecutionLimits } from "./architecture/runtime-execution-limits.js";
import { middlewareRuntimeConstraints } from "./architecture/middleware-runtime-constraints.js";
import { serverActionsAuth } from "./architecture/server-actions-auth.js";
import { serverActionsSerialization } from "./architecture/server-actions-serialization.js";
import { serverActionsNoReads } from "./architecture/server-actions-no-reads.js";
import { serverActionsValidation } from "./architecture/server-actions-validation.js";
import { serverActionsVsHandlers } from "./architecture/server-actions-vs-handlers.js";
import { serverActionsBrowserApi } from "./architecture/server-actions-browser-api.js";

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
  noEventHandlersInServerComponents,
  noContextInServerComponents,
  noMutationsInServerRender,
  propsMustBeSerializable,
  wrapThirdPartyComponents,
  noRouteHandlersInClientComponents,
  noAsyncClientComponents,
  noServerApiInClientComponents,

  // Data Layer
  fetchCacheConfig,
  revalidationCacheLifetime,

  // Architecture Layer
  noCircularDeps,
  routingValidFiles,
  runtimeExecutionLimits,
  middlewareRuntimeConstraints,
  serverActionsAuth,
  serverActionsSerialization,
  serverActionsNoReads,
  serverActionsValidation,
  serverActionsVsHandlers,
  serverActionsBrowserApi,

  // Production Layer
  noUnoptimizedFetch,
  securityNoPublicSecrets,
  observabilityTelemetry,
];
