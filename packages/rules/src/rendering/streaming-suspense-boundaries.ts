import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Rule: streaming-suspense-boundaries
 *
 * Detection logic: Deterministically detects calling cookies() or headers()
 * inside layout files via `analysis.rendering.triggers` tracking, which blocks static shell streaming.
 *
 * Semantics: Sourced from "Streaming" knowledge pack constraint DYNAMIC_LAYOUT_IMPACT.
 *
 * Cookie purpose classification (uses both variable name + cookie key string):
 *   COSMETIC  → theme, lang, locale, color, mode, currency, timezone   → INFO  (score 3.0)
 *   AUTH      → auth, token, session, jwt, user, role, access, identity → HIGH  (score 6.0)
 *   CRITICAL  → entire-subtree conditional rendering on cookie value    → HIGH+ (score 7.5)
 *   UNKNOWN   → any other cookie access                                 → MEDIUM (score 5.0)
 */

// ── Cookie purpose classifier ────────────────────────────────────────────────

const COSMETIC_PATTERNS = /\b(theme|lang|locale|color|colour|mode|currency|timezone|tz|region|country|display|font)\b/i;
const AUTH_PATTERNS     = /\b(auth|token|session|jwt|user|role|access|identity|credential|permission|claim|bearer|refresh|csrf|xsrf|sid)\b/i;

type CookiePurpose = "COSMETIC" | "AUTH" | "CRITICAL" | "UNKNOWN";

/**
 * Determine the purpose of the cookie access by inspecting:
 * 1. The string key passed to cookies().get("key")
 * 2. The variable name the result is assigned to
 */
