import { Node, SyntaxKind } from "ts-morph";

/**
 * Traverses a node's parents/references to determine if the value of a browser API reference
 * affects the render output of a component (JSX structure, text node, attributes, conditional render).
 */
export function doesValueAffectRender(id: Node): boolean {
  const visited = new Set<Node>();
  const queue: Node[] = [id];

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (visited.has(node)) continue;
    visited.add(node);

    // 1. Direct JSX checks
    if (
      node.isKind(SyntaxKind.JsxExpression) ||
      node.isKind(SyntaxKind.JsxAttribute) ||
      node.isKind(SyntaxKind.JsxElement) ||
      node.isKind(SyntaxKind.JsxSelfClosingElement) ||
      node.isKind(SyntaxKind.JsxText)
    ) {
      return true;
    }

    // 2. Parent checks
    const parent = node.getParent();
    if (!parent) continue;

    // Check if the current node is within a ReturnStatement
    if (parent.isKind(SyntaxKind.ReturnStatement)) {
      const containingFunc = parent.getFirstAncestor((n) =>
        n.isKind(SyntaxKind.FunctionDeclaration) ||
        n.isKind(SyntaxKind.ArrowFunction) ||
        n.isKind(SyntaxKind.FunctionExpression) ||
        n.isKind(SyntaxKind.MethodDeclaration)
      );

      if (containingFunc) {
        let isReactComponent = false;
        let funcName = "";
        
        if (containingFunc.isKind(SyntaxKind.FunctionDeclaration)) {
          funcName = containingFunc.getName() || "";
        } else if (containingFunc.isKind(SyntaxKind.MethodDeclaration)) {
          funcName = containingFunc.getName() || "";
        } else {
          const varDecl = containingFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
          if (varDecl) {
            funcName = varDecl.getName();
          }
        }

        if (funcName && funcName[0] === funcName[0].toUpperCase()) {
          isReactComponent = true;
        }

        if (isReactComponent) {
          return true;
        }

        if (!visited.has(containingFunc)) {
          visited.add(containingFunc);

          let functionNameNode: Node | undefined;
          if (containingFunc.isKind(SyntaxKind.FunctionDeclaration) || containingFunc.isKind(SyntaxKind.MethodDeclaration)) {
            functionNameNode = containingFunc.getNameNode();
          } else {
            const varDecl = containingFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
            if (varDecl) {
              functionNameNode = varDecl.getNameNode();
            }
          }

          if (functionNameNode && functionNameNode.isKind(SyntaxKind.Identifier)) {
            const refs = functionNameNode.findReferencesAsNodes();
            let anyRefAffectsRender = false;
            for (const ref of refs) {
              if (ref === functionNameNode) continue;
              
              const callAncestor = ref.getFirstAncestorByKind(SyntaxKind.CallExpression);
              if (callAncestor && callAncestor.getExpression().getText() === funcName) {
                if (doesValueAffectRender(callAncestor)) {
                  anyRefAffectsRender = true;
                  break;
                }
              } else {
                if (doesValueAffectRender(ref)) {
                  anyRefAffectsRender = true;
                  break;
                }
              }
            }
            if (anyRefAffectsRender) {
              return true;
            }
          }
        }
        continue;
      }
      return true;
    }

    // Check if parent is a JSX expression/attribute
    if (
      parent.isKind(SyntaxKind.JsxExpression) ||
      parent.isKind(SyntaxKind.JsxAttribute)
    ) {
      return true;
    }

    // 3. Propagators (value flows through these expressions)
    if (
      parent.isKind(SyntaxKind.PropertyAccessExpression) ||
      parent.isKind(SyntaxKind.ElementAccessExpression) ||
      parent.isKind(SyntaxKind.ParenthesizedExpression) ||
      parent.isKind(SyntaxKind.AsExpression) ||
      parent.isKind(SyntaxKind.TypeAssertionExpression) ||
      parent.isKind(SyntaxKind.PrefixUnaryExpression) ||
      parent.isKind(SyntaxKind.PostfixUnaryExpression) ||
      parent.isKind(SyntaxKind.TemplateExpression) ||
      parent.isKind(SyntaxKind.TemplateSpan) ||
      parent.isKind(SyntaxKind.PropertyAssignment) ||
      parent.isKind(SyntaxKind.ObjectLiteralExpression) ||
      parent.isKind(SyntaxKind.ArrayLiteralExpression)
    ) {
      queue.push(parent);
      continue;
    }

    if (parent.isKind(SyntaxKind.CallExpression)) {
      const calleeText = parent.getExpression().getText();
      // Safe logging calls do not affect render
      if (calleeText.startsWith("console.")) {
        continue;
      }

      // Stateful react hooks trace
      if (
        calleeText === "useState" ||
        calleeText === "useMemo" ||
        calleeText === "useRef"
      ) {
        const varDecl = parent.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
          const nameNode = varDecl.getNameNode();
          if (nameNode.isKind(SyntaxKind.ArrayBindingPattern)) {
            // const [state, setState] = useState(...)
            const firstElement = nameNode.getElements()[0];
            if (firstElement && firstElement.isKind(SyntaxKind.BindingElement)) {
              const stateId = firstElement.getNameNode();
              if (stateId.isKind(SyntaxKind.Identifier)) {
                stateId.findReferencesAsNodes().forEach((ref) => queue.push(ref));
              }
            }
          } else if (nameNode.isKind(SyntaxKind.Identifier)) {
            // const ref = useRef(...)
            nameNode.findReferencesAsNodes().forEach((ref) => queue.push(ref));
          }
        }
        continue;
      }

      // General function calls inherit the flow of their arguments
      queue.push(parent);
      continue;
    }

    if (parent.isKind(SyntaxKind.BinaryExpression)) {
      // E.g. x + "foo" or x && y
      queue.push(parent);
      continue;
    }

    if (parent.isKind(SyntaxKind.ConditionalExpression)) {
      // E.g. x ? a : b
      queue.push(parent);
      continue;
    }

    // 4. Assignments & bindings
    if (parent.isKind(SyntaxKind.VariableDeclaration)) {
      const nameNode = parent.getNameNode();
      if (nameNode.isKind(SyntaxKind.Identifier)) {
        nameNode.findReferencesAsNodes().forEach((ref) => queue.push(ref));
      } else if (
        nameNode.isKind(SyntaxKind.ObjectBindingPattern) ||
        nameNode.isKind(SyntaxKind.ArrayBindingPattern)
      ) {
        const descendants = nameNode.getDescendantsOfKind(SyntaxKind.Identifier);
        descendants.forEach((desc) => {
          desc.findReferencesAsNodes().forEach((ref) => queue.push(ref));
        });
      }
      continue;
    }

    // 5. Conditional branches render control
    if (parent.isKind(SyntaxKind.IfStatement)) {
      // If the node is used as the condition for an IfStatement, it governs execution
      // of render branches.
      return true;
    }
  }

  return false;
}
