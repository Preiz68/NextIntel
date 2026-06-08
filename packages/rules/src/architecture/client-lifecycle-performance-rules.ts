import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const clientLifecyclePerformanceRules: Rule = {
  id: "client-lifecycle-performance-rules",

  meta: {
    description: "Enforce memo hydration, effect cleanups, lazy load options, next/image tags, and script optimization rules.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const HEAVY_PACKAGES = ["chart.js", "moment", "xlsx", "lodash", "pdfjs-dist", "monaco-editor"];

    for (const analysis of context.analyses) {
      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // 1. PE-OPTIMIZED-TAGS (img vs next/image, script check)
      if (content.includes("<img") && !content.includes("next/image")) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "PE-OPTIMIZED-TAGS",
          message: `HTML <img> tag used instead of 'next/image' component. Use Next.js Image component for lazy loading and layout shifts optimization.`,
          whyItMatters: "Using raw <img> tags forces loading full-size images and triggers Layout Shifts. Next/image handles sizing, optimization, and WebP compression."
        });
      }
      if (content.includes("<script") && !content.includes("next/script")) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "PE-OPTIMIZED-TAGS-SCRIPT",
          message: `HTML <script> tag used instead of 'next/script' component.`,
          whyItMatters: "Standard script tags block HTML parsing. Next/script provides configurable loading strategies (beforeInteractive, afterInteractive, lazyOnload)."
        });
      }

      // 2. CC-XSS-HTML (dangerouslySetInnerHTML)
      if (content.includes("dangerouslySetInnerHTML")) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "CC-XSS-HTML",
          message: `Usage of 'dangerouslySetInnerHTML' detected. Ensure all inputted dynamic string data is sanitized (e.g. using dompurify) to prevent XSS.`,
          whyItMatters: "Rendering un-sanitized dynamic user content inside HTML results in Cross-Site Scripting (XSS) security leaks."
        });
      }

      // 3. CC-OVERRIDE-CHILDREN (children overrides)
      if (analysis.isClientComponent && content.includes("children=") && (content.includes("<") && content.includes("/>"))) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "CC-OVERRIDE-CHILDREN",
          message: `Component sets the 'children' prop explicitly inside JSX attributes while enclosing children nodes.`,
          whyItMatters: "Overriding children via attributes conflicts with React's nesting model and is a syntax anti-pattern."
        });
      }

      // 4. PE-DYNAMIC-HEAVY (Heavy packages imports check)
      const imports = analysis.importDetails || [];
      for (const imp of imports) {
        const heavyMatch = HEAVY_PACKAGES.find(pkg => imp.moduleSpecifier === pkg || imp.moduleSpecifier.startsWith(pkg + "/"));
        if (heavyMatch && !content.includes("next/dynamic")) {
          diagnostics.push({
            file: analysis.filePath,
            line: imp.line ?? 1,
            severity: "warning",
            ruleId: this.id,
            id: "PE-DYNAMIC-HEAVY",
            message: `Heavy package '${imp.moduleSpecifier}' is imported directly in a Client Component. Consider lazy loading it via 'next/dynamic' to reduce client-side bundle size.`,
            whyItMatters: "Directly importing large packages increases the initial JS payload, slowing page load speed (LCP)."
          });
        }
      }

      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_client_perf.tsx", content);

        if (analysis.isClientComponent) {
          // 5. CC-MEMO-HYDRATION (window/document inside useMemo/useCallback)
          const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
          for (const call of calls) {
            const exprText = call.getExpression().getText();
            if (exprText === "useMemo" || exprText === "useCallback") {
              const bodyText = call.getArguments()[0]?.getText() ?? "";
              if (bodyText.includes("window") || bodyText.includes("document") || bodyText.includes("localStorage")) {
                diagnostics.push({
                  file: analysis.filePath,
                  line: call.getStartLineNumber(),
                  severity: "warning",
                  ruleId: this.id,
                  id: "CC-MEMO-HYDRATION",
                  message: `Browser API referenced inside '${exprText}' hook. These hooks run during server-side SSR prerendering and will crash due to missing globals.`,
                  whyItMatters: "Server prerendering executes useMemo/useCallback. Referencing browser-only API variables directly inside them causes hydration failures."
                });
              }
            }
          }

          // 6. CC-EFFECT-DEPS (Missing dependencies array)
          for (const call of calls) {
            const exprText = call.getExpression().getText();
            if (exprText === "useEffect") {
              const args = call.getArguments();
              if (args.length === 1) {
                diagnostics.push({
                  file: analysis.filePath,
                  line: call.getStartLineNumber(),
                  severity: "warning",
                  ruleId: this.id,
                  id: "CC-EFFECT-DEPS",
                  message: `'useEffect' hook is missing a dependencies array. This will trigger on every render. Pass an empty array [] or specific variables.`,
                  whyItMatters: "Omitting the dependencies array causes the effect to run after every single component render, causing performance degradation."
                });
              }

              // 7. CC-EVENT-CLEANUP (Missing event listener cleanup)
              const effectBody = args[0]?.getText() ?? "";
              if (effectBody.includes("addEventListener") && !effectBody.includes("removeEventListener")) {
                diagnostics.push({
                  file: analysis.filePath,
                  line: call.getStartLineNumber(),
                  severity: "warning",
                  ruleId: this.id,
                  id: "CC-EVENT-CLEANUP",
                  message: `'useEffect' registers an event listener but does not return a cleanup function calling 'removeEventListener'.`,
                  whyItMatters: "Failing to clean up event bindings or intervals leads to browser memory leaks and duplicate handler execution."
                });
              }
              if (effectBody.includes("setInterval") && !effectBody.includes("clearInterval")) {
                diagnostics.push({
                  file: analysis.filePath,
                  line: call.getStartLineNumber(),
                  severity: "warning",
                  ruleId: this.id,
                  id: "CC-EVENT-CLEANUP-INTERVAL",
                  message: `'useEffect' schedules an interval but does not return a cleanup function calling 'clearInterval'.`,
                  whyItMatters: "Failing to clear timers results in ghost intervals running indefinitely in the background."
                });
              }

              // 8. CC-EFFECT-LOOPS (Infinite loops)
              const setterMatch = effectBody.match(/set[A-Z]\w*/g);
              if (setterMatch && args.length > 1) {
                const depText = args[1]!.getText();
                for (const setter of setterMatch) {
                  const stateVar = setter.slice(3).charAt(0).toLowerCase() + setter.slice(4);
                  if (depText.includes(stateVar)) {
                    diagnostics.push({
                      file: analysis.filePath,
                      line: call.getStartLineNumber(),
                      severity: "warning",
                      ruleId: this.id,
                      id: "CC-EFFECT-LOOPS",
                      message: `'useEffect' modifies state variable '${stateVar}' which is declared inside its own dependency array, potentially triggering an infinite render loop.`,
                      whyItMatters: "Modifying state variables that are inside the dependency array triggers consecutive rendering passes, causing stack overflows."
                    });
                  }
                }
              }
            }
          }

          // 9. CC-DEFERRED-INPUT (Search inputs optimization)
          const stateDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
          let hasInputState = false;
          let hasDeferred = false;
          for (const d of stateDecls) {
            const initText = d.getInitializer()?.getText() ?? "";
            if (initText.includes("useState") && (d.getName().toLowerCase().includes("search") || d.getName().toLowerCase().includes("input"))) {
              hasInputState = true;
            }
            if (initText.includes("useDeferredValue") || initText.includes("useDebounce")) {
              hasDeferred = true;
            }
          }
          if (hasInputState && !hasDeferred && content.includes("<input")) {
            diagnostics.push({
              file: analysis.filePath,
              line: 1,
              severity: "warning",
              ruleId: this.id,
              id: "CC-DEFERRED-INPUT",
              message: `State handles heavy text input binding but does not use 'useDeferredValue' or debounce hooks.`,
              whyItMatters: "Re-rendering heavy page segments on every keypress causes typing lag. Deferring input updates keeps the input responsive."
            });
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return diagnostics;
  }
};
