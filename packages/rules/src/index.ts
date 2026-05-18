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

// Rules
import { noHooksInServerComponents } from "./server-client/no-hooks-in-server-components.js";
import { noBrowserApiInServerComponents } from "./server-client/no-browser-api-in-server-components.js";
import { noClientImportServerOnly } from "./server-client/no-client-import-server-only.js";
import { fetchCacheConfig } from "./caching/fetch-cache-config.js";
import { noCircularDeps } from "./architecture/no-circular-deps.js";
import { noUnoptimizedFetch } from "./performance/no-unoptimized-fetch.js";
import { noBrowserGlobalsInClientRender } from "./hydration/no-browser-globals-in-client-render.js";
import { requireGenerateStaticParams } from "./rendering/require-generate-static-params.js";

export const rules = [
  noHooksInServerComponents,
  noBrowserApiInServerComponents,
  noClientImportServerOnly,
  fetchCacheConfig,
  noCircularDeps,
  noUnoptimizedFetch,
  noBrowserGlobalsInClientRender,
  requireGenerateStaticParams,
];
