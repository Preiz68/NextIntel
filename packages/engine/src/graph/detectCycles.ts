import { Graph } from "graphlib";
import type { CycleReport } from "./types.js";

type Color = "white" | "gray" | "black";

export function detectCycles(graph: Graph): CycleReport {
  if (!graph) return { hasCycles: false, cycles: [] };
  const colors = new Map<string, Color>();
  const cycles: string[][] = [];

  for (const node of graph.nodes()) {
    colors.set(node, "white");
  }

  function dfs(start: string): void {
    const stack: Array<{ node: string; iterator: string[] }> = [
      { node: start, iterator: graph.successors(start) ?? [] },
    ];
    const path: string[] = [start];
    const inPath = new Set<string>([start]);

    colors.set(start, "gray");

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === undefined) break;

      if (top.iterator.length === 0) {
        colors.set(top.node, "black");
        path.pop();
        inPath.delete(top.node);
        stack.pop();
        continue;
      }

      const neighbor = top.iterator.shift();
      if (neighbor === undefined) continue;

      const color = colors.get(neighbor);

      if (color === "gray" && inPath.has(neighbor)) {
        // Extract exactly the nodes that form this cycle (no trailing duplicate).
        const cycleStart = path.indexOf(neighbor);
        const cycle = path.slice(cycleStart);
        cycles.push(cycle);
        continue;
      }

      if (color === "white") {
        colors.set(neighbor, "gray");
        path.push(neighbor);
        inPath.add(neighbor);
        stack.push({
          node: neighbor,
          iterator: graph.successors(neighbor) ?? [],
        });
      }
    }
  }

  for (const node of graph.nodes()) {
    if (colors.get(node) === "white") {
      dfs(node);
    }
  }

  // Deduplicate by rotating each cycle to its lexicographically smallest node
  // first, then joining — preserves direction, collapses rotations of the same cycle.
  function normalizeKey(cycle: string[]): string {
    const minIdx = cycle.reduce(
      (best, node, i) => (node < cycle[best]! ? i : best),
      0,
    );
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    return rotated.join("|");
  }

  const seen = new Set<string>();
  const unique = cycles.filter((cycle) => {
    const key = normalizeKey(cycle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    hasCycles: unique.length > 0,
    cycles: unique,
  };
}

export function getCyclicNodes(report: CycleReport): Set<string> {
  const nodes = new Set<string>();
  for (const cycle of report.cycles) {
    for (const node of cycle) nodes.add(node);
  }
  return nodes;
}
