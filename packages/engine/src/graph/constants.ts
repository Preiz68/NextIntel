import type { GraphNode } from "./types.js";

// Path segment patterns used to classify a file's role in the project.
export const KIND_PATTERNS: Record<GraphNode["kind"], RegExp[]> = {
  page: [/\/app\/.*\/page\.[tj]sx?$/, /\/pages\/.*\.[tj]sx?$/],
  component: [/\/components?\//, /\/ui\//],
  hook: [/\/hooks?\//, /use[A-Z][^/]*\.[tj]sx?$/],
  action: [/\/actions?\//, /action\.[tj]sx?$/],
  util: [/\/utils?\//, /\/lib\//, /\/helpers?\//, /\/services?\//],
  unknown: [],
};

// Modules that are never added as graph nodes (external packages).
export const EXTERNAL_MODULE_PREFIXES = ["react", "next", "node:"];
