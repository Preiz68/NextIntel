export type CapabilityRequirement = "browser" | "server" | "node" | "edge";

export const RuntimeCapabilityRegistry: Record<string, CapabilityRequirement[]> = {
  localStorage: ["browser"],
  navigator: ["browser"],
  window: ["browser"],
  document: ["browser"],

  headers: ["server"],
  cookies: ["server"],
  draftMode: ["server"],

  process: ["node"],
  fs: ["node"],
  path: ["node"],

  EdgeRuntime: ["edge"],
};

/**
 * Returns the environment requirements for a given global/symbol API.
 */
export function getRequiredCapabilities(api: string): CapabilityRequirement[] {
  return RuntimeCapabilityRegistry[api] || [];
}

/**
 * Checks if a given API symbol is supported in a target runtime environment.
 */
export function isCapabilitySupported(api: string, env: string): boolean {
  const reqs = getRequiredCapabilities(api);
  if (reqs.length === 0) return true;

  for (const r of reqs) {
    if (r === "browser" && env === "browser") return true;
    if (r === "server" && (env === "node" || env === "edge")) return true;
    if (r === "node" && env === "node") return true;
    if (r === "edge" && env === "edge") return true;
    if (env === "shared") return true; // shared support
  }
  return false;
}
