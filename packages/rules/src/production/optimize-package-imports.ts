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

function parseImport(moduleSpecifier: string): { packageName: string; isDeep: boolean } {
  const parts = moduleSpecifier.split("/");
  if (moduleSpecifier.startsWith("@")) {
    const packageName = parts.slice(0, 2).join("/");
    const isDeep = parts.length > 2;
    return { packageName, isDeep };
  } else {
    const packageName = parts[0];
    const isDeep = parts.length > 1;
    return { packageName, isDeep };
  }
}

function isLargeNonTreeShakable(packageName: string): boolean {
  const name = packageName.toLowerCase();

  // Explicitly known heavy non-tree-shakable packages
  const exactHeavy = [
    "lodash",
    "moment",
    "react-icons",
    "@radix-ui/react-icons",
    "@radix-ui/react-select",
    "@radix-ui/react-dropdown-menu",
    "react-bootstrap"
  ];
  if (exactHeavy.includes(name)) {
    return true;
  }

  // Charting libraries
  if (name === "recharts" || name === "chart.js" || name === "highcharts" || name.includes("chart")) {
    return true;
  }

  // UI Frameworks or heavy components (Material UI, FontAwesome, Bootstrap)
  if (
    name.startsWith("@mui/") ||
    name.startsWith("@fortawesome/") ||
    name.startsWith("bootstrap") ||
    name.startsWith("react-bootstrap")
  ) {
    return true;
  }

  return false;
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

      const importDetails = analysis.importDetails || [];
      if (importDetails.length === 0) continue;

      // Group import details by package name
      const packageImportsMap = new Map<string, typeof importDetails>();
      for (const imp of importDetails) {
        if (imp.isTypeOnly) continue; // Skip type-only
        const { packageName } = parseImport(imp.moduleSpecifier);
        if (!packageImportsMap.has(packageName)) {
          packageImportsMap.set(packageName, []);
        }
        packageImportsMap.get(packageName)!.push(imp);
      }

      // Check each imported package
      for (const [pkg, importsOfPkg] of packageImportsMap.entries()) {
        let shouldWarn = false;

        if (pkg === "lucide-react") {
          // Special logic for lucide-react
          const hasNamespace = importsOfPkg.some(imp => imp.namespaceImport !== null);
          if (hasNamespace) {
            shouldWarn = true;
          }
        } else if (isLargeNonTreeShakable(pkg)) {
          // General logic for heavy packages
          const hasDeep = importsOfPkg.some(imp => parseImport(imp.moduleSpecifier).isDeep);
          const hasNamespace = importsOfPkg.some(imp => imp.namespaceImport !== null);
          const deepImports = importsOfPkg.filter(imp => parseImport(imp.moduleSpecifier).isDeep);
          const rootImports = importsOfPkg.filter(imp => !parseImport(imp.moduleSpecifier).isDeep);

          const condition2 = 
            !hasDeep || 
            hasNamespace || 
            (deepImports.length > 1 || rootImports.some(imp => imp.namedImports.length > 1));

          // For large, non-tree-shakable packages, only deep imports are tree-shaking-friendly
          const hasTreeShakingFriendly = hasDeep;
          const condition3 = !hasTreeShakingFriendly;

          if (condition2 && condition3) {
            shouldWarn = true;
          }
        }

        if (!shouldWarn) continue;

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

        const isOptimized = nextConfigContent && 
          nextConfigContent.includes("optimizePackageImports") &&
          nextConfigContent.includes(pkg);

        if (!isOptimized) {
          // Find the line number. Use imp.line if present, otherwise search content.
          let line = 1;
          const firstImp = importsOfPkg.find(imp => imp.line !== undefined);
          if (firstImp && firstImp.line !== undefined) {
            line = firstImp.line;
          } else {
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i]!.includes(pkg)) {
                line = i + 1;
                break;
              }
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
            examples: {
              invalid: [
                "// ❌ Invalid: next.config.js missing optimizePackageImports for heavy libraries\n// next.config.js\nmodule.exports = {\n  reactStrictMode: true,\n};"
              ],
              valid: [
                "// ✅ Valid (Option 1): Configure optimizePackageImports in next.config.js\n// next.config.js\nmodule.exports = {\n  experimental: {\n    optimizePackageImports: [\"lucide-react\", \"react-icons\"]\n  }\n};",
                "// ✅ Valid (Option 2): Use explicit deep module imports instead of tree-shaking\n\"use client\";\nimport Camera from 'lucide-react/dist/esm/icons/camera';"
              ]
            },
          });
        }
      }
    }

    return diagnostics;
  },
};
