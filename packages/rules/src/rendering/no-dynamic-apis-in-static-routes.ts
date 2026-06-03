import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
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

    for (const analysis of context.analyses) {
      // Apply hard partition guard: Server Component/Utility only
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const filePath = analysis.filePath;
      const hasDirectTriggers = analysis.rendering.triggers.some(t =>
        t === "cookies" || t === "headers" || t === "draftMode" || t === "connection" || t === "unstable_noStore"
      );

      const base = path.basename(filePath).toLowerCase();
      const isLayout = base.startsWith("layout.");

      if (isPageOrLayout(filePath)) {
        let content = "";
        try {
          content = readFileSync(filePath, "utf-8");
        } catch {
          // ignore
        }
        const isForceStatic = content.includes("force-static");

        if (isLayout && !isForceStatic) {
          continue;
        }

        if (hasDirectTriggers) {
          // Case 1: Dynamic APIs in layout/page directly
          let line = 1;
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes("cookies(") || lines[i]!.includes("headers(")) {
              line = i + 1;
              break;
            }
          }

          diagnostics.push({
            file: filePath,
            line,
            severity: isForceStatic ? "error" : "warning",
            ruleId: this.id,
            id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-003",
            message: `Dynamic rendering transition: cookies()/headers() called directly inside page/layout. This triggers a transition to request-time dynamic rendering.`,
            fix: quickFixes[0],
            whyItMatters,
            quickFixes,
            architectureSuggestions,
            optimizationGuidance,
            productionRisks,
            examples: constraint?.examples,
          });
        } else {
          // Case 2: check if page/layout imports any utilities with dynamic triggers
          let dynamicUtil: string | null = null;
          let triggerSymbol: string | null = null;

          for (const other of context.analyses) {
            if (other.filePath !== filePath && other.rendering.triggers.length > 0) {
              if (canReach(filePath, other.filePath)) {
                dynamicUtil = other.filePath;
                triggerSymbol = other.rendering.triggers[0]!;
                break;
              }
            }
          }

          if (dynamicUtil) {
            let line = 1;
            const utilBase = path.basename(dynamicUtil, path.extname(dynamicUtil));
            const lines = content.split("\n");
            for (let i = 0; i < lines.length; i++) {
              if (lines[i]!.includes(utilBase) && (lines[i]!.includes("import") || lines[i]!.includes("require"))) {
                line = i + 1;
                break;
              }
            }

            diagnostics.push({
              file: filePath,
              line,
              severity: isForceStatic ? "error" : "warning",
              ruleId: this.id,
              id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-003",
              message: `Dynamic rendering transition: Page/layout imports component/utility '${path.basename(dynamicUtil)}' which uses dynamic API '${triggerSymbol}()'. This shifts the route rendering from static to dynamic.`,
              fix: `Isolate dynamic API usage or configure the segment dynamic rendering options.`,
              whyItMatters,
              quickFixes,
              architectureSuggestions,
              optimizationGuidance,
              productionRisks,
              examples: constraint?.examples,
            });
          }
        }
      } else {
        // This is a utility file (not page/layout)
        if (hasDirectTriggers) {
          // Check if it is imported by any page or layout (i.e. if it can be reached from any page/layout)
          const isImported = context.analyses.some(a => isPageOrLayout(a.filePath) && canReach(a.filePath, filePath));

          if (!isImported) {
            let line = 1;
            try {
              const fileContent = readFileSync(filePath, "utf-8");
              const lines = fileContent.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.includes("cookies(") || lines[i]!.includes("headers(")) {
                  line = i + 1;
                  break;
                }
              }
            } catch {}

            // Case 3: isolated utility with headers() -> info severity / safe warning
            diagnostics.push({
              file: filePath,
              line,
              severity: "info",
              ruleId: this.id,
              id: constraint?.id ?? "DYNAMIC_RENDER_TRIGGER-003",
              message: `Dynamic API is accessed inside isolated utility '${path.basename(filePath)}'. This is safe since it is never imported by any active page or layout route segment.`,
              fix: "No fix required while utility remains isolated.",
              whyItMatters: "Dynamic APIs in unimported files do not trigger dynamic route compilation.",
              quickFixes: [],
              architectureSuggestions: ["Ensure this utility is only imported by dynamic contexts if used in the future."],
              optimizationGuidance: [],
              productionRisks: [],
            });
          }
        }
      }
    }

    return diagnostics;
  }
};
