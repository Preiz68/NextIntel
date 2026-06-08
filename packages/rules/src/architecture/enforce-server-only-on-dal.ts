import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const enforceServerOnlyOnDal: Rule = {
  id: "enforce-server-only-on-dal",

  meta: {
    description: "Enforce 'server-only' package import on all database access, schema, or DAL module files.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const normPath = analysis.filePath.replace(/\\/g, "/");
      
      const isDalFolder = normPath.includes("/dal/") || 
                          normPath.includes("/db/") || 
                          normPath.includes("/server/");
      
      const isServerOnlyFile = normPath.includes(".server.") || normPath.endsWith("dal.ts") || normPath.endsWith("dal.js");

      if (!isDalFolder && !isServerOnlyFile) continue;
      if (analysis.isClientComponent) continue;

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      const hasServerOnlyImport = 
        (analysis.importDetails && analysis.importDetails.some(imp => imp.moduleSpecifier === "server-only")) ||
        /import\s+['"]server-only['"]/.test(content);

      if (!hasServerOnlyImport) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "AR-DAL-SERVER-001",
          message: `DAL or server-side helper file '${path.basename(analysis.filePath)}' is missing the 'server-only' package import. Add "import 'server-only';" at the top of the file to prevent it from leaking into client-side build bundles.`,
          whyItMatters: "Without 'server-only', Next.js will happily bundle database clients, secret key utilities, or environment configs into Client Component JS bundles if imported directly or transitively. This can leak private logic, credentials, and bloat the client-side JavaScript bundle.",
          quickFixes: [
            "Add: import 'server-only'; at the top of the file."
          ],
          architectureSuggestions: [
            "Enforce a strict server-only boundaries model by ensuring any backend-access file declares its server-only intent in the first lines of code."
          ],
          productionRisks: [
            "Leaking backend secrets or DB config to the client",
            "Bundle bloat due to server-side node modules being imported by clients",
            "Build compile failures due to Node.js built-ins in the browser context"
          ]
        });
      }
    }

    return diagnostics;
  }
};
