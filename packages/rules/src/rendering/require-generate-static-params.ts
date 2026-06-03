import { Rule, RuleContext, Diagnostic } from "../types.js";
import fs from "node:fs";
import path from "node:path";

/**
 * Rule: rendering-require-generate-static-params
 *
 * Detection logic: check to see if a dynamic route segment
 * (indicated by a '[' in the file path, typically a page.tsx) exports a
 * generateStaticParams function.
 *
 * Semantics: sourced from the "Rendering" knowledge pack constraint RE-003.
 *
 * Severity tiers:
 *  - RE-003-EXPORT  (BLOCKER, 9.5): output:'export' build mode requires it — build will fail.
 *  - RE-003         (WARNING, 7.0): static-eligible route, no dynamic triggers — should add it.
 *  - RE-003-DYNAMIC (INFO,    2.0): route is already dynamic (cookies/headers/etc.) — not required.
 *    Emitting INFO instead of silently skipping helps users understand why the rule doesn't fire.
 */

/**
 * Detect whether the project uses Next.js `output: 'export'` static export mode.
 * Reads next.config.js / next.config.ts / next.config.mjs from the project root.
 */
function detectStaticExportMode(filePath: string): boolean {
  // Walk up from the file to find a next.config file
  const parts = filePath.replace(/\\/g, "/").split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const dir = parts.slice(0, i).join("/");
    for (const configName of ["next.config.js", "next.config.ts", "next.config.mjs", "next.config.cjs"]) {
      const configPath = `${dir}/${configName}`;
      try {
        if (fs.existsSync(configPath)) {
          const configContent = fs.readFileSync(configPath, "utf-8");
          if (/output\s*:\s*['"]export['"]/.test(configContent)) {
            return true;
          }
        }
      } catch {
        // ignore FS errors
      }
    }
  }
  return false;
}

