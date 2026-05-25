import type { HydrationSemantics, NonDeterministicExpr, BrowserGlobalInRender } from "./types.js";
import type { FileAnalysis } from "../analyzer/types.js";
import fs from "node:fs";

/**
 * Classifies the hydration status and risks of the file, checking for
 * non-deterministic execution and unguarded browser APIs during render.
 */
export function detectHydration(analysis: FileAnalysis): HydrationSemantics {
  const isHydrationBoundary = analysis.isClientComponent;
  const nonDeterministic: NonDeterministicExpr[] = [];
  const browserGlobals: BrowserGlobalInRender[] = [];
  const hydrationRisks: string[] = [];

  if (isHydrationBoundary && fs.existsSync(analysis.filePath)) {
    try {
      const content = fs.readFileSync(analysis.filePath, "utf8");
      const lines = content.split("\n");

      let insideSafeHook = false;
      let openBraces = 0;

      lines.forEach((lineText, idx) => {
        const lineNum = idx + 1;

        if (/useEffect\s*\(/.test(lineText)) {
          insideSafeHook = true;
          openBraces = (lineText.match(/\{/g) || []).length - (lineText.match(/\}/g) || []).length;
        } else if (insideSafeHook) {
          openBraces += (lineText.match(/\{/g) || []).length - (lineText.match(/\}/g) || []).length;
          if (openBraces <= 0) {
            insideSafeHook = false;
          }
        }

        const insideEventHandler = /onClick|onChange|onSubmit|onKeyDown|onKeyUp|onFocus|onBlur/.test(lineText);
        const isDeferred = insideSafeHook || insideEventHandler;

        if (lineText.includes("Math.random(")) {
          nonDeterministic.push({
            line: lineNum,
            expression: "Math.random()",
            isSafelyDeferred: isDeferred,
          });
          if (!isDeferred) {
            hydrationRisks.push(`Line ${lineNum}: Unsafe access to 'Math.random()' during render phase.`);
          }
        }

        if (lineText.includes("Date.now(") || lineText.includes("new Date(")) {
          nonDeterministic.push({
            line: lineNum,
            expression: lineText.includes("Date.now(") ? "Date.now()" : "new Date()",
            isSafelyDeferred: isDeferred,
          });
          if (!isDeferred) {
            hydrationRisks.push(`Line ${lineNum}: Unsafe access to non-deterministic date constructor during render phase.`);
          }
        }

        const hasBrowserGlobal = /\b(window|document|localStorage|sessionStorage|navigator)\b/.test(lineText);
        if (hasBrowserGlobal) {
          const isGuarded = lineText.includes("typeof window") || lineText.includes("typeof document") || isDeferred;
          browserGlobals.push({
            line: lineNum,
            global: lineText.match(/\b(window|document|localStorage|sessionStorage|navigator)\b/)?.[1] || "window",
            isSafelyGuarded: isGuarded,
          });
          if (!isGuarded) {
            hydrationRisks.push(`Line ${lineNum}: Unsafe access to browser global '${hasBrowserGlobal}' during render phase.`);
          }
        }
      });
    } catch (e) {
      // ignore
    }
  }

  const riskLevel = hydrationRisks.length > 0 ? "high" : "none";
  const hasRenderSafeBrowserApis = isHydrationBoundary && hydrationRisks.length === 0;

  return {
    isHydrationBoundary,
    hasRenderSafeBrowserApis,
    hydrationRisks,
    riskLevel,
    nonDeterministicExpressions: nonDeterministic,
    browserGlobalsInRender: browserGlobals,
  };
}
