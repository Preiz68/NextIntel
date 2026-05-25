import { analyzeFile } from "./packages/engine/src/index.js";
import { RuleEngine, rules } from "./packages/rules/src/index.js";
import path from "node:path";
import fs from "node:fs";

const clientUtilsCode = `
"use client";

import { useEffect, useState } from "react";

export function getSessionFromBrowser() {
  return localStorage.getItem(
    "session"
  );
}

export function logAnalyticsClientSide() {
  navigator.sendBeacon(
    "/analytics"
  );
}

export function useMountedTheme() {
  const [theme, setTheme] =
    useState("light");

  useEffect(() => {
    setTheme(
      localStorage.getItem("theme") ||
        "light"
    );
  }, []);

  return theme;
}
`.trim();

const filePath = path.resolve("./temp-client-utils.ts");
fs.writeFileSync(filePath, clientUtilsCode, "utf8");

try {
  const analysis = await analyzeFile(filePath, { fileContent: clientUtilsCode });
  console.log("Analysis Semantic Kind:", analysis.semanticKind);
  console.log("usesBrowserApis:", analysis.executionModel.usesBrowserApis);
  console.log("browserAPIs:", JSON.stringify(analysis.browserAPIs, null, 2));

  const ruleEngine = new RuleEngine();
  for (const rule of rules) {
    ruleEngine.registerRule(rule);
  }

  const diagnostics = ruleEngine.run({
    analyses: [analysis],
    graph: null as any,
    nodes: new Map(),
    edges: [],
  });

  console.log("Diagnostics:", diagnostics);
} catch (e) {
  console.error(e);
} finally {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
