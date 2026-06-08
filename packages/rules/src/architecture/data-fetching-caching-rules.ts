import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const dataFetchingCachingRules: Rule = {
  id: "data-fetching-caching-rules",

  meta: {
    description: "Enforce loops check, timeout signals, local host checks, cache-life configs, and optimistic UX rules.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServer = !analysis.isClientComponent && analysis.executionModel.componentType !== "client";

      let content = "";
      try {
        if (existsSync(analysis.filePath)) {
          content = readFileSync(analysis.filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // 1. DF-CLIENT-REVALIDATION (revalidate in client)
      if (analysis.isClientComponent && (content.includes("revalidatePath") || content.includes("revalidateTag"))) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-CLIENT-REVALIDATION",
          message: `Client Component imports or calls cache revalidation functions ('revalidatePath', 'revalidateTag'). Revalidation can only be triggered in server context (Server Actions or Route Handlers).`,
          whyItMatters: "Client bundles cannot validate the CDN or server-side cache directly. Attempting to call these functions on the client throws runtime errors."
        });
      }

      // 2. DF-CACHE-LIFE-CONFIG (cacheLife setting check)
      if (content.includes('"use cache"') || content.includes("'use cache'")) {
        if (!content.includes("cacheLife(")) {
          diagnostics.push({
            file: analysis.filePath,
            line: 1,
            severity: "warning",
            ruleId: this.id,
            id: "DF-CACHE-LIFE-CONFIG",
            message: `Component uses 'use cache' directive but does not declare a cache profile via 'cacheLife()'.`,
            whyItMatters: "Next.js defaults to broad caching when 'cacheLife()' is omitted. Explicitly specifying cache life (e.g. cacheLife('seconds') or cacheLife('days')) guarantees predictable invalidation."
          });
        }
      }

      // 3. DF-PRODUCTION-LOCALHOST (localhost checks)
      const localhostMatch = /fetch\s*\(\s*['"`](https?:\/\/localhost|https?:\/\/127\.0\.0\.1)/g.exec(content);
      if (localhostMatch) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-PRODUCTION-LOCALHOST",
          message: `Hardcoded localhost URL detected in fetch: '${localhostMatch[1]}'. Use dynamic environment variables (e.g. process.env.NEXT_PUBLIC_API_URL) for production compatibility.`,
          whyItMatters: "Hardcoded localhost fetch targets will crash when deployed to staging or production environments since the client or server cannot connect to local services."
        });
      }

      // 4. DF-FETCH-TIMEOUT (No timeout set)
      if (content.includes("fetch(") && !content.includes("signal") && !content.includes("AbortController")) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-FETCH-TIMEOUT",
          message: `Fetch request called without setting an AbortSignal timeout.`,
          whyItMatters: "By default, fetch requests do not time out. Slow external APIs can block Node.js server connections indefinitely, causing thread starvation."
        });
      }

      // 5. DF-POST-FETCH-BODY (POST without body)
      const postMatch = /fetch\s*\(\s*[^,]+,\s*\{[^}]*method\s*:\s*['"`](POST|PUT)['"`]\s*(?![^}]*body)/g.exec(content);
      if (postMatch) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-POST-FETCH-BODY",
          message: `Fetch request uses '${postMatch[1]}' method but does not pass a 'body' parameter.`,
          whyItMatters: "HTTP POST and PUT endpoints typically expect a payload body. Omitting it can cause server request parsing exceptions."
        });
      }

      // 6. DF-USE-OPTIMISTIC (Form validation without optimistic UI)
      if (analysis.isClientComponent && content.includes("<form") && !content.includes("useOptimistic")) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-USE-OPTIMISTIC",
          message: `Client Component form submission lacks optimistic UI updates. Consider using 'useOptimistic' hook to display state updates instantly during mutation.`,
          whyItMatters: "Optimistic UI renders UI changes instantly before the server mutation resolves, improving perceived interactivity."
        });
      }

      // 7. DF-NO-STORE-ABUSE (unstable_noStore warnings)
      if (content.includes("unstable_noStore") && (content.includes("revalidatePath") || content.includes("revalidateTag"))) {
        diagnostics.push({
          file: analysis.filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "DF-NO-STORE-ABUSE",
          message: `Usage of 'unstable_noStore()' combined with tag/path revalidation. Bypass is unnecessary if caching is actively bypassed.`,
          whyItMatters: "Declaring noStore() forces dynamic execution, rendering revalidation tagging and invalidation logic redundant."
        });
      }

      // AST parser checks for loops data fetching and SDK memoization
      try {
        const project = new Project();
        const sourceFile = project.createSourceFile("_temp_df_caching.tsx", content);

        if (isServer) {
          // 8. DF-NO-LOOP-FETCH (Awaiting fetch inside loops)
          const awaits = sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression);
          for (const aw of awaits) {
            const insideLoop = aw.getFirstAncestor(node =>
              node.getKind() === SyntaxKind.ForStatement ||
              node.getKind() === SyntaxKind.ForOfStatement ||
              node.getKind() === SyntaxKind.ForInStatement ||
              node.getKind() === SyntaxKind.WhileStatement ||
              node.getKind() === SyntaxKind.DoStatement ||
              (node.getKind() === SyntaxKind.CallExpression && 
               ["map", "forEach", "filter", "reduce"].includes((node as any).getExpression()?.getPropertyName?.() ?? ""))
            );

            if (insideLoop) {
              const text = aw.getText();
              if (text.includes("fetch(") || text.includes("db.") || text.includes("prisma.")) {
                diagnostics.push({
                  file: analysis.filePath,
                  line: aw.getStartLineNumber(),
                  severity: "warning",
                  ruleId: this.id,
                  id: "DF-NO-LOOP-FETCH",
                  message: `Synchronous data query '${text}' executed inside a loop. Refactor to batch request or fetch in parallel.`,
                  whyItMatters: "Awaiting database or API fetches sequentially inside loop cycles aggregates request latency, causing rendering waterfalls."
                });
              }
            }
          }

          // 9. DF-UNCACHED-SDK-CALLS (Uncached third party SDK calls)
          const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
          for (const call of calls) {
            const exprText = call.getExpression().getText();
            const isUncachedSdk = (exprText.startsWith("stripe.") || exprText.startsWith("firebase.")) &&
                                  !call.getFirstAncestor(n => n.getKind() === SyntaxKind.CallExpression && n.getExpression().getText() === "cache");
            if (isUncachedSdk) {
              diagnostics.push({
                file: analysis.filePath,
                line: call.getStartLineNumber(),
                severity: "warning",
                ruleId: this.id,
                id: "DF-UNCACHED-SDK-CALLS",
                message: `Uncached SDK call '${exprText}()' in Server Component. Wrap with React.cache() for request-level memoization.`,
                whyItMatters: "Third-party SDK queries are not automatically memoized by Next.js's fetch override, causing redundant network calls."
              });
            }
          }
        }
      } catch (e) {
        // ignore
      }
    }

    return diagnostics;
  }
};
