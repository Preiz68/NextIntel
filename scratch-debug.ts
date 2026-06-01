import { analyzeFile } from "./packages/engine/src/index.js";
import { RuleEngine, rules } from "./packages/rules/src/index.js";
import path from "node:path";
import fs from "node:fs";

const code = `
"use server";
export const getSimilarEventBySlug = async (slug: string) => {
  return [];
}
`.trim();

const filePath = path.resolve("./action-temp.ts");
fs.writeFileSync(filePath, code, "utf8");

try {
  const analysis = await analyzeFile(filePath, { fileContent: code });
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

  console.log("\nDiagnostics returned:");
  console.log(JSON.stringify(diagnostics, null, 2));

} catch (e) {
  console.error(e);
} finally {
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}
