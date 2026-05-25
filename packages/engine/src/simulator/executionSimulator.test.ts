import { ExecutionSimulator, SimulationFinding } from "./executionSimulator.js";
import type { SemanticFileAnalysis } from "../classifier/types.js";
import * as assert from "node:assert";

export function runExecutionSimulatorTests() {
  console.log("🧪 Running Execution Simulator unit tests...");

  const simulator = new ExecutionSimulator();

  // Create mock SemanticFileAnalysis payloads
  const analyses: SemanticFileAnalysis[] = [
    {
      filePath: "server-comp.tsx",
      runtime: "server",
      runtimeType: "SERVER_COMPONENT",
      isClientComponent: false,
      isServerComponent: true,
      hasTopLevelUseServer: false,
      isEdgeRuntime: false,
      imports: [],
      importDetails: [],
      exports: [],
      exportDetails: [],
      hooks: [],
      hookDetails: [],
      usesBrowserAPI: true,
      browserAPIs: [
        {
          api: "window",
          line: 12,
          column: 5,
          affectsRender: true
        }
      ],
      fetchCalls: [],
      hasAsyncComponent: false,
      errors: [],
      taintState: "TAINTED",
      taints: [],
      simulationFindings: [],
      semanticKind: "server-component",
      rendering: "server",
      hydration: "static",
      boundaries: [],
      executionModel: {
        componentType: "server",
        runtime: "node",
        usesBrowserApis: ["window"],
        usesServerApis: [],
        usesClientHooks: [],
        boundaryViolations: [],
        architectureFlags: []
      },
      violatedConstraints: []
    },
    {
      filePath: "client-comp.tsx",
      runtime: "client",
      runtimeType: "CLIENT_COMPONENT",
      isClientComponent: true,
      isServerComponent: false,
      hasTopLevelUseServer: false,
      isEdgeRuntime: false,
      imports: [],
      importDetails: [],
      exports: [],
      exportDetails: [],
      hooks: [],
      hookDetails: [],
      usesBrowserAPI: true,
      browserAPIs: [
        {
          api: "localStorage",
          line: 8,
          column: 15,
          affectsRender: true
        }
      ],
      fetchCalls: [],
      hasAsyncComponent: false,
      errors: [],
      taintState: "CONDITIONALLY_TAINTED",
      taints: [],
      simulationFindings: [],
      semanticKind: "client-component",
      rendering: "client",
      hydration: "stream",
      boundaries: [],
      executionModel: {
        componentType: "client",
        runtime: "browser",
        usesBrowserApis: ["localStorage"],
        usesServerApis: [],
        usesClientHooks: [],
        boundaryViolations: [],
        architectureFlags: []
      },
      violatedConstraints: []
    }
  ];

  const results = simulator.simulate(analyses);

  // Assertions:
  // 1. server-comp.tsx should trigger an "ssr_leak" finding
  const serverResult = results.get("server-comp.tsx");
  assert.ok(serverResult);
  assert.ok(serverResult.findings.some(f => f.type === "ssr_leak" && f.symbol === "window"));

  // 2. client-comp.tsx should trigger a "hydration_mismatch" finding (since affectsRender is true)
  const clientResult = results.get("client-comp.tsx");
  assert.ok(clientResult);
  assert.ok(clientResult.findings.some(f => f.type === "hydration_mismatch" && f.symbol === "localStorage"));

  console.log("✅ Execution Simulator unit tests passed!");
}
