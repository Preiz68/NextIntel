import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const serverOnlyBoundary: Rule = {
  id: "server-only-boundary",

  meta: {
    description: "Verify that backend utility modules, database client setups, or secret configurations import 'server-only'.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("security", "SC-SECURITY-002");
    const whyItMatters = constraint?.whyItMatters ?? "Accidentally importing backend-only code or database initialization files into Client Components leaks credentials, increases bundle sizes, and throws build compile errors. Explicitly importing 'server-only' protects this boundary.";
    const quickFixes = constraint?.quickFixes ?? ["Add import 'server-only'; at the top of the backend utility file."];

    const DB_PACKAGES = [
      "@prisma/client",
      "drizzle-orm",
      "mongodb",
      "pg",
      "pg-pool",
      "knex",
      "mysql2",
      "sqlite3",
      "mongoose",
      "redis",
      "ioredis",
      "mariadb",
    ];

    const SECRET_KEYWORDS = [
      "new PrismaClient",
      "mongoose.connect",
      "new MongoClient",
      "new Pool(",
      "new Redis(",
      "drizzle(",
      "drizzleClient",
      "process.env.DATABASE_URL",
      "process.env.DB_PASS",
      "process.env.DB_PASSWORD",
      "process.env.STRIPE_SECRET_KEY",
      "process.env.JWT_SECRET",
      "process.env.API_SECRET",
      "process.env.AWS_SECRET_ACCESS_KEY",
      "process.env.CLERK_SECRET_KEY",
      "process.env.FIREBASE_SERVICE_ACCOUNT",
    ];

    const ROUTING_KINDS = [
      "page",
      "layout",
      "template",
      "loading",
      "error",
      "not-found",
      "global-error",
      "default",
      "route-handler",
      "middleware",
      "server-action",
    ];

    for (const analysis of context.analyses) {
      // Exclude client components
      if (analysis.isClientComponent) continue;

      // Exclude files with top-level "use server" or classified as server action files
      if (analysis.hasTopLevelUseServer || analysis.semanticKind === "server-action") continue;

      // Exclude routing entrypoints
      if (ROUTING_KINDS.includes(analysis.semanticKind)) continue;

      // Exclude specific file basenames commonly matching Next.js entrypoint naming
      const basename = path.basename(analysis.filePath);
      if (
        /^(page|layout|template|loading|error|not-found|global-error|route|middleware)\.[jt]sx?$/.test(basename)
      ) {
        continue;
      }

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // Skip files that already import server-only
      const hasServerOnlyImport = 
        (analysis.importDetails && analysis.importDetails.some(imp => imp.moduleSpecifier === "server-only")) ||
        /import\s+['"]server-only['"]/.test(content);

      if (hasServerOnlyImport) continue;

      // Determine if this file is a database or config/utility module
      const importsDbPackage = analysis.importDetails && analysis.importDetails.some(imp => 
        DB_PACKAGES.includes(imp.moduleSpecifier) || 
        DB_PACKAGES.some(pkg => imp.moduleSpecifier.startsWith(pkg + "/"))
      );

      const hasSecretOrDbKeyword = SECRET_KEYWORDS.some(kw => content.includes(kw)) ||
        /\bconst\s+(db|prisma|drizzleClient|database|knex|pgPool)\b\s*=/.test(content);

      const isDbOrSecretConfig = importsDbPackage || hasSecretOrDbKeyword;

      if (isDbOrSecretConfig) {
        const diag = mapEventToDiagnostic(
          "SERVER_ONLY_IMPORT_MISSING",
          "SC-SECURITY-002",
          this.id,
          analysis.filePath,
          1,
          `Server-only Module Boundary Guard: Backend utility or DB initialization module '${basename}' does not import the 'server-only' package. To protect secrets and database configs, explicitly import 'server-only'.`
        );

        diagnostics.push(diag);
      }
    }

    return diagnostics;
  },
};
