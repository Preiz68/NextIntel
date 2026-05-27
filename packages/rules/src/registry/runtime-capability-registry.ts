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

export interface CapabilityProfile {
  browser: boolean;          // DOM access, browser globals
  node: boolean;             // Node.js file system, native modules
  requestContext: boolean;   // cookies(), headers() request context
  edgeCompatible: boolean;   // Edge runtime compatibility
}

export function getFileCapabilityProfile(analysis: any): CapabilityProfile {
  const isClient = analysis.isClientComponent || 
                   analysis.semanticKind === "client-component" || 
                   analysis.semanticKind === "client-util";
  const isEdge = analysis.isEdgeRuntime || analysis.runtime === "edge";

  if (isClient) {
    return {
      browser: true,
      node: false,
      requestContext: false,
      edgeCompatible: false
    };
  }

  if (analysis.semanticKind === "shared-util" || analysis.semanticKind === "util") {
    return {
      browser: true,
      node: true,
      requestContext: true,
      edgeCompatible: true
    };
  }

  if (isEdge) {
    return {
      browser: false,
      node: false,
      requestContext: true,
      edgeCompatible: true
    };
  }

  // Server (Node)
  return {
    browser: false,
    node: true,
    requestContext: true,
    edgeCompatible: false
  };
}

export function checkCapabilitySatisfaction(
  profile: CapabilityProfile,
  taintType: string
): { satisfied: boolean; missing: string[] } {
  const missing: string[] = [];

  if (taintType === "SERVER_ONLY") {
    if (!profile.node && !profile.edgeCompatible) {
      missing.push("server runtime (Node/Edge)");
    }
  } else if (taintType === "NODE_NATIVE_API") {
    if (!profile.node) {
      missing.push("Node.js runtime");
    }
  } else if (taintType === "REQUEST_CONTEXT") {
    if (!profile.requestContext) {
      missing.push("Request Context (headers/cookies)");
    }
  } else if (taintType === "PROCESS_ENV") {
    if (!profile.node && !profile.edgeCompatible) {
      missing.push("server environment");
    }
  } else if (taintType === "BROWSER_ONLY") {
    if (!profile.browser) {
      missing.push("browser environment (DOM/window)");
    }
  }

  return {
    satisfied: missing.length === 0,
    missing
  };
}

