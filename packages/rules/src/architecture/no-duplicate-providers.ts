import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project } from "ts-morph";
import path from "node:path";

export const noDuplicateProviders: Rule = {
  id: "no-duplicate-providers",

  meta: {
    description: "Ensure React context providers (e.g. ThemeProvider, QueryClientProvider, SessionProvider) are not instantiated multiple times in the route layout tree.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const KNOWN_PROVIDERS = [
      "ThemeProvider",
      "QueryClientProvider",
      "SessionProvider",
      "NextAuthProvider",
      "ApolloProvider",
      "StoreProvider",
      "Provider"
    ];

    const providerLocations = new Map<string, string[]>();

    for (const analysis of context.analyses) {
      const normPath = analysis.filePath.replace(/\\/g, "/");
      const filename = path.basename(normPath);
      const isRenderFile = /^(layout|page)\.[jt]sx?$/.test(filename);
      if (!isRenderFile) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      const hasProviderKeyword = KNOWN_PROVIDERS.some(p => content.includes(p));
      if (!hasProviderKeyword) continue;

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_dup_prov.tsx", content);
        
        sourceFile.forEachDescendant((node) => {
          const kind = node.getKindName();
          if (kind === "JsxOpeningElement" || kind === "JsxSelfClosingElement") {
            const tagName = (node as any).getTagNameNode()?.getText();
            if (tagName && KNOWN_PROVIDERS.includes(tagName)) {
              if (!providerLocations.has(tagName)) {
                providerLocations.set(tagName, []);
              }
              providerLocations.get(tagName)!.push(analysis.filePath);
            }
          }
        });
      } catch (e) {
        // ignore
      }
    }

    for (const [providerName, files] of providerLocations.entries()) {
      if (files.length > 1) {
        const uniqueFiles = [...new Set(files)];
        if (uniqueFiles.length > 1) {
          for (const file of uniqueFiles) {
            const otherFiles = uniqueFiles.filter(f => f !== file).map(f => path.basename(f));
            diagnostics.push({
              file: file,
              line: 1,
              severity: "warning",
              ruleId: this.id,
              id: "AR-PROVIDER-DUP-001",
              message: `Duplicate instantiation of context provider '<${providerName}>'. This provider is also rendered in: ${otherFiles.join(", ")}. Combine them at the root layout.`,
              whyItMatters: "Duplicating global state/context providers creates multiple isolated context trees. This leads to split states, caches not updating across components, unnecessary double-fetching, and redundant JS execution.",
              quickFixes: [
                `Remove the local <${providerName}> wrapper and rely on the instance defined in the root layout.`,
                `Consolidate all global providers into a single unified root wrapper.`
              ],
              architectureSuggestions: [
                "Establish a central layout providers file (e.g. 'providers.tsx') at the app root, rendering all global contexts together."
              ],
              productionRisks: [
                "Desynchronized client state (e.g. auth sessions or cache queries)",
                "Double data-fetching bugs on navigating",
                "Increased DOM nesting and slower reconciliation"
              ]
            });
          }
        }
      }
    }

    return diagnostics;
  }
};
