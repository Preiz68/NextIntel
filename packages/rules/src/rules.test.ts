import { RuleEngine } from "./registry/engine.js";
import { routingPatterns } from "./architecture/routing-patterns.js";
import { useCacheDirective } from "./rendering/use-cache-directive.js";
import { optimizePackageImports } from "./production/optimize-package-imports.js";
import { serverOnlyBoundary } from "./architecture/server-only-boundary.js";
import { RuleContext, Diagnostic } from "./types.js";
import { Graph } from "graphlib";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

function createMockAnalysis(filePath: string, extra: any = {}): any {
  return {
    filePath,
    isClientComponent: false,
    isServerComponent: true,
    hasTopLevelUseServer: false,
    isEdgeRuntime: false,
    imports: [],
    importDetails: [],
    exports: [],
    exportDetails: [],
    hooks: [],
    hookDetails: [],
    usesBrowserAPI: false,
    browserAPIs: [],
    fetchCalls: [],
    hasAsyncComponent: false,
    errors: [],
    taintState: "CLEAN",
    taints: [],
    simulationFindings: [],
    semanticKind: "util",
    rendering: "server",
    hydration: "static",
    boundaries: [],
    executionModel: {
      componentType: "server",
      runtime: "node",
      usesBrowserApis: [],
      usesServerApis: [],
      usesClientHooks: [],
      boundaryViolations: [],
      architectureFlags: []
    },
    violatedConstraints: [],
    ...extra
  };
}

