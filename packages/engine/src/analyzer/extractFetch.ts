import {
  SourceFile,
  SyntaxKind,
  ObjectLiteralExpression,
  Node,
} from "ts-morph";
import type { FetchCall } from "./types.js";

function resolveStringLiteral(node: Node): string | null {
  if (node.isKind(SyntaxKind.StringLiteral)) return node.getLiteralText();
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral))
    return node.getLiteralText();
  return null;
}

function resolveNumericLiteral(node: Node): number | null {
  if (node.isKind(SyntaxKind.NumericLiteral))
    return Number(node.getLiteralText());
  return null;
}

function analyzeOptionsObject(
  obj: ObjectLiteralExpression,
): Pick<
  FetchCall,
  | "hasCacheConfig"
  | "cacheValue"
  | "hasRevalidate"
  | "revalidateValue"
  | "isDynamic"
> {
  let hasCacheConfig = false;
  let cacheValue: string | null = null;
  let hasRevalidate = false;
  let revalidateValue: number | string | null = null;

  // cache: "no-store" | "force-cache"
  const cacheProp = obj.getProperty("cache");
  if (cacheProp && Node.isPropertyAssignment(cacheProp)) {
    hasCacheConfig = true;
    cacheValue = resolveStringLiteral(cacheProp.getInitializer()!);
  }

  // next: { revalidate: number | false, tags: string[] }
  const nextProp = obj.getProperty("next");
  if (nextProp && Node.isPropertyAssignment(nextProp)) {
    const nextInit = nextProp.getInitializer();
    if (nextInit && Node.isObjectLiteralExpression(nextInit)) {
      const revalidateProp = nextInit.getProperty("revalidate");
      if (revalidateProp && Node.isPropertyAssignment(revalidateProp)) {
        hasRevalidate = true;
        const init = revalidateProp.getInitializer()!;
        revalidateValue =
          resolveNumericLiteral(init) ??
          resolveStringLiteral(init) ??
          init.getText();
      }
    }
  }

  const isDynamic =
    cacheValue === "no-store" || (hasRevalidate && revalidateValue === 0);

  return {
    hasCacheConfig,
    cacheValue,
    hasRevalidate,
    revalidateValue,
    isDynamic,
  };
}

export function extractFetchCalls(sourceFile: SourceFile): FetchCall[] {
  const results: FetchCall[] = [];

  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
    const expr = call.getExpression();

    // Match bare `fetch(...)` calls only (not obj.fetch, not myFetch)
    if (!expr.isKind(SyntaxKind.Identifier)) return;
    if (expr.getText() !== "fetch") return;

    const args = call.getArguments();
    const optionsArg = args[1];

    if (optionsArg && Node.isObjectLiteralExpression(optionsArg)) {
      results.push(analyzeOptionsObject(optionsArg));
    } else {
      // fetch(url) with no options — Next.js defaults to force-cache in App Router
      results.push({
        hasCacheConfig: false,
        cacheValue: null,
        hasRevalidate: false,
        revalidateValue: null,
        isDynamic: false,
      });
    }
  });

  return results;
}
