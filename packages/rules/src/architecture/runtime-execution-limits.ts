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
      if (analysis.runtime !== "edge") continue;

      for (const impInfo of analysis.importDetails) {
        const specifier = impInfo.moduleSpecifier;
        const cleanSpecifier = specifier.replace(/^node:/, "");

        if (NATIVE_NODE_MODULES.has(cleanSpecifier)) {
          diagnostics.push({
            file: analysis.filePath,
            severity: constraint?.severity ?? "error",
            ruleId: this.id,
            id: constraint?.id ?? "RU-001",

            // ── Core message dynamically constructed from constraint ─────────
            message: `Native Node.js module '${specifier}' imported in Edge Runtime context. ${constraint?.problem ?? ""}`,

            // ── Legacy fix (preserved for backward compat) ────────────────────
            fix: quickFixes[0],

            // ── Knowledge-enriched fields ─────────────────────────────────────
            whyItMatters,
            quickFixes,
            architectureSuggestions,
            optimizationGuidance,
            productionRisks,
            examples: constraint?.examples,
          });
        }
      }
    }

    return diagnostics;
  },
};
