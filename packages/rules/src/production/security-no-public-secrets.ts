import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "fs";

/**
 * Rule: security-no-public-secrets
 *
 * Detection logic: Deterministically scans the file contents for NEXT_PUBLIC_
 * variables that contain secret keywords (like SECRET, PASSWORD, DB, PRIVATE).
 *
 * Semantics: Sourced from "Security" knowledge pack constraint SE-001.
 */
export const securityNoPublicSecrets: Rule = {
  id: "security-no-public-secrets",

  meta: {
    description: "Do not expose private secrets in NEXT_PUBLIC environment variables.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("security", "SE-001");

    const whyItMatters = constraint?.whyItMatters ?? "Prefixing private credentials with NEXT_PUBLIC_ exposes them to the browser.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    const forbiddenPatterns = [
      "NEXT_PUBLIC_STRIPE_SECRET_KEY",
      "NEXT_PUBLIC_DATABASE_URL",
      "NEXT_PUBLIC_DB_PASS",
      "NEXT_PUBLIC_SECRET",
      "NEXT_PUBLIC_PRIVATE",
      "NEXT_PUBLIC_PASSWORD",
    ];

    for (const analysis of context.analyses) {
      try {
        const content = readFileSync(analysis.filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const lineText = lines[i]!;
          
          for (const pattern of forbiddenPatterns) {
            if (lineText.includes(pattern)) {
              diagnostics.push({
                file: analysis.filePath,
                line: i + 1,
                severity: constraint?.severity ?? "error",
                ruleId: this.id,
                id: constraint?.id ?? "SE-001",

                // ── Core message dynamically constructed from constraint ─────────
                message: `Leaked secret '${pattern}' detected in public environment variable access. ${constraint?.problem ?? ""}`,

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
      } catch (err) {
        // Safe skip if file cannot be read
      }
    }

    return diagnostics;
  },
};