export async function runRulesTests() {
  console.log("🧪 Running Rules unit tests...");

  const tempDir = path.resolve("./temp-rules-test-dir");
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // =========================================================================
    // 1. Test RV-003 (Dynamic revalidatePath type parameter check)
    // =========================================================================
    {
      const fileA = path.join(tempDir, "rv003-a.ts");
      fs.writeFileSync(fileA, `revalidatePath('/blog/' + slug);`, "utf8");

      const fileB = path.join(tempDir, "rv003-b.ts");
      fs.writeFileSync(fileB, `revalidatePath(\`/blog/\${slug}\`);`, "utf8");

      const fileC = path.join(tempDir, "rv003-c.ts");
      fs.writeFileSync(fileC, `revalidatePath('/blog/[slug]');`, "utf8");

      const fileD = path.join(tempDir, "rv003-d.ts");
      fs.writeFileSync(fileD, `revalidatePath('/blog/[slug]', 'page');`, "utf8");

      const fileE = path.join(tempDir, "rv003-e.ts");
      fs.writeFileSync(fileE, `revalidatePath('/blog/static');`, "utf8");

      const fileF = path.join(tempDir, "rv003-f.ts");
      fs.writeFileSync(fileF, `revalidatePath(myVar);`, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA),
          createMockAnalysis(fileB),
          createMockAnalysis(fileC),
          createMockAnalysis(fileD),
          createMockAnalysis(fileE),
          createMockAnalysis(fileF),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = routingPatterns.run(context);
      const rv003Diags = diagnostics.filter(d => d.id === "RV-003");

      assert.strictEqual(rv003Diags.length, 4, "Should find exactly 4 RV-003 violations");
      assert.ok(rv003Diags.some(d => d.file === fileA), "Should flag string concat");
      assert.ok(rv003Diags.some(d => d.file === fileB), "Should flag template string with expression");
      assert.ok(rv003Diags.some(d => d.file === fileC), "Should flag static string with brackets");
      assert.ok(rv003Diags.some(d => d.file === fileF), "Should flag raw identifier variable");
      assert.ok(!rv003Diags.some(d => d.file === fileD), "Should NOT flag valid page revalidatePath");
      assert.ok(!rv003Diags.some(d => d.file === fileE), "Should NOT flag valid static path");
    }

    // =========================================================================
    // 2. Test RE-005 (use cache suggestion)
    // =========================================================================
    {
      const fileA = path.join(tempDir, "re005-a.ts");
      fs.writeFileSync(fileA, `
        export async function getData() {
          const res = await fetch("https://api.com");
          return res.json();
        }
      `, "utf8");

      const fileB = path.join(tempDir, "re005-b.ts");
      fs.writeFileSync(fileB, `
        export async function getData() {
          "use cache";
          const res = await fetch("https://api.com");
          return res.json();
        }
      `, "utf8");

      const fileC = path.join(tempDir, "re005-c.ts");
      fs.writeFileSync(fileC, `
        // Test with unstable_cache
        import { unstable_cache } from "next/cache";
        export const getData = unstable_cache(async () => {
          return fetch("https://api.com");
        });
      `, "utf8");

      const fileD = path.join(tempDir, "re005-d.ts");
      fs.writeFileSync(fileD, `
        "use client";
        export async function getClientData() {
          return fetch("https://api.com");
        }
      `, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA, { fetchCalls: [{ url: "static" }] }),
          createMockAnalysis(fileB, { fetchCalls: [{ url: "static" }] }),
          createMockAnalysis(fileC, { fetchCalls: [{ url: "static" }] }),
          createMockAnalysis(fileD, { isClientComponent: true, fetchCalls: [{ url: "static" }] }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = useCacheDirective.run(context);
      const re005Diags = diagnostics.filter(d => d.id === "RE-005");

      assert.strictEqual(re005Diags.length, 1, "Should find exactly 1 RE-005 violation");
      assert.strictEqual(re005Diags[0].file, fileA, "Violation should be on fileA");
    }

    // =========================================================================
    // 3. Test PF-007 (optimizePackageImports)
    // =========================================================================
    {
      const configPath = path.join(tempDir, "next.config.js");
      fs.writeFileSync(configPath, `
        module.exports = {
          experimental: {
            optimizePackageImports: ["react-icons"]
          }
        };
      `, "utf8");

      // client component with unoptimized lucide-react
      const fileA = path.join(tempDir, "pf007-a.tsx");
      fs.writeFileSync(fileA, `
        "use client";
        import { Camera } from "lucide-react";
      `, "utf8");

      // client component with optimized react-icons
      const fileB = path.join(tempDir, "pf007-b.tsx");
      fs.writeFileSync(fileB, `
        "use client";
        import { FaBeer } from "react-icons";
      `, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lucide-react", namedImports: ["Camera"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileB, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "react-icons", namedImports: ["FaBeer"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = optimizePackageImports.run(context);
      const pf007Diags = diagnostics.filter(d => d.id === "PF-007");

      assert.strictEqual(pf007Diags.length, 1, "Should find exactly 1 PF-007 violation");
      assert.strictEqual(pf007Diags[0].file, fileA, "Violation should be on fileA");
    }

    // =========================================================================
    // 4. Test SC-SECURITY-002 (server-only boundary)
    // =========================================================================
    {
      // database setup without server-only
      const fileA = path.join(tempDir, "sc002-a.ts");
      fs.writeFileSync(fileA, `
        import { PrismaClient } from "@prisma/client";
        export const prisma = new PrismaClient();
      `, "utf8");

      // database setup with server-only
      const fileB = path.join(tempDir, "sc002-b.ts");
      fs.writeFileSync(fileB, `
        import "server-only";
        import { PrismaClient } from "@prisma/client";
        export const prisma = new PrismaClient();
      `, "utf8");

      // next.config (not code, should skip)
      const fileC = path.join(tempDir, "next.config.js");
      fs.writeFileSync(fileC, `
        module.exports = { reactStrictMode: true };
      `, "utf8");

      // page.tsx (entrypoint, should skip)
      const fileD = path.join(tempDir, "page.tsx");
      fs.writeFileSync(fileD, `
        import { prisma } from "./sc002-a";
        export default function Page() {}
      `, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA, {
            importDetails: [{ moduleSpecifier: "@prisma/client", namedImports: ["PrismaClient"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileB, {
            importDetails: [
              { moduleSpecifier: "server-only", namedImports: [], defaultImport: null, namespaceImport: null, isTypeOnly: false },
              { moduleSpecifier: "@prisma/client", namedImports: ["PrismaClient"], defaultImport: null, namespaceImport: null, isTypeOnly: false }
            ]
          }),
          createMockAnalysis(fileC, { semanticKind: "unknown" }),
          createMockAnalysis(fileD, { semanticKind: "page" }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = serverOnlyBoundary.run(context);
      const sc002Diags = diagnostics.filter(d => d.id === "SC-SECURITY-002");

      assert.strictEqual(sc002Diags.length, 1, "Should find exactly 1 SC-SECURITY-002 violation");
      assert.strictEqual(sc002Diags[0].file, fileA, "Violation should be on fileA");
    }

    console.log("✅ Rules unit tests passed!");
  } finally {
    // Cleanup temporary files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
