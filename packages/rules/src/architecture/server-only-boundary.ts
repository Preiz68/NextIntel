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

    const SERVER_ONLY_PACKAGES = [
      "firebase-admin",
      "@prisma/client",
      "mongodb",
      "drizzle-orm",
      "@supabase/ssr",
      "pg",
      "pg-pool",
      "mysql2",
      "sqlite3",
      "redis",
      "ioredis",
      "mariadb",
      "knex",
      "mongoose"
    ];

    const SECRET_KEYWORDS = [
      "FIREBASE_PRIVATE_KEY",
      "FIREBASE_CLIENT_EMAIL",
      "DATABASE_URL",
    ];

    const NODE_BUILTINS = new Set([
      "fs", "path", "crypto", "net", "tls", "child_process", "os", "dns", "http", "https", "zlib", "stream", "readline", "process", "events"
    ]);

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

      // Strip single-line and multi-line comments so keyword checks don't
      // fire on commented-out env var names or documentation strings.
      const contentWithoutComments = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");

      // Skip files that already import server-only
      const hasServerOnlyImport =
        (analysis.importDetails && analysis.importDetails.some(imp => imp.moduleSpecifier === "server-only")) ||
        /import\s+['"]server-only['"]/.test(content);

      if (hasServerOnlyImport) continue;

      // --- 1. SERVER-ONLY DEPENDENCIES ---
      const hasServerOnlyDependency = analysis.importDetails && analysis.importDetails.some(imp => 
        SERVER_ONLY_PACKAGES.includes(imp.moduleSpecifier) || 
        SERVER_ONLY_PACKAGES.some(pkg => imp.moduleSpecifier.startsWith(pkg + "/"))
      );

      // --- 2. SECRET OR PRIVATE ENV USAGE ---
      let hasPrivateEnvUsage = false;
      const dotEnvRegex = /\bprocess\.env\.([a-zA-Z0-9_]+)\b/g;
      let match;
      while ((match = dotEnvRegex.exec(contentWithoutComments)) !== null) {
        const varName = match[1];
        if (varName && !varName.startsWith("NEXT_PUBLIC_")) {
          hasPrivateEnvUsage = true;
          break;
        }
      }
      if (!hasPrivateEnvUsage) {
        const bracketEnvRegex = /\bprocess\.env\s*\[\s*['"]([a-zA-Z0-9_]+)['"]\s*\]/g;
        while ((match = bracketEnvRegex.exec(contentWithoutComments)) !== null) {
          const varName = match[1];
          if (varName && !varName.startsWith("NEXT_PUBLIC_")) {
            hasPrivateEnvUsage = true;
            break;
          }
        }
      }

      const hasSecretKeyword = SECRET_KEYWORDS.some(kw => contentWithoutComments.includes(kw));

      // --- 3. NODE-ONLY APIS ---
      const importsNodeApi = analysis.importDetails && analysis.importDetails.some(imp => {
        const spec = imp.moduleSpecifier;
        const cleanSpec = spec.startsWith("node:") ? spec.slice(5) : spec;
        return NODE_BUILTINS.has(cleanSpec);
      });
      const hasRequireNodeApi = /require\(['"](?:node:)?(fs|path|crypto|net|tls|child_process|os|dns|http|https|zlib|stream|readline|process|events)['"]\)/.test(contentWithoutComments);
      const hasNodeApi = importsNodeApi || hasRequireNodeApi;

      // --- 4. SERVER CONTEXT INDICATORS ---
      const predecessors = (context.graph as any)?.predecessors(analysis.filePath) ?? [];
      let importedOnlyByServer = false;
      if (predecessors.length > 0) {
        let hasClientImporter = false;
        for (const pred of predecessors) {
          const node = context.nodes.get(pred);
          if (node) {
            const isClient = node.isClientComponent || 
                             node.semanticKind === "client-component" || 
                             node.semanticKind === "client-util" ||
                             (node.kind === "component" && node.isClientComponent);
            if (isClient) {
              hasClientImporter = true;
              break;
            }
          }
        }
        if (!hasClientImporter) {
          importedOnlyByServer = true;
        }
      }

      // --- STRICT NEGATIVE RULE ---
      const usesFirebaseClient = analysis.importDetails && analysis.importDetails.some(imp => {
        const spec = imp.moduleSpecifier;
        return spec === "firebase/app" || spec === "firebase/firestore" || spec === "firebase/storage" ||
               spec.startsWith("firebase/app/") || spec.startsWith("firebase/firestore/") || spec.startsWith("firebase/storage/");
      });

      const hasFirebaseAdmin = analysis.importDetails && analysis.importDetails.some(imp => 
        imp.moduleSpecifier === "firebase-admin" || imp.moduleSpecifier.startsWith("firebase-admin/")
      );

      const satisfiesNegativeRule = 
        usesFirebaseClient &&
        !hasPrivateEnvUsage &&
        !hasFirebaseAdmin &&
        !hasNodeApi &&
        !hasSecretKeyword;

      // Final Candidate Decision
      const isServerOnlyCandidate = (
        hasServerOnlyDependency ||
        hasPrivateEnvUsage ||
        hasSecretKeyword ||
        hasNodeApi
      ) && !satisfiesNegativeRule;

      if (isServerOnlyCandidate) {
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
