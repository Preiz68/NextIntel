import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts"
  },
  format: ["cjs"],
  dts: false,
  clean: true,
  // Bundle workspace dependencies
  noExternal: ["engine", "rules", "ts-morph", "graphlib", "picocolors", "commander"],
});
