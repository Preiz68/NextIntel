export * from "./types.js";
export * from "./registry/engine.js";

import { noHooksInServerComponents } from "./server-client/no-hooks-in-server-components.js";
import { noBrowserApiInServerComponents } from "./server-client/no-browser-api-in-server-components.js";
import { noClientImportServerOnly } from "./server-client/no-client-import-server-only.js";
import { fetchCacheConfig } from "./caching/fetch-cache-config.js";
import { noCircularDeps } from "./architecture/no-circular-deps.js";
import { noUnoptimizedFetch } from "./performance/no-unoptimized-fetch.js";
import { noBrowserGlobalsInClientRender } from "./hydration/no-browser-globals-in-client-render.js";

export const rules = [
  noHooksInServerComponents,
  noBrowserApiInServerComponents,
  noClientImportServerOnly,
  fetchCacheConfig,
  noCircularDeps,
  noUnoptimizedFetch,
  noBrowserGlobalsInClientRender,
];
