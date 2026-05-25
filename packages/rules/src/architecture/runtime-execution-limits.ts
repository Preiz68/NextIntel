import { Rule, RuleContext, Diagnostic } from "../types.js";

const NATIVE_NODE_MODULES = new Set([
  "fs",
  "path",
  "child_process",
  "os",
  "crypto",
  "dns",
  "http",
  "https",
  "net",
  "stream",
  "tls",
  "zlib",
  "util",
  "fs/promises",
]);

/**
 * Rule: runtime-execution-limits
 *
 * Detection logic: Deterministically detects importing native Node.js modules
 * in routes/files configured with Edge Runtime.
 *
 * Semantics: Sourced from "Runtime" knowledge pack constraint RU-001.
 */
export const runtimeExecutionLimits: Rule = {
  id: "runtime-execution-limits",

  meta: {
    description: "Do not use Node.js built-in modules in Edge Runtime.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("runtime", "RU-001");

    const whyItMatters = constraint?.whyItMatters ?? "The Edge Runtime is a lightweight V8 isolate without native Node.js APIs.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const isEdge = analysis.runtime === "edge" || analysis.isEdgeRuntime || analysis.executionModel.runtime === "edge";
      if (!isEdge) continue;

      for (const t of analysis.taints) {
        if (t.type === "NODE_NATIVE_API" || t.source === "fs" || t.source === "path" || t.source === "net" || t.source === "crypto") {
          diagnostics.push({
            file: analysis.filePath,
            severity: "error", // Maps to CRITICAL with RU-001-CRITICAL profile
            ruleId: this.id,
            id: "RU-001-CRITICAL",
            message: `CRITICAL: Native Node.js module/API '${t.source}' is used in an Edge Runtime context.`,
            whyItMatters,
            quickFixes,
            architectureSuggestions,
            optimizationGuidance,
            productionRisks,
            examples: constraint?.examples,
            fix: "Change export const runtime = 'edge' to 'nodejs' or remove native Node imports."
          });
        } else if (t.type === "PROCESS_ENV") {
          diagnostics.push({
            file: analysis.filePath,
            severity: "warning", // Maps to HIGH with RU-001-HIGH profile
            ruleId: this.id,
            id: "RU-001-HIGH",
            message: `HIGH: Restricted process.env API '${t.source}' is referenced in an Edge Runtime context.`,
            whyItMatters,
            quickFixes: ["Avoid accessing process.env dynamically at runtime; use build-time environment definitions or next.config.js env mapping."],
            architectureSuggestions: ["Limit environment variable usage on Edge. Prefer passing configurations explicitly or using public prefixes where safe."],
            optimizationGuidance,
            productionRisks: ["Dynamic process.env checks can bypass caching, raise boot times, or result in undefined runtime values in some Edge providers."],
            examples: constraint?.examples,
            fix: "Use environment configurations or build-time definitions instead of dynamic process.env access."
          });
        }
      }
    }

    return diagnostics;
  },
};
