import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project, SyntaxKind, Node } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

function isDeferredOrCallback(callNode: Node): boolean {
  let current: Node | undefined = callNode.getParent();
  while (current) {
    const kind = current.getKind();
    if (
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionExpression ||
      kind === SyntaxKind.FunctionDeclaration
    ) {
      // Check if this function is passed directly as an argument to a React hook
      const parent = current.getParent();
      if (parent && parent.getKind() === SyntaxKind.CallExpression) {
        const callerText = (parent as any).getExpression().getText();
        const hookName = callerText.includes(".") ? callerText.split(".").pop() : callerText;
        if (
          hookName === "useEffect" ||
          hookName === "useLayoutEffect" ||
          hookName === "useCallback" ||
          hookName === "useMemo"
        ) {
          return true;
        }
      }

      // Check if this function is assigned to a JSX event handler prop
      // e.g. onClick={async () => { fetch(...) }}
      if (parent && parent.getKind() === SyntaxKind.JsxExpression) {
        const jsxAttr = parent.getParent();
        if (jsxAttr && jsxAttr.getKind() === SyntaxKind.JsxAttribute) {
          const attrName = (jsxAttr as any).getNameNode()?.getText() ?? "";
          if (/^on[A-Z]/.test(attrName)) return true;
        }
      }

      // Check if this function is assigned to a variable whose name starts with
      // "handle" — a common Next.js event-handler naming convention
      if (parent && parent.getKind() === SyntaxKind.VariableDeclaration) {
        const varName = (parent as any).getName() ?? "";
        if (/^handle[A-Z]/.test(varName)) return true;
      }
    }
    current = current.getParent();
  }
  return false;
}

export const noRouteHandlersInClientComponents: Rule = {
  id: "no-route-handlers-in-client-components",

  meta: {
    description:
      "Avoid calling Route Handlers from Client Components when Server Components can fetch.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isClient = analysis.isClientComponent || analysis.executionModel.componentType === "client";
      if (!isClient) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.includes("fetch") || !content.includes("/api/")) {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.tsx", content);

      const callExpressions = sourceFile.getDescendantsOfKind(
        SyntaxKind.CallExpression
      );

      for (const call of callExpressions) {
        if (call.getExpression().getText() === "fetch") {
          // If the fetch call is inside useEffect or an event callback, it is safe
          if (isDeferredOrCallback(call)) {
            continue;
          }

          const args = call.getArguments();
          if (args.length > 0) {
            const firstArg = args[0]!;
            const firstArgText = firstArg.getText();
            const isInternalApi =
              /^[‘'"`]\/api\//.test(firstArgText) ||
              (firstArg.getKind() === SyntaxKind.TemplateExpression &&
                firstArgText.startsWith("`/api/"));

            if (isInternalApi) {
              const line = call.getStartLineNumber();

              diagnostics.push(
                mapEventToDiagnostic(
                  "BOUNDARY_VIOLATION_DETECTED",
                  "CC-ROUTE-HANDLER-001",
                  this.id,
                  analysis.filePath,
                  line,
                  `Client Component fetches internal route '${firstArgText.replace(
                    /['"`]/g,
                    ""
                  )}'.`
                )
              );
            }
          }
        }
      }
    }

    return diagnostics;
  },
};
