import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Rule: fetch-cache-config
 *
 * Detection logic: unchanged deterministic AST check on fetchCalls metadata.
 * Semantics (cache recommendations, rendering implications, optimisation
 * guidance): sourced entirely from the "Caching" knowledge pack constraint
 * DYNAMIC_RENDER_TRIGGER-001.
 *
 * Improvement: Classifies fetch() usage into specific categories instead of
 * emitting the same vague "Implicit fetch caching detected" for every match.
 *
 * Classification:
 *   - Mutation fetch (POST/PUT/DELETE/PATCH in Server Action) → SKIP (should not be cached)
 *   - Route with dynamic triggers (cookies/headers) → suggest no-store explicitly
 *   - Page without dynamic triggers → suggest force-cache or revalidate
 *   - Utility/DAL file → suggest force-cache + React.cache() wrapper
 *
 * Deduplication: if multiple uncached fetches exist in the same file, collapse
 * to a single diagnostic with a count.
 */

const UTIL_FOLDERS = new Set(["server", "shared", "lib", "utils", "helpers", "data", "dal", "services"]);
const ROUTING_BASENAMES = new Set(["page", "layout", "route", "template"]);

function fileContext(filePath: string): "server-action" | "routing-boundary" | "utility" | "other" {
  const fp = filePath.replace(/\\/g, "/");
  const basename = path.basename(fp, path.extname(fp));
  const segments = fp.split("/");

  if (ROUTING_BASENAMES.has(basename)) return "routing-boundary";
  if (UTIL_FOLDERS.some((f) => segments.includes(f))) return "utility";
  return "other";
}

function hasDynamicTrigger(content: string): boolean {
  return /cookies\s*\(\s*\)|headers\s*\(\s*\)|draftMode\s*\(\s*\)|connection\s*\(\s*\)|unstable_noStore\s*\(\s*\)/.test(content);
}

function isMutationFetch(content: string, fetchLine: number): boolean {
  // Heuristic: look for HTTP mutation methods near the fetch call
  const lines = content.split("\n");
  const windowStart = Math.max(0, fetchLine - 3);
  const windowEnd = Math.min(lines.length, fetchLine + 5);
  const window = lines.slice(windowStart, windowEnd).join("\n");
  return /\b(POST|PUT|DELETE|PATCH)\b/.test(window);
}

function isServerAction(content: string): boolean {
  return /"use server"/.test(content) || /'use server'/.test(content);
}

function buildMessage(
  mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE",
  ctx: ReturnType<typeof fileContext>,
  fetchCount: number
): string {
  const countLabel = fetchCount > 1 ? ` (${fetchCount} uncached fetch calls in this file)` : "";
  const base = `fetch()${countLabel} called without an explicit cache strategy`;

  if (ctx === "utility") {
    return (
      `${base}. Utility/DAL files that fetch data should declare an explicit cache strategy. ` +
      `Use { cache: 'force-cache' } for data that changes infrequently, ` +
      `or wrap the function with React.cache() for request-level deduplication. ` +
      `This makes the caching contract explicit and avoids implicit Next.js default behavior.`
    );
  }

  if (mode === "DYNAMIC_ROUTE") {
    return (
      `${base}. Since this route is classified as a DYNAMIC_ROUTE (uses dynamic APIs like cookies/headers), ` +
      `per-request rendering is expected. You should add { cache: 'no-store' } explicitly to make the ` +
      `dynamic intent clear and avoid relying on Next.js default behaviors.`
    );
  }

  if (mode === "STATIC_ROUTE") {
    return (
      `${base}. Since this route has no dynamic triggers, it is classified as a STATIC_ROUTE. ` +
      `In Next.js 15+, fetch() defaults to no-store (uncached). Use { cache: 'force-cache' } for static data ` +
      `that can be pre-rendered, or { next: { revalidate: N } } for ISR (time-based refresh) to enable caching.`
    );
  }

  // HYBRID_ROUTE
  return (
    `${base}. Classified as a HYBRID_ROUTE due to mixed static and dynamic requirements. ` +
    `Consider splitting your data fetching layers (RSC vs. Client Components) or using React.cache() ` +
    `to safely share query boundaries without breaking static pre-rendering.`
  );
}

