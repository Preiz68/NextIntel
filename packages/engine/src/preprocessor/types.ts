export interface FrameworkExecutionModel {
  componentType: "server" | "client" | "mixed" | "unknown";
  isAsyncComponent: boolean;
  isAsync: boolean;
  usesServerActions: boolean;
  runtime: "node" | "edge" | "browser" | "mixed" | "invalid";
  renderingMode: "static" | "dynamic" | "streaming" | "unknown";
  hydrationRiskLevel: "low" | "medium" | "high" | "critical";
  usesServerApis: string[];
  usesBrowserApis: string[];
  usesClientHooks: string[];
  usesNextRuntimeAPIs: string[];
  fetchStrategy: {
    hasFetch: boolean;
    cacheMode: string | null;
    revalidate: number | null;
    conflicts: string[];
  };
  boundaryViolations: string[];
  renderStability: {
    deterministic: boolean;
    instabilitySources: string[];
  };
  overHydrationRisk: "low" | "medium" | "high";
  architectureFlags: string[];
}

