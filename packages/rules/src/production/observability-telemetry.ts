import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "fs";

/**
 * Rule: observability-telemetry
 *
 * Detection logic: Deterministically detects raw console.log statements
 * inside Edge Middleware or Edge Route Handlers.
 *
 * Semantics: Sourced from "Observability" knowledge pack constraint OB-002.
 */
export const observabilityTelemetry: Rule = {
  id: "observability-telemetry",

  meta: {
    description: "Do not print raw console.log logs in high-frequency Edge routes.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("observability", "OB-002");

    const whyItMatters = constraint?.whyItMatters ?? "Logging synchronously in Edge hot paths blocks thread execution and drives up telemetry costs.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      
      const isMiddleware = analysis.semanticKind === "middleware" || normalizedPath.endsWith("/middleware.ts") || normalizedPath.endsWith("/middleware.js");
      const isEdgeRoute = (analysis.runtime === "edge" && (normalizedPath.endsWith("/route.ts") || normalizedPath.endsWith("/route.js")));

      if (!isMiddleware && !isEdgeRoute) continue;

      try {
        const content = readFileSync(analysis.filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i]!;

          // Simple check for raw console.log or console.debug
          if (lineText.includes("console.log") || lineText.includes("console.debug")) {
            const isLocal = !process.env.CI && process.env.NODE_ENV !== "production";
            const severity = isLocal ? "info" : (constraint?.severity ?? "warning");

            diagnostics.push({
              file: analysis.filePath,
              line: i + 1,
              severity,
              ruleId: this.id,
              id: constraint?.id ?? "OB-002",

              // ── Core message dynamically constructed from constraint ─────────
              message: `Synchronous console logging detected in Edge hot path. ${constraint?.problem ?? ""}`,

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
      } catch (err) {
        // Safe skip if file cannot be read
      }
    }

    return diagnostics;
  },
};
