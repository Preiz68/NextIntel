import { scanProject } from "../scanner/index.js";
import { analyzeFiles } from "../analyzer/index.js";
import { buildGraph, toAsciiTree, summarizeGraph } from "./index.js";

const root = process.argv[2] ?? process.cwd();

const { files } = await scanProject(root);
const analyses = await analyzeFiles(files);
const { graph, nodes } = buildGraph(analyses, root);

// 1. ASCII tree from the first entry point
const summary = summarizeGraph(graph, nodes);
const entryPoint = summary.entryPoints[0];

if (entryPoint) {
  console.log("\n── Dependency Tree ──────────────────────────\n");
  console.log(toAsciiTree(graph, entryPoint, nodes));
}

// 2. Cycle report
console.log("\n── Cycles ───────────────────────────────────");
if (summary.cycles.hasCycles) {
  summary.cycles.cycles.forEach((cycle, i) => {
    console.log(`\nCycle ${i + 1}:`);
    cycle.forEach((node, j) => {
      console.log(
        `  ${j === 0 ? "┌" : j === cycle.length - 1 ? "└" : "├"} ${node}`,
      );
    });
  });
} else {
  console.log("No cycles detected ✓");
}

// 3. Summary
console.log("\n── Summary ──────────────────────────────────");
console.log(`  Nodes        : ${summary.totalNodes}`);
console.log(`  Edges        : ${summary.totalEdges}`);
console.log(`  Entry points : ${summary.entryPoints.length}`);
console.log(`  Sinks        : ${summary.sinks.length}`);
console.log(`  Client files : ${summary.clientNodes.length}`);
console.log(`  Server files : ${summary.serverNodes.length}`);

console.log("\n── Most Imported ────────────────────────────");
summary.mostImported.slice(0, 5).forEach(({ id, count }) => {
  console.log(`  ${count}x  ${id.split("/").pop()}`);
});
