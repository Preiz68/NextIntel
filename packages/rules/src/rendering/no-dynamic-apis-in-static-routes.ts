import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

/**
 * Rule: no-dynamic-apis-in-static-routes
 *
 * Detects usage of dynamic runtime APIs (cookies(), headers(), draftMode())
 * inside layout components or segments marked as force-static, as this invalidates
 * static generation / Full Route Cache.
 *
 * Semantics: Sourced from "Caching" knowledge pack constraint DYNAMIC_RENDER_TRIGGER-003.
 */
export const noDynamicApisInStaticRoutes: Rule = {
  id: "no-dynamic-apis-in-static-routes",

  meta: {
    description: "Do not call dynamic APIs (cookies, headers) inside layout components or static route segments.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("caching", "DYNAMIC_RENDER_TRIGGER-003");
    const whyItMatters = constraint?.whyItMatters ?? "Using runtime APIs (cookies(), headers()) in a Server Component without Suspense wrapping causes the entire route to be dynamically rendered, disabling Full Route Cache.";
    const quickFixes = constraint?.quickFixes ?? ["Extract the cookies()/headers() call into a child component wrapped in <Suspense>."];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    // Helper to check if a file path is a page or layout
    const isPageOrLayout = (filePath: string) => {
      const base = path.basename(filePath).toLowerCase();
      return base.startsWith("page.") || base.startsWith("layout.");
    };

    // Helper to find if a node can reach a target node in the graph
    const canReach = (start: string, target: string): boolean => {
      if (start === target) return true;
      const visited = new Set<string>();
      const queue = [start];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        if (curr === target) return true;
        if (visited.has(curr)) continue;
        visited.add(curr);
        const successors = context.graph?.successors(curr) || [];
        for (const succ of successors) {
          queue.push(succ);
        }
      }
      return false;
    };

    // Dynamic API names recognized as render-phase triggers
    const DYNAMIC_API_NAMES = ["cookies", "headers", "draftMode", "unstable_noStore", "connection"];

    /**
     * Verify via ts-morph AST that a file actually contains a direct CallExpression
     * to one of the dynamic APIs. Returns {found: true, symbol, line} or {found: false}.
     */
    const verifyDynamicCallAST = (filePath: string): { found: boolean; symbol: string; line: number } => {
      let fileContent = "";
      try { fileContent = readFileSync(filePath, "utf-8"); } catch { return { found: false, symbol: "", line: 1 }; }
      const project = new Project({ useInMemoryFileSystem: true });
      const sf = project.createSourceFile("check.ts", fileContent);
      const calls = sf.getDescendantsOfKind(SyntaxKind.CallExpression).filter(call => {
        const name = call.getExpression().getText();
        return DYNAMIC_API_NAMES.includes(name);
      });
      if (calls.length === 0) return { found: false, symbol: "", line: 1 };
      const first = calls[0]!;
      return { found: true, symbol: first.getExpression().getText(), line: first.getStartLineNumber() };
    };

    for (const analysis of context.analyses) {
      // Hard partition guard: only process server-side files
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const filePath = analysis.filePath;

      // ── Only flag page/layout files ────────────────────────────────────────
      // Utility files using headers()/cookies() are perfectly valid server-side code.
      // We only emit diagnostics when a page/layout is explicitly configured as
      // force-static and either directly calls, or transitively imports a caller of,
      // a dynamic API.
      if (!isPageOrLayout(filePath)) continue;

      let content = "";
      try { content = readFileSync(filePath, "utf-8"); } catch { continue; }

      // Guard: only flag if segment is explicitly opting into force-static
      const isForceStatic = content.includes("force-static");
      if (!isForceStatic) continue;

      // ── Case 1: Page/layout directly calls a dynamic API ─────────────────
      const directAST = verifyDynamicCallAST(filePath);
      if (directAST.found) {
        diagnostics.push({
          file: filePath,
          line: directAST.line,
          severity: "error",
          ruleId: this.id,
          id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-003",
          message: `Dynamic rendering conflict: '${directAST.symbol}()' is called directly inside a page/layout configured as 'force-static'. This invalidates the static render constraint and will throw at runtime.`,
          fix: quickFixes[0],
          whyItMatters,
          quickFixes,
          architectureSuggestions,
          optimizationGuidance,
          productionRisks,
          examples: constraint?.examples,
        });
        continue;
      }

      // ── Case 2: Page/layout imports a utility that calls a dynamic API ────
      // We require AST-level verification on the utility file — not just metadata.
      let dynamicUtil: string | null = null;
      let utilSymbol = "";
      let utilLine = 1;

      for (const other of context.analyses) {
        if (other.filePath === filePath) continue;
        // Quick pre-filter: metadata must indicate some dynamic trigger before we run AST
        const metadataSuggestsTrigger = other.rendering?.triggers?.some((t: string) => DYNAMIC_API_NAMES.includes(t));
        if (!metadataSuggestsTrigger) continue;
        // Confirm the page/layout actually reaches this file through the import graph
        if (!canReach(filePath, other.filePath)) continue;
        // AST-level verification: confirm the utility actually has the call expression
        const astResult = verifyDynamicCallAST(other.filePath);
        if (!astResult.found) continue;
        dynamicUtil = other.filePath;
        utilSymbol = astResult.symbol;
        utilLine = astResult.line;
        break;
      }

      if (dynamicUtil) {
        // Find the import line in the page/layout for precise location
        let importLine = 1;
        const utilBase = path.basename(dynamicUtil, path.extname(dynamicUtil));
        const pageLines = content.split("\n");
        for (let i = 0; i < pageLines.length; i++) {
          const l = pageLines[i]!;
          if (l.includes(utilBase) && (l.includes("import") || l.includes("require"))) {
            importLine = i + 1;
            break;
          }
        }

        diagnostics.push({
          file: filePath,
          line: importLine,
          severity: "error",
          ruleId: this.id,
          id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-003",
          message: `Dynamic rendering conflict: Page/layout configured as 'force-static' imports '${path.basename(dynamicUtil)}' (line ${utilLine}) which calls '${utilSymbol}()'. Remove the dynamic call or change the segment export config.`,
          fix: `Isolate the dynamic API call into a separate dynamically-rendered child component, or remove the force-static export.`,
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
  }
};