export const requireGenerateStaticParams: Rule = {
  id: "rendering-require-generate-static-params",

  meta: {
    description:
      "Dynamic route segments should export generateStaticParams to enable static rendering.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("rendering", "RE-003");

    const whyItMatters = constraint?.whyItMatters ?? "Dynamic route segments should export generateStaticParams to enable static rendering.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    // Cache export-mode detection per run (expensive FS read)
    let exportModeChecked = false;
    let isExportMode = false;

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const normalizedPath = analysis.filePath.replace(/\\/g, "/");

      const isPage =
        normalizedPath.endsWith("/page.tsx") ||
        normalizedPath.endsWith("/page.jsx") ||
        normalizedPath.endsWith("/page.js");
      const isDynamicSegment =
        normalizedPath.includes("/[") || normalizedPath.includes("\\[");

      if (!isPage || !isDynamicSegment) continue;

      // Already has generateStaticParams — nothing to do
      const hasGenerateStaticParams =
        analysis.executionModel.architectureFlags.includes("has-static-params");
      if (hasGenerateStaticParams) continue;

      let content = "";
      if (fs.existsSync(analysis.filePath)) {
        try {
          content = fs.readFileSync(analysis.filePath, "utf8");
        } catch {
          // ignore
        }
      }

      // ── Detect output: 'export' mode (once per rule run) ──────────────────
      if (!exportModeChecked) {
        isExportMode = detectStaticExportMode(analysis.filePath);
        exportModeChecked = true;
      }

      // ── RE-003-EXPORT: Static export build mode requires generateStaticParams ─
      if (isExportMode) {
        diagnostics.push({
          file: analysis.filePath,
          severity: "error",
          ruleId: this.id,
          id: "RE-003-EXPORT",
          message: `next.config output: 'export' requires generateStaticParams() on all dynamic route segments. Without it the build will fail — Next.js cannot statically export an unknown set of paths.`,
          fix: quickFixes[0],
          whyItMatters: "Static export mode pre-renders every page at build time. A dynamic route segment with no generateStaticParams() means the build has no way to enumerate the paths to pre-render.",
          quickFixes: [
            `Export generateStaticParams() from this page: export async function generateStaticParams() { return [{ id: '1' }, { id: '2' }]; }`,
            `Or set export const dynamicParams = false to return 404 for any unknown path.`,
          ],
          architectureSuggestions: [
            "In output:'export' mode every path must be known at build time. Use generateStaticParams() to enumerate all valid param combinations.",
          ],
          optimizationGuidance,
          productionRisks: [
            "Build fails at next build — deployment blocked.",
          ],
          examples: constraint?.examples,
        });
        continue;
      }

      // ── Check for explicit dynamic config (force-dynamic / revalidate = 0) ──
      const hasDynamicConfig =
        analysis.executionModel.architectureFlags.includes("dynamic-force-dynamic") ||
        analysis.executionModel.architectureFlags.includes("revalidate-0") ||
        /export\s+const\s+dynamic\s*=\s*['"]force-dynamic['"]/.test(content) ||
        /export\s+const\s+revalidate\s*=\s*0/.test(content);

      if (hasDynamicConfig) continue; // explicit opt-out — not a concern

      // ── Detect dynamic triggers (cookies/headers/searchParams etc.) ────────
      const hasDynamicTriggers =
        analysis.executionModel.usesServerApis.some((api: string) =>
          api.includes("cookies") ||
          api.includes("headers") ||
          api.includes("unstable_noStore") ||
          api.includes("draftMode") ||
          api.includes("connection")
        ) ||
        /cookies\(\)|headers\(\)|draftMode\(\)|connection\(\)|unstable_noStore\(\)|Date\.now\(\)|Math\.random\(\)/.test(content) ||
        (content.includes("searchParams") && !content.includes("export const dynamic")) ||
        analysis.executionModel.fetchStrategy.cacheMode === "no-store" ||
        analysis.executionModel.fetchStrategy.revalidate === 0 ||
        /\bcache\s*:\s*['"]no-store['"]/.test(content) ||
        /\brevalidate\s*:\s*0\b/.test(content);

      // ── RE-003-DYNAMIC: Route is already dynamic — generateStaticParams not needed ─
      if (hasDynamicTriggers) {
        diagnostics.push({
          file: analysis.filePath,
          severity: "info",
          ruleId: this.id,
          id: "RE-003-DYNAMIC",
          message: `Dynamic route [${path.basename(path.dirname(normalizedPath))}] uses request-time APIs (cookies/headers/searchParams) — generateStaticParams() is not required. The route is intentionally dynamic and will render per-request.`,
          fix: "No action needed. Confirm this is intentional dynamic rendering.",
          whyItMatters: "generateStaticParams() only applies to statically pre-rendered routes. Routes that use cookies(), headers(), or searchParams are inherently request-time dynamic and cannot be pre-rendered.",
          quickFixes: [
            "If you want static generation, remove the dynamic API usage and add generateStaticParams().",
            "To make the intent explicit, add: export const dynamic = 'force-dynamic'",
          ],
          architectureSuggestions: [
            "Categorise dynamic routes: finite known paths → generateStaticParams() for SSG; truly dynamic routes → force-dynamic with ISR or CDN caching.",
          ],
          optimizationGuidance: [
            "Consider extracting the dynamic API (e.g. cookies()) into a child Suspense boundary so the shell can be static while only the dynamic part renders on-demand.",
          ],
          productionRisks: [],
          examples: constraint?.examples,
        });
        continue;
      }

      // ── RE-003: Static-eligible route missing generateStaticParams ──────────
      const hasFetches =
        analysis.fetchCalls.length > 0 || analysis.executionModel.fetchStrategy.hasFetch;
      const hasDbQueries = /\b(db\.\w+|prisma\.\w+|drizzle\.\w+)\b/.test(content);
      const hasCustomFetchFunctions = /\b(get|fetch|load)[A-Z]\w*/.test(content);
      const appearsStaticallyFetchable = hasFetches || hasDbQueries || hasCustomFetchFunctions;

      if (!appearsStaticallyFetchable) continue;

      // Only warn if there is explicit static/cacheable intent
      const hasStaticConfig =
        analysis.executionModel.architectureFlags.includes("dynamic-force-static") ||
        analysis.rendering.mode === "isr" ||
        (analysis.rendering.revalidate !== null && analysis.rendering.revalidate !== 0) ||
        /export\s+const\s+dynamic\s*=\s*['"]force-static['"]/.test(content) ||
        /export\s+const\s+revalidate\s*=\s*(?!0\b)\w+/.test(content);

      const hasExplicitCacheableFetch =
        analysis.fetchCalls.some(f => 
          f.cacheStrategy === "force-cache" || 
          (f.cacheStrategy === "revalidate" && f.revalidateValue !== 0 && f.revalidateValue !== "0")
        ) ||
        /fetch\([^,]+,\s*\{\s*cache\s*:\s*['"]force-cache['"]/.test(content) ||
        /fetch\([^,]+,\s*\{\s*next\s*:\s*\{\s*revalidate\s*:\s*(?!0\b)\w+/.test(content);

      const hasStaticIntent = hasStaticConfig || hasExplicitCacheableFetch;

      if (!hasStaticIntent) {
        diagnostics.push({
          file: analysis.filePath,
          severity: "info",
          ruleId: this.id,
          id: "RE-003-OPT",
          message: `Optimization Opportunity: Known finite routes can use generateStaticParams() to enable static pre-rendering, avoiding dynamic request-time compilation.`,
          fix: `Export generateStaticParams() to pre-render known parameters: export async function generateStaticParams() { return [{ id: '1' }]; }`,
          whyItMatters: "Statically generating known route segments pre-renders them to fast static HTML at build time, improving TTFB and edge cacheability.",
          quickFixes: [
            `Export generateStaticParams() from this page: export async function generateStaticParams() { return [{ id: '1' }, { id: '2' }]; }`,
            `Or set export const dynamicParams = false to return 404 for any unknown path.`,
          ],
          architectureSuggestions: [
            "If your route contains finite datasets (like a known list of categories or blog posts), pre-render them statically.",
          ],
          optimizationGuidance: [
            "Use generateStaticParams() to enable the Full Route Cache for pre-rendered pages, shifting work from request-time to build-time.",
          ],
          productionRisks: [],
          examples: constraint?.examples,
        });
        continue;
      }

      diagnostics.push({
        file: analysis.filePath,
        severity: constraint?.severity ?? "warning",
        ruleId: this.id,
        id: constraint?.id ?? "RE-003",
        message: `Dynamic route segment is missing generateStaticParams(). ${constraint?.problem ?? ""}`,
        fix: quickFixes[0],
        whyItMatters,
        quickFixes,
        architectureSuggestions,
        optimizationGuidance,
        productionRisks,
        examples: constraint?.examples,
      });
    }

    return diagnostics;
  },
};
