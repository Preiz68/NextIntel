"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  RuleEngine: () => RuleEngine,
  rules: () => rules
});
module.exports = __toCommonJS(index_exports);

// src/registry/engine.ts
var RuleEngine = class {
  rules = [];
  registerRule(rule) {
    this.rules.push(rule);
  }
  run(context) {
    const allDiagnostics = [];
    for (const rule of this.rules) {
      try {
        const diagnostics = rule.run(context);
        allDiagnostics.push(...diagnostics);
      } catch (err) {
        console.error(`Error running rule ${rule.id}:`, err.message);
      }
    }
    return allDiagnostics;
  }
};

// src/server-client/no-hooks-in-server-components.ts
var noHooksInServerComponents = {
  id: "no-hooks-in-server-components",
  meta: {
    description: "React hooks can only be used in Client Components.",
    severity: "error"
  },
  run(context) {
    const diagnostics = [];
    for (const analysis of context.analyses) {
      if (analysis.isServerComponent && analysis.hooks.length > 0) {
        diagnostics.push({
          file: analysis.filePath,
          severity: "error",
          ruleId: "no-hooks-in-server-components",
          message: `File uses React hooks (${analysis.hooks.join(", ")}) but is a Server Component. Add "use client" at the top.`,
          fix: `"use client";

` + analysis.filePath
        });
      }
    }
    return diagnostics;
  }
};

// src/server-client/no-browser-api-in-server-components.ts
var noBrowserApiInServerComponents = {
  id: "no-browser-api-in-server-components",
  meta: {
    description: "Browser APIs (window, document, etc.) cannot be used in Server Components.",
    severity: "error"
  },
  run(context) {
    const diagnostics = [];
    for (const analysis of context.analyses) {
      if (analysis.isServerComponent && analysis.usesBrowserAPI) {
        const apis = analysis.browserAPIs.map((a) => a.api).join(", ");
        diagnostics.push({
          file: analysis.filePath,
          severity: "error",
          ruleId: "no-browser-api-in-server-components",
          message: `File uses browser APIs (${apis}) but is a Server Component. These APIs are only available in Client Components.`,
          fix: `"use client";`
        });
      }
    }
    return diagnostics;
  }
};

// src/server-client/no-client-import-server-only.ts
var noClientImportServerOnly = {
  id: "no-client-import-server-only",
  meta: {
    description: "Client Components cannot import Server-only modules or Server Actions directly.",
    severity: "error"
  },
  run(context) {
    const diagnostics = [];
    for (const edge of context.edges || []) {
      const fromNode = context.nodes.get(edge.from);
      const toNode = context.nodes.get(edge.to);
      if (fromNode?.isClientComponent && toNode?.isServerComponent) {
        diagnostics.push({
          file: edge.from,
          severity: "error",
          ruleId: "no-client-import-server-only",
          message: `Client Component imports Server Component/Module: ${edge.to}. This will cause a runtime error if rendered directly.`,
          fix: "Pass the Server Component as 'children' or a prop instead of importing it directly."
        });
      }
    }
    return diagnostics;
  }
};

// src/caching/fetch-cache-config.ts
var fetchCacheConfig = {
  id: "fetch-cache-config",
  meta: {
    description: "Fetch calls in Next.js should have explicit cache or revalidate configuration.",
    severity: "warning"
  },
  run(context) {
    const diagnostics = [];
    for (const analysis of context.analyses) {
      for (const fetchCall of analysis.fetchCalls) {
        if (!fetchCall.hasCacheConfig && !fetchCall.hasRevalidate) {
          diagnostics.push({
            file: analysis.filePath,
            severity: "warning",
            ruleId: "fetch-cache-config",
            message: "Implicit fetch caching detected. Consider adding explicit { cache: '...' } or { next: { revalidate: ... } }.",
            fix: "{ cache: 'no-store' }"
          });
        }
      }
    }
    return diagnostics;
  }
};

// ../engine/src/graph/detectCycles.ts
function detectCycles(graph) {
  const colors = /* @__PURE__ */ new Map();
  const cycles = [];
  for (const node of graph.nodes()) {
    colors.set(node, "white");
  }
  function dfs(start) {
    const stack = [
      { node: start, iterator: graph.successors(start) ?? [] }
    ];
    const path = [start];
    const inPath = /* @__PURE__ */ new Set([start]);
    colors.set(start, "gray");
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top === void 0) break;
      if (top.iterator.length === 0) {
        colors.set(top.node, "black");
        path.pop();
        inPath.delete(top.node);
        stack.pop();
        continue;
      }
      const neighbor = top.iterator.shift();
      if (neighbor === void 0) continue;
      const color = colors.get(neighbor);
      if (color === "gray" && inPath.has(neighbor)) {
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
          iterator: graph.successors(neighbor) ?? []
        });
      }
    }
  }
  for (const node of graph.nodes()) {
    if (colors.get(node) === "white") {
      dfs(node);
    }
  }
  function normalizeKey(cycle) {
    const minIdx = cycle.reduce(
      (best, node, i) => node < cycle[best] ? i : best,
      0
    );
    const rotated = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    return rotated.join("|");
  }
  const seen = /* @__PURE__ */ new Set();
  const unique = cycles.filter((cycle) => {
    const key = normalizeKey(cycle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    hasCycles: unique.length > 0,
    cycles: unique
  };
}

// src/architecture/no-circular-deps.ts
var noCircularDeps = {
  id: "no-circular-deps",
  meta: {
    description: "Circular dependencies should be avoided as they can cause runtime issues and poor maintainability.",
    severity: "warning"
  },
  run(context) {
    const diagnostics = [];
    const cycleReport = detectCycles(context.graph);
    if (cycleReport.hasCycles) {
      for (const cycle of cycleReport.cycles) {
        diagnostics.push({
          file: cycle[0],
          // Report on the first file of the cycle
          severity: "warning",
          ruleId: "no-circular-deps",
          message: `Circular dependency detected: ${cycle.join(" -> ")}`
        });
      }
    }
    return diagnostics;
  }
};

// src/index.ts
var rules = [
  noHooksInServerComponents,
  noBrowserApiInServerComponents,
  noClientImportServerOnly,
  fetchCacheConfig,
  noCircularDeps
];
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  RuleEngine,
  rules
});