function buildQuickFixes(
  mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE",
  ctx: ReturnType<typeof fileContext>
): string[] {
  if (ctx === "utility") {
    return [
      "Add { cache: 'force-cache' } for stable reference data: fetch(url, { cache: 'force-cache' })",
      "Or wrap the utility function with React.cache() for request-level deduplication.",
      "For time-based refresh: fetch(url, { next: { revalidate: 60 } })",
    ];
  }
  if (mode === "DYNAMIC_ROUTE") {
    return [
      "Add { cache: 'no-store' } to make dynamic intent explicit: fetch(url, { cache: 'no-store' })",
      "Or add { next: { tags: ['my-tag'] } } for on-demand revalidation support.",
    ];
  }
  if (mode === "HYBRID_ROUTE") {
    return [
      "Wrap the fetch or data acquisition logic in React.cache() to deduplicate requests.",
      "Add { cache: 'no-store' } if the fetch should always hit the server.",
      "Or use fetch(url, { next: { revalidate: 60 } }) to allow caching on a hybrid route.",
    ];
  }
  return [
    "Static data: fetch(url, { cache: 'force-cache' })",
    "ISR / time-based: fetch(url, { next: { revalidate: 60 } })",
    "Truly dynamic: fetch(url, { cache: 'no-store' })",
  ];
}

export const fetchCacheConfig: Rule = {
  id: "fetch-cache-config",

  meta: {
    description:
      "Fetch calls in Next.js Server Components should have explicit cache or revalidate configuration.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraintById("DF-001");

    const whyItMatters =
      constraint?.whyItMatters ??
      "In Next.js 15+, fetch() calls are no-store by default. Without explicit cache settings, every render hits the network, eliminating the Data Cache and increasing TTFB.";
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      if (analysis.executionModel.componentType === "client") continue;

      const { fetchStrategy } = analysis.executionModel;
      if (
        !fetchStrategy.hasFetch ||
        fetchStrategy.cacheMode !== null ||
        fetchStrategy.revalidate !== null
      ) {
        continue; // already configured or no fetch calls
      }

      // Read file content for context classification
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        // ignore
      }

      // ── Skip Server Action mutation fetches ──────────────────────────────────
      // POST/PUT/DELETE/PATCH in a "use server" file shouldn't be cached
      if (isServerAction(content)) {
        const fetchLine = analysis.fetchCalls[0]?.line ?? 1;
        if (isMutationFetch(content, fetchLine)) continue;
      }

      // ── Classify file context ─────────────────────────────────────────────
      const ctx = fileContext(analysis.filePath);
      const fetchCount = analysis.fetchCalls.length || 1;

      // ── Classify Route Render Mode ──────────────────────────────────────────
      const isDynamic = hasDynamicTrigger(content) || 
                        analysis.rendering.mode === "dynamic" ||
                        analysis.executionModel.architectureFlags.includes("dynamic-force-dynamic");
                        
      const hasStaticIntent = /export\s+const\s+revalidate\s*=\s*[1-9]\d*/.test(content) || 
                              analysis.rendering.mode === "isr" ||
                              analysis.rendering.mode === "ppr" ||
                              analysis.executionModel.architectureFlags.includes("has-static-params") ||
                              analysis.filePath.includes("["); // dynamic route segment which might be static/ISR

      let mode: "STATIC_ROUTE" | "DYNAMIC_ROUTE" | "HYBRID_ROUTE" = "STATIC_ROUTE";
      if (isDynamic && hasStaticIntent) {
        mode = "HYBRID_ROUTE";
      } else if (isDynamic) {
        mode = "DYNAMIC_ROUTE";
      } else {
        mode = "STATIC_ROUTE";
      }

      const message = buildMessage(mode, ctx, fetchCount);
      const quickFixes = buildQuickFixes(mode, ctx);

      diagnostics.push({
        file: analysis.filePath,
        line: analysis.fetchCalls[0]?.line,
        column: analysis.fetchCalls[0]?.column,
        endColumn: analysis.fetchCalls[0]?.endColumn,
        severity: constraint?.severity ?? "warning",
        ruleId: this.id,
        id: constraint?.id ?? "DF-001",

        message,
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
