import { analyzeFile, normalizePath } from "./packages/engine/src/index.js";
import {
  RuleEngine,
  rules,
  renderGroupedDiagnostics,
} from "./packages/rules/src/index.js";
import { Graph } from "graphlib";
import path from "node:path";

async function run() {
  console.log("\n=========================================");
  console.log("🧪 RUNNING STRESS TEST SUITE");
  console.log("=========================================");

  const appDir = normalizePath(path.resolve("./app"));

  const pagePath = normalizePath(path.join(appDir, "page.tsx"));
  const clientRootPath = normalizePath(path.join(appDir, "components/ClientRoot.tsx"));
  const serverPanelPath = normalizePath(path.join(appDir, "components/ServerPanel.tsx"));
  const userActionsPath = normalizePath(path.join(appDir, "actions/user-actions.ts"));
  const authPath = normalizePath(path.join(appDir, "server/auth.ts"));
  const dbPath = normalizePath(path.join(appDir, "server/db.ts"));
  const sharedUtilPath = normalizePath(path.join(appDir, "shared/shared-util.ts"));
  const helperPath = normalizePath(path.join(appDir, "shared/helper.ts"));
  const dashboardShellPath = normalizePath(path.join(appDir, "components/DashboardShell.tsx"));

  const ruleEngine = new RuleEngine();
  for (const rule of rules) {
    ruleEngine.registerRule(rule);
  }

  console.log(`\n▶️ Analyzing stress test cases...`);

  try {
    const pageAnalysis = await analyzeFile(pagePath);
    const clientRootAnalysis = await analyzeFile(clientRootPath);
    const serverPanelAnalysis = await analyzeFile(serverPanelPath);
    const userActionsAnalysis = await analyzeFile(userActionsPath);
    const authAnalysis = await analyzeFile(authPath);
    const dbAnalysis = await analyzeFile(dbPath);
    const sharedUtilAnalysis = await analyzeFile(sharedUtilPath);
    const helperAnalysis = await analyzeFile(helperPath);
    const dashboardShellAnalysis = await analyzeFile(dashboardShellPath);

    const graph = new Graph();
    graph.setNode(pagePath);
    graph.setNode(clientRootPath);
    graph.setNode(serverPanelPath);
    graph.setNode(userActionsPath);
    graph.setNode(authPath);
    graph.setNode(dbPath);
    graph.setNode(sharedUtilPath);
    graph.setNode(helperPath);
    graph.setNode(dashboardShellPath);

    // Setup import relationships (edges)
    graph.setEdge(pagePath, dashboardShellPath);
    graph.setEdge(pagePath, clientRootPath);
    graph.setEdge(pagePath, authPath);
    graph.setEdge(pagePath, sharedUtilPath);
    graph.setEdge(pagePath, userActionsPath);

    graph.setEdge(clientRootPath, serverPanelPath);
    graph.setEdge(clientRootPath, authPath);
    graph.setEdge(clientRootPath, dbPath);
    graph.setEdge(clientRootPath, sharedUtilPath);
    graph.setEdge(clientRootPath, helperPath);

    graph.setEdge(serverPanelPath, dbPath);
    graph.setEdge(userActionsPath, dbPath);
    graph.setEdge(helperPath, dbPath);

    const nodesMap = new Map();
    nodesMap.set(pagePath, {
      id: pagePath,
      filePath: pagePath,
      isClientComponent: false,
      isServerComponent: true,
      semanticKind: "page",
      runtime: "server",
      runtimeType: "SERVER_COMPONENT",
    });
    nodesMap.set(dashboardShellPath, {
      id: dashboardShellPath,
      filePath: dashboardShellPath,
      isClientComponent: true,
      isServerComponent: false,
      semanticKind: "client-component",
      runtime: "client",
      runtimeType: "CLIENT_COMPONENT",
    });
    nodesMap.set(clientRootPath, {
      id: clientRootPath,
      filePath: clientRootPath,
      isClientComponent: true,
      isServerComponent: false,
      semanticKind: "client-component",
      runtime: "client",
      runtimeType: "CLIENT_COMPONENT",
    });
    nodesMap.set(serverPanelPath, {
      id: serverPanelPath,
      filePath: serverPanelPath,
      isClientComponent: false,
      isServerComponent: true,
      semanticKind: "server-component",
      runtime: "server",
      runtimeType: "SERVER_COMPONENT",
    });
    nodesMap.set(userActionsPath, {
      id: userActionsPath,
      filePath: userActionsPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "server-action",
      runtime: "server",
      runtimeType: "SERVER_UTIL",
    });
    nodesMap.set(authPath, {
      id: authPath,
      filePath: authPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "server-util",
      runtime: "server",
      runtimeType: "SERVER_UTIL",
    });
    nodesMap.set(dbPath, {
      id: dbPath,
      filePath: dbPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "server-util",
      runtime: "server",
      runtimeType: "SERVER_UTIL",
    });
    nodesMap.set(sharedUtilPath, {
      id: sharedUtilPath,
      filePath: sharedUtilPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
      runtime: "shared",
      runtimeType: "SHARED_UTIL",
    });
    nodesMap.set(helperPath, {
      id: helperPath,
      filePath: helperPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
      runtime: "shared",
      runtimeType: "SHARED_UTIL",
    });

    const edges = [
      { from: pagePath, to: dashboardShellPath },
      { from: pagePath, to: clientRootPath },
      { from: pagePath, to: authPath },
      { from: pagePath, to: sharedUtilPath },
      { from: pagePath, to: userActionsPath },
      { from: clientRootPath, to: serverPanelPath },
      { from: clientRootPath, to: authPath },
      { from: clientRootPath, to: dbPath },
      { from: clientRootPath, to: sharedUtilPath },
      { from: clientRootPath, to: helperPath },
      { from: serverPanelPath, to: dbPath },
      { from: userActionsPath, to: dbPath },
      { from: helperPath, to: dbPath },
    ];

    const diagnostics = ruleEngine.run({
      analyses: [
        pageAnalysis,
        clientRootAnalysis,
        serverPanelAnalysis,
        userActionsAnalysis,
        authAnalysis,
        dbAnalysis,
        sharedUtilAnalysis,
        helperAnalysis,
        dashboardShellAnalysis,
      ],
      graph,
      nodes: nodesMap,
      edges,
    });

    console.log(`\n=========================================`);
    console.log(`📊 STRESS TEST SUITE RESULTS`);
    console.log(`=========================================`);
    console.log(`  • Page Semantic Kind:           ${pageAnalysis.semanticKind}`);
    console.log(`  • Client Root Semantic:         ${clientRootAnalysis.semanticKind}`);
    console.log(`  • User Actions Semantic:        ${userActionsAnalysis.semanticKind}`);
    console.log(`  • Violations Found:             ${diagnostics.length}`);
    console.log(`=========================================\n`);
    console.log("Raw Diagnostics:", JSON.stringify(diagnostics.map(d => ({ id: d.id, file: path.basename(d.file), message: d.message })), null, 2));

    console.log(renderGroupedDiagnostics(diagnostics));
  } catch (err) {
    console.error(`  ❌ Error in stress test run:`, err);
  }
}

run();