function classifyCookiePurpose(content: string): CookiePurpose {
  // Extract all cookies().get("...") and headers().get("...") key strings
  const cookieKeys: string[] = [];
  for (const match of content.matchAll(/cookies\s*\(\s*\)\s*\.\s*get\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    cookieKeys.push(match[1]!);
  }
  for (const match of content.matchAll(/headers\s*\(\s*\)\s*\.\s*get\s*\(\s*['"`]([^'"`]+)['"`]/g)) {
    cookieKeys.push(match[1]!);
  }

  // Extract variable names assigned from cookies() and headers() results
  const varNames: string[] = [];
  for (const match of content.matchAll(/const\s+(\w+)\s*=\s*cookies\s*\(\s*\)/g)) {
    varNames.push(match[1]!);
  }
  for (const match of content.matchAll(/const\s+(\w+)\s*=\s*cookies\s*\(\s*\)\s*\.\s*get/g)) {
    varNames.push(match[1]!);
  }
  for (const match of content.matchAll(/const\s+(\w+)\s*=\s*headers\s*\(\s*\)/g)) {
    varNames.push(match[1]!);
  }
  for (const match of content.matchAll(/const\s+(\w+)\s*=\s*headers\s*\(\s*\)\s*\.\s*get/g)) {
    varNames.push(match[1]!);
  }

  // Check if the layout conditionally renders large subtrees based on cookie values
  // Pattern: if (cookieVar) { ... <Component /> ... } with JSX inside
  const hasConditionalRender =
    /if\s*\([^)]*\)\s*\{[^}]*<[A-Z]/.test(content) &&
    (content.includes("cookies()") || content.includes("cookies("));

  if (hasConditionalRender) return "CRITICAL";

  // Check cookie keys first (more precise signal)
  for (const key of cookieKeys) {
    if (AUTH_PATTERNS.test(key)) return "AUTH";
    if (COSMETIC_PATTERNS.test(key)) return "COSMETIC";
  }

  // Fall back to variable names
  for (const v of varNames) {
    if (AUTH_PATTERNS.test(v)) return "AUTH";
    if (COSMETIC_PATTERNS.test(v)) return "COSMETIC";
  }

  return "UNKNOWN";
}

/**
 * Map cookie purpose to a diagnostic-facing score override ID.
 * Engine will apply the corresponding HARD_GATED_SCORE.
 */
function purposeToId(purpose: CookiePurpose, layoutDepth: number): string {
  if (purpose === "CRITICAL") return "DYNAMIC_LAYOUT_IMPACT-CRITICAL";
  if (purpose === "AUTH")     return "DYNAMIC_LAYOUT_IMPACT-AUTH";
  if (purpose === "COSMETIC") return "DYNAMIC_LAYOUT_IMPACT-COSMETIC";
  // UNKNOWN: root layout is more severe than nested
  return layoutDepth === 0 ? "DYNAMIC_LAYOUT_IMPACT" : "DYNAMIC_LAYOUT_IMPACT-NESTED";
}

function purposeToMessage(purpose: CookiePurpose, depthLabel: string): string {
  switch (purpose) {
    case "CRITICAL":
      return `Cookie-conditional layout rendering detected in ${depthLabel}. The entire subtree renders conditionally based on a cookie value — this forces every page in the subtree into request-time dynamic rendering. This is a significant architectural tradeoff.`;
    case "AUTH":
      return `Auth/session cookie accessed in ${depthLabel}. This disables full-route static caching for ALL users — every request hits the server. Consider moving auth checks to middleware or individual page/layout segments instead.`;
    case "COSMETIC":
      return `Cosmetic cookie (theme/locale) accessed in ${depthLabel}. Low impact — only affects static shell pre-rendering for personalization. Streaming still works. This is an acceptable tradeoff for most apps.`;
    default:
      return `Dynamic request-time API (cookies/headers) detected in ${depthLabel}. This forces the layout segment into dynamic on-demand rendering, disabling full-route static caching. Streaming still works — this is a performance tradeoff, not a crash.`;
  }
}

function purposeToSeverity(purpose: CookiePurpose): "error" | "warning" | "info" {
  if (purpose === "CRITICAL") return "warning"; // HIGH warning
  if (purpose === "AUTH")     return "warning"; // HIGH warning
  if (purpose === "COSMETIC") return "info";    // LOW info
  return "warning";                             // MEDIUM warning
}

// ── Rule ─────────────────────────────────────────────────────────────────────

export const streamingSuspenseBoundaries: Rule = {
  id: "streaming-suspense-boundaries",

  meta: {
    description: "Avoid dynamic request-time APIs blocking initial layout streaming.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const constraint = context.knowledgeRegistry.getConstraint("streaming", "DYNAMIC_LAYOUT_IMPACT");

    const whyItMatters = constraint?.whyItMatters ?? "Calling cookies() or headers() inside a root layout block forces the layout into dynamic on-demand rendering.";
    const quickFixes = constraint?.quickFixes ?? [];
    const architectureSuggestions = constraint?.architectureSuggestions ?? [];
    const optimizationGuidance = constraint?.optimizationGuidance ?? [];
    const productionRisks = constraint?.productionRisks ?? [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const normalizedPath = analysis.filePath.replace(/\\/g, "/");
      const isLayout =
        normalizedPath.endsWith("/layout.tsx") ||
        normalizedPath.endsWith("/layout.jsx") ||
        normalizedPath.endsWith("/layout.js");

      if (!isLayout) continue;

      const hasBlockingTrigger = analysis.executionModel.usesServerApis.some(
        (api: string) => api.includes("cookies") || api.includes("headers")
      );

      if (!hasBlockingTrigger) continue;

      // ── Compute layout depth ───────────────────────────────────────────────
      const appIdx = normalizedPath.indexOf("/app/");
      let layoutDepth = 0;
      if (appIdx !== -1) {
        const relPath = normalizedPath.substring(appIdx + 5);
        const segments = relPath.split("/").filter((s) => s.length > 0);
        layoutDepth = segments
          .slice(0, -1)
          .filter((s) => !s.startsWith("(") && !s.startsWith("@")).length;
      }

      const depthLabel =
        layoutDepth === 0
          ? "root layout (affects entire app)"
          : `nested layout at depth ${layoutDepth} (affects subtree only)`;

      // ── Read file content for cookie purpose classification ────────────────
      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        // fall through with empty content — classification will return UNKNOWN
      }

      const purpose = classifyCookiePurpose(content);
      const diagnosticId = purposeToId(purpose, layoutDepth);
      const message = purposeToMessage(purpose, depthLabel);
      const severity = purposeToSeverity(purpose);

      diagnostics.push({
        file: analysis.filePath,
        severity,
        ruleId: this.id,
        id: diagnosticId,
        fetchCount: undefined,
        isWaterfall: undefined,

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
