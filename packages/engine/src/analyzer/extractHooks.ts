import { SourceFile, SyntaxKind } from "ts-morph";
import { ALL_BUILT_IN_HOOKS } from "./constants.js";
import type { HookUsage } from "./types.js";

const HOOK_PATTERN = /^use[A-Z]/;

export function extractHooks(sourceFile: SourceFile): HookUsage[] {
  const usages: HookUsage[] = [];

  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();
    let name: string | undefined;

    // Direct call: useEffect(...)
    if (expr.isKind(SyntaxKind.Identifier)) {
      name = expr.getText();
    }

    // Namespaced call: React.useState(...)
    if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
      const member = expr.getName();
      if (HOOK_PATTERN.test(member)) name = member;
    }

    if (!name || !HOOK_PATTERN.test(name)) return;

    // Calculate line number (1-indexed)
    const line = call.getStartLineNumber();
    const sourceFile = call.getSourceFile();
    const startLoc = sourceFile.getLineAndColumnAtPos(call.getStart());
    const endLoc = sourceFile.getLineAndColumnAtPos(call.getEnd());
    const column = startLoc.column - 1;
    const endColumn = endLoc.column - 1;

    usages.push({
      name,
      isBuiltIn: ALL_BUILT_IN_HOOKS.has(name),
      isCustomHook: !ALL_BUILT_IN_HOOKS.has(name),
      line,
      column,
      endColumn,
    });
  });

  return usages;
}
