import { Rule, RuleContext, Diagnostic } from "../types.js";
import path from "node:path";

export const enforceDalIsolation: Rule = {
  id: "enforce-dal-isolation",

  meta: {
    description: "Enforce that database access or ORM imports are restricted to a Data Access Layer (DAL).",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const FORBIDDEN_DB_PACKAGES = [
      "@prisma/client",
      "drizzle-orm",
      "pg",
      "mysql2",
      "mongodb",
      "mongoose",
      "sqlite3",
      "redis",
      "ioredis"
    ];

    for (const analysis of context.analyses) {
      const normPath = analysis.filePath.replace(/\\/g, "/");
      
      // We only care about components or views folders (e.g. /components/, /ui/, /views/)
      const isPresentationFile = normPath.includes("/components/") || 
                                 normPath.includes("/ui/") || 
                                 normPath.includes("/views/");
                                 
      if (!isPresentationFile) continue;

      const imports = analysis.importDetails || [];
      for (const imp of imports) {
        const hasDbImport = FORBIDDEN_DB_PACKAGES.some(pkg => 
          imp.moduleSpecifier === pkg || imp.moduleSpecifier.startsWith(pkg + "/")
        );

        if (hasDbImport) {
          diagnostics.push({
            file: analysis.filePath,
            line: imp.line ?? 1,
            severity: "warning",
            ruleId: this.id,
            id: "AR-DAL-001",
            message: `Presentation file '${path.basename(analysis.filePath)}' directly imports database client package '${imp.moduleSpecifier}'. Move database queries into a Data Access Layer (DAL) under a dedicated folder (e.g. '/lib/dal' or '/db') to maintain clean architectural boundaries.`,
            whyItMatters: "Directly querying the database inside UI components violates the separation of concerns. It makes components harder to test, leaks backend schemas, and hinders query reuse and performance optimization (like React.cache() memoization).",
            quickFixes: [
              "Create a database query utility in '/lib/dal.ts' and import it instead.",
              "Use Server Actions or direct function helpers in Server Components to query the DB."
            ],
            architectureSuggestions: [
              "Establish a strict Data Access Layer: Component -> queries DAL function -> DAL queries Database."
            ],
            productionRisks: [
              "Tightly coupled code leading to high maintenance costs",
              "Bypassing request-level cache layers leading to database connection spikes",
              "Leaking internal data representations directly into layouts"
            ]
          });
        }
      }
    }

    return diagnostics;
  }
};
