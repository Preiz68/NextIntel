import { SourceFile, SyntaxKind } from "ts-morph";
import { ALL_BUILT_IN_HOOKS } from "./constants.js";
import type { HookUsage } from "./types.js";

const HOOK_PATTERN = /^use[A-Z]/;

export function extractHooks(sourceFile: SourceFile): HookUsage[] {
  const seen = new Map<string, HookUsage>();

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

    if (!seen.has(name)) {
      seen.set(name, {
        name,
        isBuiltIn: ALL_BUILT_IN_HOOKS.has(name),
        isCustomHook: !ALL_BUILT_IN_HOOKS.has(name),
      });
    }
  });

  return [...seen.values()];
}
