import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function findNextConfig(startPath: string): string | null {
  const parts = startPath.replace(/\\/g, "/").split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    for (const configName of ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]) {
      const configPath = `${dir}/${configName}`;
      if (existsSync(configPath)) {
        return configPath;
      }
    }
  }
  return null;
}

export const optimizePackageImports: Rule = {
  id: "production-optimize-package-imports",

  meta: {
    description: "Suggest adding heavy icon/UI packages to optimizePackageImports in next.config.js for client-side bundle reduction.",
    severity: "info",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("performance", "PF-007");
    const whyItMatters = constraint?.whyItMatters ?? "optimizePackageImports instructs the Next.js compiler to tree-shake heavy components automatically, reducing client bundle size.";
    const quickFixes = constraint?.quickFixes ?? ["Add the package to experimental.optimizePackageImports in next.config.js."];

    const HEAVY_PACKAGES = ["lucide-react", "react-icons", "@radix-ui/react-icons", "@radix-ui/react-select", "@radix-ui/react-dropdown-menu"];

    // Cache next.config content check
    let nextConfigContent: string | null = null;
    let nextConfigChecked = false;

    for (const analysis of context.analyses) {
      const isClient = 
        analysis.isClientComponent || 
        analysis.semanticKind === "client-component" || 
        analysis.executionModel?.componentType === "client";

      if (!isClient) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // Find imported heavy packages
      const importedHeavyPackages = HEAVY_PACKAGES.filter(pkg => {
        const regex = new RegExp(`from\\s+['"]${pkg.replace("/", "\\/")}['"]`);
        return regex.test(content);
      });

      if (importedHeavyPackages.length === 0) continue;

      // Lazy load next.config content
      if (!nextConfigChecked) {
        const configPath = findNextConfig(analysis.filePath);
        if (configPath) {
          try {
            nextConfigContent = readFileSync(configPath, "utf-8");
          } catch {
            // ignore
          }
        }
        nextConfigChecked = true;
      }

      for (const pkg of importedHeavyPackages) {
        const isOptimized = nextConfigContent && 
          nextConfigContent.includes("optimizePackageImports") &&
          nextConfigContent.includes(pkg);

        if (!isOptimized) {
          // Find the line containing the import
          let line = 1;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(pkg)) {
              line = i + 1;
              break;
            }
          }

          diagnostics.push({
            file: analysis.filePath,
            line,
            severity: "info",
            ruleId: this.id,
            id: "PF-007",
            message: `Optimize Package Imports: Heavy library '${pkg}' is imported in this Client Component, but next.config.js lacks 'optimizePackageImports' configuration for it. This will prevent Next.js from automatically tree-shaking and tree pruning the package, bloating client bundle size.`,
            fix: `Add '${pkg}' to experimental.optimizePackageImports in next.config.js`,
            whyItMatters,
            quickFixes,
            architectureSuggestions: constraint?.architectureSuggestions ?? [],
            optimizationGuidance: constraint?.optimizationGuidance ?? [],
            productionRisks: constraint?.productionRisks ?? [],
            examples: constraint?.examples,
          });
        }
      }
    }

    return diagnostics;
  },
};
