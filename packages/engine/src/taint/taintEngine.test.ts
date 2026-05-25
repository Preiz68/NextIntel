import { TaintEngine, TaintDetails, TaintState } from "./taintEngine.js";
import { Graph } from "graphlib";
import * as assert from "node:assert";

export function runTaintEngineTests() {
  console.log("🧪 Running Taint Engine unit tests...");

  // Setup a mock module graph:
  // a.ts (Client component) imports b.ts (utility)
  // b.ts imports c.ts (server-only database helper)
  // d.ts (Server component) imports b.ts
  const graph = new Graph();
  graph.setNode("a.ts");
  graph.setNode("b.ts");
  graph.setNode("c.ts");
  graph.setNode("d.ts");

  graph.setEdge("a.ts", "b.ts");
  graph.setEdge("b.ts", "c.ts");
  graph.setEdge("d.ts", "b.ts");

  // a.ts is client component, d.ts is server component, b & c are utils
  const nodes = new Map<string, any>();
  nodes.set("a.ts", { id: "a.ts", isClientComponent: true, semanticKind: "client-component" });
  nodes.set("b.ts", { id: "b.ts", semanticKind: "util" });
  nodes.set("c.ts", { id: "c.ts", semanticKind: "util" });
  nodes.set("d.ts", { id: "d.ts", isServerComponent: true, semanticKind: "server-component" });

  // Define direct taints: c.ts has a SERVER_ONLY taint
  const directTaintsMap = new Map<string, TaintDetails[]>();
  directTaintsMap.set("c.ts", [
    {
      state: "TAINTED",
      type: "SERVER_ONLY",
      source: "next/headers",
      line: 5,
      expression: "cookies()"
    }
  ]);
  directTaintsMap.set("a.ts", []);
  directTaintsMap.set("b.ts", []);
  directTaintsMap.set("d.ts", []);

  const taintEngine = new TaintEngine(
    ["a.ts", "b.ts", "c.ts", "d.ts"],
    graph,
    nodes,
    directTaintsMap
  );

  const results = taintEngine.propagate();

  // Assertions:
  // 1. c.ts must be TAINTED
  const cTaint = results.get("c.ts");
  assert.ok(cTaint);
  assert.strictEqual(cTaint.overallState, "TAINTED");

  // 2. b.ts must be TAINTED (transitive propagation)
  const bTaint = results.get("b.ts");
  assert.ok(bTaint);
  assert.strictEqual(bTaint.overallState, "TAINTED");
  assert.ok(bTaint.taints.some(t => t.source === "next/headers"));

  // 3. a.ts (Client component) must be TAINTED (imported b.ts which is tainted)
  const aTaint = results.get("a.ts");
  assert.ok(aTaint);
  assert.strictEqual(aTaint.overallState, "TAINTED");

  // 4. Test CONDITIONALLY_TAINTED propagation
  // Setup a mock graph:
  // x.ts (Server component) imports y.ts (utility containing conditional browser global guard)
  // z.ts (Client component) imports y.ts
  const graphCond = new Graph();
  graphCond.setNode("x.ts");
  graphCond.setNode("y.ts");
  graphCond.setNode("z.ts");

  graphCond.setEdge("x.ts", "y.ts");
  graphCond.setEdge("z.ts", "y.ts");

  const nodesCond = new Map<string, any>();
  nodesCond.set("x.ts", { id: "x.ts", isServerComponent: true, semanticKind: "server-component" });
  nodesCond.set("y.ts", { id: "y.ts", semanticKind: "util" });
  nodesCond.set("z.ts", { id: "z.ts", isClientComponent: true, semanticKind: "client-component" });

  const directTaintsCond = new Map<string, TaintDetails[]>();
  directTaintsCond.set("y.ts", [
    {
      state: "CONDITIONALLY_TAINTED",
      type: "BROWSER_ONLY",
      source: "window",
      line: 10,
      expression: "if (typeof window !== 'undefined') window.localStorage"
    }
  ]);
  directTaintsCond.set("x.ts", []);
  directTaintsCond.set("z.ts", []);

  const taintEngineCond = new TaintEngine(
    ["x.ts", "y.ts", "z.ts"],
    graphCond,
    nodesCond,
    directTaintsCond
  );

  const resultsCond = taintEngineCond.propagate();

  // y.ts itself should be CONDITIONALLY_TAINTED
  const yTaint = resultsCond.get("y.ts");
  assert.ok(yTaint);
  assert.strictEqual(yTaint.overallState, "CONDITIONALLY_TAINTED");

  // x.ts (Server Component) should remain CLEAN because CONDITIONALLY_TAINTED does not propagate to Server contexts
  const xTaint = resultsCond.get("x.ts");
  assert.ok(xTaint);
  assert.strictEqual(xTaint.overallState, "CLEAN");

  // z.ts (Client Component) should be CONDITIONALLY_TAINTED (propagates into client runtime contexts)
  const zTaint = resultsCond.get("z.ts");
  assert.ok(zTaint);
  assert.strictEqual(zTaint.overallState, "CONDITIONALLY_TAINTED");

  console.log("✅ Taint Engine unit tests passed!");
}
