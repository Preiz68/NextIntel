import { RuleEngine } from "./registry/engine.js";
import { routingPatterns } from "./architecture/routing-patterns.js";
import { useCacheDirective } from "./rendering/use-cache-directive.js";
import { optimizePackageImports } from "./production/optimize-package-imports.js";
import { serverOnlyBoundary } from "./architecture/server-only-boundary.js";
import { dataFetchingPatterns } from "./data/data-fetching-patterns.js";
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

      // client component with unoptimized lucide-react (using namespace import)
      const fileA = path.join(tempDir, "pf007-a.tsx");
      fs.writeFileSync(fileA, `
        "use client";
        import * as Lucide from "lucide-react";
      `, "utf8");

      // client component with optimized react-icons
      const fileB = path.join(tempDir, "pf007-b.tsx");
      fs.writeFileSync(fileB, `
        "use client";
        import { FaBeer } from "react-icons";
      `, "utf8");

      // client component with valid lucide-react named imports (should NOT warn)
      const fileC = path.join(tempDir, "pf007-c.tsx");
      fs.writeFileSync(fileC, `
        "use client";
        import { Camera } from "lucide-react";
      `, "utf8");

      // client component with unoptimized lodash root named import (should warn)
      const fileD = path.join(tempDir, "pf007-d.tsx");
      fs.writeFileSync(fileD, `
        "use client";
        import { find } from "lodash";
      `, "utf8");

      // client component with optimized lodash deep import (should NOT warn)
      const fileE = path.join(tempDir, "pf007-e.tsx");
      fs.writeFileSync(fileE, `
        "use client";
        import find from "lodash/find";
      `, "utf8");

      // client component with unoptimized lodash namespace import (should warn)
      const fileF = path.join(tempDir, "pf007-f.tsx");
      fs.writeFileSync(fileF, `
        "use client";
        import * as _ from "lodash";
      `, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lucide-react", namedImports: [], defaultImport: null, namespaceImport: "Lucide", isTypeOnly: false }]
          }),
          createMockAnalysis(fileB, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "react-icons", namedImports: ["FaBeer"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileC, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lucide-react", namedImports: ["Camera"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileD, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lodash", namedImports: ["find"], defaultImport: null, namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileE, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lodash/find", namedImports: [], defaultImport: "find", namespaceImport: null, isTypeOnly: false }]
          }),
          createMockAnalysis(fileF, {
            isClientComponent: true,
            importDetails: [{ moduleSpecifier: "lodash", namedImports: [], defaultImport: null, namespaceImport: "_", isTypeOnly: false }]
          }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = optimizePackageImports.run(context);
      const pf007Diags = diagnostics.filter(d => d.id === "PF-007");

      assert.strictEqual(pf007Diags.length, 3, "Should find exactly 3 PF-007 violations");
      assert.ok(pf007Diags.some(d => d.file === fileA), "Should flag lucide-react namespace import");
      assert.ok(pf007Diags.some(d => d.file === fileD), "Should flag lodash root named import");
      assert.ok(pf007Diags.some(d => d.file === fileF), "Should flag lodash namespace import");
      assert.ok(!pf007Diags.some(d => d.file === fileB), "Should NOT flag optimized react-icons");
      assert.ok(!pf007Diags.some(d => d.file === fileC), "Should NOT flag correct lucide-react named imports");
      assert.ok(!pf007Diags.some(d => d.file === fileE), "Should NOT flag lodash deep import");
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

      // firebase.ts (client SDK, public env variables) - should be safe and skip
      const fileE = path.join(tempDir, "firebase.ts");
      fs.writeFileSync(fileE, `
        import { initializeApp } from "firebase/app";
        import { getFirestore } from "firebase/firestore";
        const app = initializeApp({ apiKey: process.env.NEXT_PUBLIC_API_KEY });
        export const db = getFirestore(app);
      `, "utf8");

      // firebase-private.ts (client SDK, private env database url) - should trigger warning
      const fileF = path.join(tempDir, "firebase-private.ts");
      fs.writeFileSync(fileF, `
        import { initializeApp } from "firebase/app";
        import { getFirestore } from "firebase/firestore";
        const app = initializeApp({ apiKey: process.env.DATABASE_URL });
        export const db = getFirestore(app);
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
          createMockAnalysis(fileE, {
            importDetails: [
              { moduleSpecifier: "firebase/app", namedImports: ["initializeApp"], defaultImport: null, namespaceImport: null, isTypeOnly: false },
              { moduleSpecifier: "firebase/firestore", namedImports: ["getFirestore"], defaultImport: null, namespaceImport: null, isTypeOnly: false },
            ]
          }),
          createMockAnalysis(fileF, {
            importDetails: [
              { moduleSpecifier: "firebase/app", namedImports: ["initializeApp"], defaultImport: null, namespaceImport: null, isTypeOnly: false },
              { moduleSpecifier: "firebase/firestore", namedImports: ["getFirestore"], defaultImport: null, namespaceImport: null, isTypeOnly: false },
            ]
          }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      const diagnostics = serverOnlyBoundary.run(context);
      const sc002Diags = diagnostics.filter(d => d.id === "SC-SECURITY-002");

      assert.strictEqual(sc002Diags.length, 2, "Should find exactly 2 SC-SECURITY-002 violations");
      assert.ok(sc002Diags.some(d => d.file === fileA), "Should flag fileA");
      assert.ok(sc002Diags.some(d => d.file === fileF), "Should flag fileF (contains secret env)");
      assert.ok(!sc002Diags.some(d => d.file === fileE), "Should NOT flag fileE (pure Firebase client SDK with public envs)");
    }

    // =========================================================================
    // 5. Test DF-005 and RO-007 (waterfall precision check)
    // =========================================================================
    {
      // Create separate subdirectories inside a simulated "app" folder
      const appDir = path.join(tempDir, "app");
      fs.mkdirSync(appDir, { recursive: true });

      const dirA = path.join(appDir, "a");
      fs.mkdirSync(dirA, { recursive: true });
      const fileA = path.join(dirA, "page.tsx");
      fs.writeFileSync(fileA, `
        export default async function Page(req: any) {
          const user = await req.json();
          const options = await req.formData();
          return { user, options };
        }
      `, "utf8");

      const dirB = path.join(appDir, "b");
      fs.mkdirSync(dirB, { recursive: true });
      const fileB = path.join(dirB, "page.tsx");
      fs.writeFileSync(fileB, `
        import { cookies, headers } from "next/headers";
        export default async function Page() {
          const c = await cookies();
          const h = await headers();
          return { c, h };
        }
      `, "utf8");

      const dirC = path.join(appDir, "c");
      fs.mkdirSync(dirC, { recursive: true });
      const fileC = path.join(dirC, "page.tsx");
      fs.writeFileSync(fileC, `
        export default async function Page() {
          const user = await fetch('/api/user');
          const posts = await db.user.findMany();
          return { user, posts };
        }
      `, "utf8");

      const dirD = path.join(appDir, "d");
      fs.mkdirSync(dirD, { recursive: true });
      const fileD = path.join(dirD, "page.tsx");
      fs.writeFileSync(fileD, `
        import { getUser } from "./user";
        import { getPosts } from "./posts";
        export default async function Page() {
          const user = await getUser();
          const posts = await getPosts();
          return { user, posts };
        }
      `, "utf8");

      const context: RuleContext = {
        analyses: [
          createMockAnalysis(fileA, { isRouting: true, hasAsyncComponent: true }),
          createMockAnalysis(fileB, { isRouting: true, hasAsyncComponent: true }),
          createMockAnalysis(fileC, { isRouting: true, hasAsyncComponent: true }),
          createMockAnalysis(fileD, { isRouting: true, hasAsyncComponent: true }),
        ],
        graph: new Graph(),
        nodes: new Map(),
        edges: [],
        knowledgeRegistry: { getConstraint: () => null } as any
      };

      // Run routing rules (RO-007)
      const diagnosticsRouting = routingPatterns.run(context);
      console.log("DEBUG diagnosticsRouting:", JSON.stringify(diagnosticsRouting.map(d => ({ id: d.id, file: d.file, message: d.message })), null, 2));
      const ro007Diags = diagnosticsRouting.filter(d => d.id === "RO-007");

      assert.ok(!ro007Diags.some(d => d.file === fileA), "Should NOT flag request parsing in RO-007");
      assert.ok(!ro007Diags.some(d => d.file === fileB), "Should NOT flag framework control APIs in RO-007");
      assert.ok(ro007Diags.some(d => d.file === fileC), "Should flag real I/O waterfall in RO-007");
      assert.ok(ro007Diags.some(d => d.file === fileD), "Should flag user-defined async I/O waterfall in RO-007");

      // Run data fetching rules (DF-005)
      const diagnosticsData = dataFetchingPatterns.run(context);
      const df005Diags = diagnosticsData.filter(d => d.id === "DF-005");

      assert.ok(!df005Diags.some(d => d.file === fileA), "Should NOT flag request parsing in DF-005");
      assert.ok(!df005Diags.some(d => d.file === fileB), "Should NOT flag framework control APIs in DF-005");
      assert.ok(df005Diags.some(d => d.file === fileC), "Should flag real I/O waterfall in DF-005");
      assert.ok(df005Diags.some(d => d.file === fileD), "Should flag user-defined async I/O waterfall in DF-005");
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
