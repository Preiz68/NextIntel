import { Rule, RuleContext, Diagnostic } from "../types.js";
import path from "node:path";

/**
 * Rule: no-mixed-barrel-files
 *
 * Detects barrel files (index files re-exporting multiple modules)
 * that mix exports of Client Components and Server Components/utilities,
 * creating import graph crossings that lead to tree-shaking failures.
 *
 * Semantics: Sourced from "Bundling" knowledge pack constraint BD-003.
 */
export const noMixedBarrelFiles: Rule = {
  id: "no-mixed-barrel-files",

  meta: {
    description: "Do not mix Client Components and Server Components/utilities in a single barrel file.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("bundling", "BD-003");
    const whyItMatters = constraint?.whyItMatters ?? "Mixing client and server exports in a single barrel file forces the bundler to process and include server files in the client bundle, causing tree-shaking failures.";
    const quickFixes = constraint?.quickFixes ?? ["Split the barrel file into separate client and server barrel files, or use direct imports instead of the barrel."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      // Barrel files generally consist of multiple exports declared in other files.
      // Let's analyze re-exported declarations.
      const reExports = new Set<string>();
      const reExportNodes: Array<{ name: string; declaredInFile: string }> = [];

      for (const exp of analysis.exportDetails) {
        if (exp.declaredInFile && exp.declaredInFile !== analysis.filePath) {
          reExports.add(exp.declaredInFile);
          reExportNodes.push({ name: exp.name, declaredInFile: exp.declaredInFile });
        }
      }

      // If the file does not re-export from at least 2 files, it's probably not a mixed barrel file
      if (reExports.size < 2) continue;

      let hasClientExport = false;
      let hasServerExport = false;
      const clientDetails: string[] = [];
      const serverDetails: string[] = [];

      for (const file of reExports) {
        const targetNode = context.nodes.get(file);
        
        // Determine client status
        const isClient = 
          targetNode?.isClientComponent || 
          targetNode?.semanticKind === "client-component" ||
          targetNode?.semanticKind === "client-util" ||
          targetNode?.runtime === "client";

        // Determine server status
        const isServer = 
          targetNode?.isServerComponent || 
          targetNode?.semanticKind === "server-component" ||
          targetNode?.semanticKind === "server-util" ||
          targetNode?.semanticKind === "server-action" ||
          targetNode?.runtime === "server";

        if (isClient) {
          hasClientExport = true;
          clientDetails.push(path.basename(file));
        }

        if (isServer) {
          hasServerExport = true;
          serverDetails.push(path.basename(file));
        }
      }

      // If a single file re-exports both client-only and server-only targets, it's mixed
      if (hasClientExport && hasServerExport) {
        diagnostics.push({
          file: analysis.filePath,
          severity: constraint?.severity ?? "warning",
          ruleId: this.id,
          id: constraint?.id ?? "BD-003",
          message: `Mixed barrel file detected. Imports from here will cause tree-shaking failures. This barrel file re-exports Client modules (${clientDetails.join(", ")}) and Server modules (${serverDetails.join(", ")}).`,
          fix: quickFixes[0],
          whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: constraint?.examples,
        });
      }
    }

    return diagnostics;
  },
};
