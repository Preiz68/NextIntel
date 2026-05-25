import { analyzeFile, normalizePath } from "./packages/engine/src/index.js";
import {
  RuleEngine,
  rules,
  renderGroupedDiagnostics,
} from "./packages/rules/src/index.js";
import { Graph } from "graphlib";
import path from "node:path";
import fs from "node:fs";

function runMockTests() {
  console.log("\n=========================================");
  console.log("🧪 RUNNING MOCK DIAGNOSTICS TESTS");
  console.log("=========================================");

  const engine = new RuleEngine();
  const graph = new Graph();
  const diagnostics = engine.run({
    analyses: [],
    graph,
    nodes: new Map(),
    edges: [],
  });

  console.log(renderGroupedDiagnostics(diagnostics));
}

async function run() {
  runMockTests();

  const tempAppDir = normalizePath(path.resolve("./temp-app"));
  const tempComponentsDir = normalizePath(path.join(tempAppDir, "components"));

  // Create directories if they do not exist
  fs.mkdirSync(tempComponentsDir, { recursive: true });

  const actionsPath = normalizePath(path.join(tempAppDir, "actions.ts"));
  const serverUtilsPath = normalizePath(
    path.join(tempAppDir, "server-utils.ts"),
  );
  const clientUtilsPath = normalizePath(
    path.join(tempAppDir, "client-utils.ts"),
  );
  const serverPanelPath = normalizePath(
    path.join(tempComponentsDir, "ServerDashboard.tsx"),
  );
  const clientPanelPath = normalizePath(
    path.join(tempComponentsDir, "ClientDashboard.tsx"),
  );
  const pagePath = normalizePath(path.join(tempAppDir, "page.tsx"));
  const clientPath = normalizePath(path.join(tempAppDir, "client.tsx"));
  const helperPath = normalizePath(path.join(tempAppDir, "helper.ts"));
  const dbPath = normalizePath(path.join(tempAppDir, "db.ts"));

  const actionsCode = `// ======================================================
// FILE: app/actions.ts
// ======================================================

"use server";

import { revalidatePath } from "next/cache";

// ❌ missing auth
// ❌ missing validation
export async function updateProfile(data: any) {
  console.log(data.email);

  return {
    success: true,
  };
}

// ❌ browser API in server action
export async function saveTheme() {
  const theme = localStorage.getItem("theme");

  return theme;
}

// ❌ cache invalidation misuse
export async function updatePost(postId: string) {
  revalidatePath("/dashboard");

  return {
    updated: true,
  };
}
`.trim();

  const serverUtilsCode =
    `// ======================================================
// FILE: app/server-utils.ts
// ======================================================

import { headers, cookies } from "next/headers";

export function getRequestData() {
  const headerStore = headers();
  const cookieStore = cookies();

  return {
    userAgent: headerStore.get("user-agent"),
    token: cookieStore.get("token"),
  };
}

// ❌ browser API inside server util
export function getThemeServer() {
  return localStorage.getItem("theme");
}
`.trim();

  const clientUtilsCode =
    `// ======================================================
// FILE: app/client-utils.ts
// ======================================================

export function getClientTheme() {
  // ❌ hydration mismatch risk
  return localStorage.getItem("theme");
}

export function getLanguage() {
  // ❌ hydration mismatch risk
  return navigator.language;
}
`.trim();

  const serverPanelCode =
    `// ======================================================
// FILE: app/components/ServerDashboard.tsx
// ======================================================

import ClientDashboard from "./ClientDashboard";

export default async function ServerDashboard() {
  // ❌ browser API in server component
  const theme = localStorage.getItem("theme");

  return (
    <div>
      <h1>Server Dashboard</h1>

      <ClientDashboard theme={theme} />
    </div>
  );
}
`.trim();

  const clientPanelCode =
    `// ======================================================
// FILE: app/components/ClientDashboard.tsx
// ======================================================

"use client";

import { getRequestData } from "../server-utils";
import ServerDashboard from "./ServerDashboard";
import { getClientTheme } from "../client-utils";

// ❌ async client component
export default async function ClientDashboard({
  theme,
}: {
  theme: string | null;
}) {
  // ❌ server runtime leak
  const request = getRequestData();

  // ❌ hydration risk
  const clientTheme = getClientTheme();

  console.log(request);

  return (
    <div>
      <h2>{clientTheme}</h2>

      {/* ❌ server component imported into client */}
      <ServerDashboard />
    </div>
  );
}
`.trim();

  const pageCode = `// ======================================================
// FILE: app/page.tsx
// ======================================================

import ServerDashboard from "./components/ServerDashboard";
import ClientPage from "./components/ClientPage";

export default function Page() {
  return (
    <main>
      <ServerDashboard />
      <ClientPage />
    </main>
  );
}
`.trim();

  const clientCode = `// ======================================================
// FILE: app/components/ClientPage.tsx
// ======================================================

"use client";

import { helper } from "../helper";

export default function ClientPage() {
  // ❌ indirect server import contamination
  helper();

  return <div>Client Page</div>;
}
`.trim();

  const helperCode = `// ======================================================
// FILE: app/helper.ts
// ======================================================

import { db } from "./lib/db";

export async function helper() {
  return db.user.findMany();
}
`.trim();

  const dbCode = `// ======================================================
// FILE: app/lib/db.ts
// ======================================================

import "server-only";

import { headers } from "next/headers";

export const db = {
  user: {
    async findMany() {
      const h = headers();

      return [
        {
          id: 1,
          ua: h.get("user-agent"),
        },
      ];
    },
  },
};
`.trim();

  console.log("\n=========================================");
  console.log("📂 RUNNING ARCHITECTURAL TESTS ON REAL FILES");
  console.log("=========================================");

  // Write files to temp-app directory structure
  fs.writeFileSync(actionsPath, actionsCode, "utf8");
  fs.writeFileSync(serverUtilsPath, serverUtilsCode, "utf8");
  fs.writeFileSync(clientUtilsPath, clientUtilsCode, "utf8");
  fs.writeFileSync(serverPanelPath, serverPanelCode, "utf8");
  fs.writeFileSync(clientPanelPath, clientPanelCode, "utf8");
  fs.writeFileSync(pagePath, pageCode, "utf8");
  fs.writeFileSync(clientPath, clientCode, "utf8");
  fs.writeFileSync(helperPath, helperCode, "utf8");
  fs.writeFileSync(dbPath, dbCode, "utf8");

  const ruleEngine = new RuleEngine();
  for (const rule of rules) {
    ruleEngine.registerRule(rule);
  }

  console.log(`\n▶️ Analyzing nextintel test cases...`);

  try {
    const actionsAnalysis = await analyzeFile(actionsPath, {
      fileContent: actionsCode,
    });
    const serverUtilsAnalysis = await analyzeFile(serverUtilsPath, {
      fileContent: serverUtilsCode,
    });
    const clientUtilsAnalysis = await analyzeFile(clientUtilsPath, {
      fileContent: clientUtilsCode,
    });
    const serverPanelAnalysis = await analyzeFile(serverPanelPath, {
      fileContent: serverPanelCode,
    });
    const clientPanelAnalysis = await analyzeFile(clientPanelPath, {
      fileContent: clientPanelCode,
    });
    const pageAnalysis = await analyzeFile(pagePath, { fileContent: pageCode });
    const clientAnalysis = await analyzeFile(clientPath, {
      fileContent: clientCode,
    });
    const helperAnalysis = await analyzeFile(helperPath, {
      fileContent: helperCode,
    });
    const dbAnalysis = await analyzeFile(dbPath, { fileContent: dbCode });

    const graph = new Graph();
    graph.setNode(pagePath);
    graph.setNode(actionsPath);
    graph.setNode(serverUtilsPath);
    graph.setNode(clientUtilsPath);
    graph.setNode(clientPanelPath);
    graph.setNode(serverPanelPath);
    graph.setNode(clientPath);
    graph.setNode(helperPath);
    graph.setNode(dbPath);

    graph.setEdge(pagePath, clientPanelPath);
    graph.setEdge(pagePath, serverPanelPath);
    graph.setEdge(clientPanelPath, serverUtilsPath);
    graph.setEdge(clientPanelPath, actionsPath);
    graph.setEdge(clientPanelPath, serverPanelPath);
    graph.setEdge(clientPanelPath, clientUtilsPath);
    graph.setEdge(clientPath, helperPath);
    graph.setEdge(helperPath, dbPath);

    const nodesMap = new Map();
    nodesMap.set(pagePath, {
      id: pagePath,
      isClientComponent: false,
      isServerComponent: true,
      semanticKind: "server-component",
    });
    nodesMap.set(actionsPath, {
      id: actionsPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "server-action",
    });
    nodesMap.set(serverUtilsPath, {
      id: serverUtilsPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
    });
    nodesMap.set(clientUtilsPath, {
      id: clientUtilsPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
    });
    nodesMap.set(clientPanelPath, {
      id: clientPanelPath,
      isClientComponent: true,
      isServerComponent: false,
      semanticKind: "client-component",
    });
    nodesMap.set(serverPanelPath, {
      id: serverPanelPath,
      isClientComponent: false,
      isServerComponent: true,
      semanticKind: "server-component",
    });
    nodesMap.set(clientPath, {
      id: clientPath,
      isClientComponent: true,
      isServerComponent: false,
      semanticKind: "client-component",
    });
    nodesMap.set(helperPath, {
      id: helperPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
    });
    nodesMap.set(dbPath, {
      id: dbPath,
      isClientComponent: false,
      isServerComponent: false,
      semanticKind: "util",
    });

    const edges = [
      { from: pagePath, to: clientPanelPath },
      { from: pagePath, to: serverPanelPath },
      { from: clientPanelPath, to: serverUtilsPath },
      { from: clientPanelPath, to: actionsPath },
      { from: clientPanelPath, to: serverPanelPath },
      { from: clientPanelPath, to: clientUtilsPath },
      { from: clientPath, to: helperPath },
      { from: helperPath, to: dbPath },
    ];

    const diagnostics = ruleEngine.run({
      analyses: [
        pageAnalysis,
        actionsAnalysis,
        serverUtilsAnalysis,
        clientUtilsAnalysis,
        clientPanelAnalysis,
        serverPanelAnalysis,
        clientAnalysis,
        helperAnalysis,
        dbAnalysis,
      ],
      graph,
      nodes: nodesMap,
      edges,
    });

    console.log(
      `  • Actions Semantic Kind:        ${actionsAnalysis.semanticKind}`,
    );
    console.log(
      `  • Server Utils Semantic Kind:   ${serverUtilsAnalysis.semanticKind}`,
    );
    console.log(
      `  • Client Utils Semantic Kind:   ${clientUtilsAnalysis.semanticKind}`,
    );
    console.log(
      `  • Server Panel Semantic Kind:   ${serverPanelAnalysis.semanticKind}`,
    );
    console.log(
      `  • Client Panel Semantic Kind:   ${clientPanelAnalysis.semanticKind}`,
    );
    console.log(
      `  • Page Semantic Kind:           ${pageAnalysis.semanticKind}`,
    );
    console.log(
      `  • Client Semantic Kind:         ${clientAnalysis.semanticKind}`,
    );
    console.log(
      `  • Helper Semantic Kind:         ${helperAnalysis.semanticKind}`,
    );
    console.log(`  • DB Semantic Kind:             ${dbAnalysis.semanticKind}`);
    console.log(`  • Violations Found:             ${diagnostics.length}`);

    // Print utilizing the formatter from the core spec!
    console.log(renderGroupedDiagnostics(diagnostics));
  } catch (err) {
    console.error(`  ❌ Error in test run:`, err);
  } finally {
    // Recursive delete temp-app folder
    try {
      fs.rmSync(tempAppDir, { recursive: true, force: true });
    } catch (err) {
      // Ignore cleanup error if file locked temporarily
    }
  }
}

run();
