import { SourceFile, SyntaxKind, Node, FunctionDeclaration, ArrowFunction, FunctionExpression } from "ts-morph";

export interface PurityFinding {
  type: "nondeterminism" | "mutation";
  line: number;
  expression: string;
  message: string;
}

function isReactComponent(node: FunctionDeclaration | ArrowFunction | FunctionExpression): boolean {
  let name = "";
  if (Node.isFunctionDeclaration(node)) {
    name = node.getName() || "";
  } else {
    const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDecl) {
      name = varDecl.getName();
    }
  }
  
  if (name && /^[A-Z]/.test(name)) {
    return true;
  }
  
  const parent = node.getParent();
  if (parent && parent.isKind(SyntaxKind.ExportAssignment)) {
    return true;
  }
  
  return false;
}

function isDeferredNode(node: Node, componentNode: Node): boolean {
  let parent = node.getParent();
  while (parent && parent !== componentNode) {
    if (parent.isKind(SyntaxKind.CallExpression)) {
      const call = parent.asKindOrThrow(SyntaxKind.CallExpression);
      const callee = call.getExpression().getText();
      if (
        callee === "useEffect" ||
        callee === "useLayoutEffect" ||
        callee.endsWith(".useEffect") ||
        callee.endsWith(".useLayoutEffect")
      ) {
        return true;
      }

      if (callee === "useMemo" || callee.endsWith(".useMemo")) {
        const args = call.getArguments();
        if (args.length >= 2) {
          const depArg = args[1];
          if (depArg?.isKind(SyntaxKind.ArrayLiteralExpression)) {
            const arr = depArg.asKindOrThrow(SyntaxKind.ArrayLiteralExpression);
            if (arr.getElements().length === 0) {
              return true;
            }
          }
        }
      }

      if (callee === "useState" || callee.endsWith(".useState")) {
        const args = call.getArguments();
        if (args.length > 0) {
          const firstArg = args[0];
          if (
            firstArg &&
            (firstArg.isKind(SyntaxKind.ArrowFunction) ||
              firstArg.isKind(SyntaxKind.FunctionExpression))
          ) {
            if (firstArg.containsRange(node.getStart(), node.getEnd())) {
              return true;
            }
          }
        }
      }
    }

    if (parent.isKind(SyntaxKind.JsxAttribute)) {
      const name = parent.asKindOrThrow(SyntaxKind.JsxAttribute).getNameNode().getText();
      if (/^on[A-Z]/.test(name)) {
        return true;
      }
    }

    if (
      parent.isKind(SyntaxKind.FunctionDeclaration) ||
      parent.isKind(SyntaxKind.FunctionExpression) ||
      parent.isKind(SyntaxKind.ArrowFunction)
    ) {
      return true;
    }

    parent = parent.getParent();
  }
  return false;
}

export function checkRenderPurity(sourceFile: SourceFile): PurityFinding[] {
  const findings: PurityFinding[] = [];

  const checkComponent = (componentNode: FunctionDeclaration | ArrowFunction | FunctionExpression) => {
    if (!isReactComponent(componentNode)) return;

    componentNode.getDescendants().forEach((node) => {
      // 1. Nondeterminism Detection
      if (node.isKind(SyntaxKind.CallExpression)) {
        const calleeText = node.asKindOrThrow(SyntaxKind.CallExpression).getExpression().getText();
        
        let message = "";
        if (calleeText === "Math.random" || calleeText.endsWith(".Math.random")) {
          message = "Math.random() is non-deterministic and can trigger hydration mismatches.";
        } else if (calleeText === "Date.now" || calleeText.endsWith(".Date.now")) {
          message = "Date.now() is non-deterministic and can trigger hydration mismatches.";
        } else if (calleeText === "performance.now" || calleeText.endsWith(".performance.now")) {
          message = "performance.now() is non-deterministic and can trigger hydration mismatches.";
        } else if (calleeText === "crypto.randomUUID" || calleeText.endsWith(".crypto.randomUUID")) {
          message = "crypto.randomUUID() is non-deterministic and can trigger hydration mismatches.";
        }

        if (message && !isDeferredNode(node, componentNode)) {
          findings.push({
            type: "nondeterminism",
            line: node.getStartLineNumber(),
            expression: node.getText(),
            message,
          });
        }
      }

      if (node.isKind(SyntaxKind.NewExpression)) {
        const newExpr = node.asKindOrThrow(SyntaxKind.NewExpression);
        const className = newExpr.getExpression().getText();
        if (className === "Date" && newExpr.getArguments().length === 0) {
          if (!isDeferredNode(node, componentNode)) {
            findings.push({
              type: "nondeterminism",
              line: node.getStartLineNumber(),
              expression: node.getText(),
              message: "new Date() is non-deterministic and can trigger hydration mismatches.",
            });
          }
        }
      }

      // 2. Side Effect / Mutation Detection
      if (node.isKind(SyntaxKind.BinaryExpression)) {
        const binExpr = node.asKindOrThrow(SyntaxKind.BinaryExpression);
        const op = binExpr.getOperatorToken().getKind();
        const isAssignment =
          op === SyntaxKind.EqualsToken ||
          op === SyntaxKind.PlusEqualsToken ||
          op === SyntaxKind.MinusEqualsToken ||
          op === SyntaxKind.AsteriskEqualsToken ||
          op === SyntaxKind.SlashEqualsToken;

        if (isAssignment) {
          const left = binExpr.getLeft();
          
          if (left.isKind(SyntaxKind.Identifier)) {
            const id = left.asKindOrThrow(SyntaxKind.Identifier);
            const symbol = id.getSymbol();
            if (symbol) {
              const decls = symbol.getDeclarations();
              const isOuter = decls.some((decl) => {
                return !componentNode.containsRange(decl.getStart(), decl.getEnd());
              });
              if (isOuter && !isDeferredNode(node, componentNode)) {
                findings.push({
                  type: "mutation",
                  line: node.getStartLineNumber(),
                  expression: node.getText(),
                  message: `Mutation of external variable '${id.getText()}' during render path.`,
                });
              }
            }
          } else if (left.isKind(SyntaxKind.PropertyAccessExpression)) {
            const propAccess = left.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
            const expression = propAccess.getExpression();
            if (expression.isKind(SyntaxKind.Identifier)) {
              const id = expression.asKindOrThrow(SyntaxKind.Identifier);
              if (id.getText() === "props" || id.getText().startsWith("props")) {
                if (!isDeferredNode(node, componentNode)) {
                  findings.push({
                    type: "mutation",
                    line: node.getStartLineNumber(),
                    expression: node.getText(),
                    message: `Direct mutation of props property '${propAccess.getName()}' during render path.`,
                  });
                }
              }
            }
          }
        }
      }
    });
  };

  sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).forEach(checkComponent);
  sourceFile.getDescendantsOfKind(SyntaxKind.ArrowFunction).forEach(checkComponent);
  sourceFile.getDescendantsOfKind(SyntaxKind.FunctionExpression).forEach(checkComponent);

  return findings;
}
