import { SourceFile, SyntaxKind, Node } from "ts-morph";
import path from "node:path";
import fs from "node:fs";

export type TaintState = "CLEAN" | "TAINTED" | "CONDITIONALLY_TAINTED";

export type TaintType = 
  | "SERVER_ONLY"      // e.g. next/headers, db clients, fs, server-only
  | "NODE_NATIVE_API"   // e.g. fs, path, net, crypto, orms in Edge/Client contexts
  | "BROWSER_ONLY"     // e.g. window, document, localStorage, navigator
  | "REQUEST_CONTEXT"  // e.g. headers(), cookies(), searchParams
  | "PROCESS_ENV"      // e.g. process.env
  | "SERIALIZATION";   // e.g. functions, class instances, Map, Set

export interface TaintDetails {
  state: TaintState;
  type: TaintType;
  source: string; // The API or symbol name triggering the taint
  line: number;
  expression: string;
  derived?: boolean;
  originFile?: string;
}

export interface ModuleTaintSummary {
  filePath: string;
  overallState: TaintState;
  taints: TaintDetails[];
}

const NODE_NATIVE_MODULES = new Set([
  "fs", "node:fs", "path", "node:path", "net", "node:net", "crypto", "node:crypto",
  "os", "node:os", "child_process", "node:child_process", "dns", "node:dns",
  "http", "node:http", "https", "node:https", "tls", "node:tls", "dgram", "node:dgram"
]);

const ORM_MODULES = new Set([
  "@prisma/client", "prisma", "typeorm", "pg", "mysql2", "mongoose", "sequelize", "knex"
]);

const BROWSER_GLOBALS = new Set([
  "window", "document", "localStorage", "sessionStorage", "navigator", "alert", "location"
]);

const REQUEST_APIS = new Set([
  "cookies", "headers"
]);

/**
 * Checks if an AST node is nested inside a conditional guard like
 * `if (typeof window !== 'undefined')` or `typeof window !== 'undefined' ? ... : ...`
 */
export function isNodeConditionallyGuarded(node: Node): boolean {
  let parent = node.getParent();
  while (parent) {
    const kind = parent.getKind();
    
    if (kind === SyntaxKind.IfStatement) {
      const ifStmt = parent.asKindOrThrow(SyntaxKind.IfStatement);
      const condText = ifStmt.getExpression().getText();
      if (
        condText.includes("window") ||
        condText.includes("document") ||
        condText.includes("process.env") ||
        condText.includes("globalThis")
      ) {
        return true;
      }
    } else if (kind === SyntaxKind.ConditionalExpression) {
      const condExpr = parent.asKindOrThrow(SyntaxKind.ConditionalExpression);
      const condText = condExpr.getCondition().getText();
      if (
        condText.includes("window") ||
        condText.includes("document") ||
        condText.includes("process.env") ||
        condText.includes("globalThis")
      ) {
        return true;
      }
    } else if (kind === SyntaxKind.BinaryExpression) {
      const binExpr = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
      const op = binExpr.getOperatorToken().getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken) {
        const leftText = binExpr.getLeft().getText();
        if (
          leftText.includes("window") ||
          leftText.includes("document") ||
          leftText.includes("process.env") ||
          leftText.includes("globalThis")
        ) {
          return true;
        }
      }
    }
    
    parent = parent.getParent();
  }
  return false;
}

/**
 * Checks if a node is inside a deferred context (like useEffect or click handler)
 * which makes it safe to run in a Client runtime.
 */
export function isInsideDeferredScope(node: Node): boolean {
  let parent = node.getParent();
  while (parent) {
    if (parent.isKind(SyntaxKind.CallExpression)) {
      const callee = parent.getExpression().getText();
      if (
        callee === "useEffect" ||
        callee === "useLayoutEffect" ||
        callee.endsWith(".useEffect") ||
        callee.endsWith(".useLayoutEffect")
      ) {
        return true;
      }
    }

    if (
      parent.isKind(SyntaxKind.FunctionDeclaration) ||
      parent.isKind(SyntaxKind.FunctionExpression) ||
      parent.isKind(SyntaxKind.ArrowFunction)
    ) {
      const outerFunction =
        parent.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        parent.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
        parent.getFirstAncestorByKind(SyntaxKind.FunctionExpression);

      if (outerFunction) {
        return true; // nested inside a component function callback
      }
    }

    parent = parent.getParent();
  }
  return false;
}

interface SymbolFlowEdge {
  from: string;
  to: string;
}

export function buildSymbolFlows(sourceFile: SourceFile): SymbolFlowEdge[] {
  const edges: SymbolFlowEdge[] = [];

  const addEdge = (from: string, to: string) => {
    if (from !== to) {
      edges.push({ from, to });
    }
  };

  // 1. Variable declarations
  sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach((varDecl) => {
    const varName = varDecl.getName();
    const init = varDecl.getInitializer();
    if (init) {
      init.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
        addEdge(id.getText(), varName);
      });
    }
  });

  // 2. Return statements in functions
  sourceFile.getDescendantsOfKind(SyntaxKind.ReturnStatement).forEach((retStmt) => {
    const expr = retStmt.getExpression();
    if (expr) {
      const ids = expr.getDescendantsOfKind(SyntaxKind.Identifier);
      
      const funcDecl = retStmt.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      if (funcDecl) {
        const funcName = funcDecl.getName();
        if (funcName) {
          ids.forEach((id) => addEdge(id.getText(), funcName));
        }
      }

      const arrowFunc = retStmt.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
      if (arrowFunc) {
        const varDecl = arrowFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
          const varName = varDecl.getName();
          ids.forEach((id) => addEdge(id.getText(), varName));
        }
      }
    }
  });

  return edges;
}

export function propagateLocalTaints(
  sourceFile: SourceFile,
  directTaints: TaintDetails[],
  edges: SymbolFlowEdge[]
): TaintDetails[] {
  const allTaints = [...directTaints];
  const taintedNames = new Set<string>();
  const worklist: { node: Node; type: TaintType }[] = [];

  sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    const dt = directTaints.find((t) => t.source === name && t.line === id.getStartLineNumber());
    if (dt) {
      worklist.push({ node: id, type: dt.type });
    }
  });

  const visitedNodes = new Set<Node>();
  const sourceFileObj = sourceFile;

  while (worklist.length > 0) {
    const { node, type } = worklist.shift()!;
    if (visitedNodes.has(node)) continue;
    visitedNodes.add(node);

    const varDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
    if (varDecl && varDecl.getInitializer() && varDecl.getInitializer()!.containsRange(node.getStart(), node.getEnd())) {
      const nameNode = varDecl.getNameNode();
      const varName = nameNode.getText();
      if (!taintedNames.has(varName)) {
        taintedNames.add(varName);

        allTaints.push({
          state: "TAINTED",
          type: type,
          source: varName,
          line: varDecl.getStartLineNumber(),
          expression: varDecl.getText(),
          derived: true,
          originFile: sourceFileObj.getFilePath().replace(/\\/g, "/")
        });

        try {
          if (Node.isIdentifier(nameNode)) {
            const refs = nameNode.findReferencesAsNodes().filter(ref => ref.getSourceFile() === sourceFileObj);
            refs.forEach((ref: Node) => worklist.push({ node: ref, type }));
          }
        } catch {
          // ignore
        }
      }
    }

    const returnStmt = node.getFirstAncestorByKind(SyntaxKind.ReturnStatement);
    if (returnStmt) {
      const funcDecl = node.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
      if (funcDecl) {
        const nameNode = funcDecl.getNameNode();
        if (nameNode) {
          const funcName = nameNode.getText();
          if (!taintedNames.has(funcName)) {
            taintedNames.add(funcName);

            allTaints.push({
              state: "TAINTED",
              type: type,
              source: funcName,
              line: funcDecl.getStartLineNumber(),
              expression: funcDecl.getText(),
              derived: true,
              originFile: sourceFileObj.getFilePath().replace(/\\/g, "/")
            });

            try {
              if (Node.isIdentifier(nameNode)) {
                const refs = nameNode.findReferencesAsNodes().filter(ref => ref.getSourceFile() === sourceFileObj);
                refs.forEach((ref: Node) => worklist.push({ node: ref, type }));
              }
            } catch {
              // ignore
            }
          }
        }
      }

      const arrowFunc = node.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
      if (arrowFunc) {
        const parentVar = arrowFunc.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (parentVar) {
          const nameNode = parentVar.getNameNode();
          const varName = nameNode.getText();
          if (!taintedNames.has(varName)) {
            taintedNames.add(varName);

            allTaints.push({
              state: "TAINTED",
              type: type,
              source: varName,
              line: parentVar.getStartLineNumber(),
              expression: parentVar.getText(),
              derived: true,
              originFile: sourceFileObj.getFilePath().replace(/\\/g, "/")
            });

            try {
              if (Node.isIdentifier(nameNode)) {
                const refs = nameNode.findReferencesAsNodes().filter(ref => ref.getSourceFile() === sourceFileObj);
                refs.forEach((ref: Node) => worklist.push({ node: ref, type }));
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
  }

  return allTaints;
}

/**
 * Analyze direct taints in a single SourceFile.
 */
export function analyzeDirectTaints(sourceFile: SourceFile): TaintDetails[] {
  const directTaints: TaintDetails[] = [];
  const originFile = sourceFile.getFilePath().replace(/\\/g, "/");

  const processSpecifier = (specifier: string, line: number, exprText: string) => {
    if (specifier === "server-only") {
      directTaints.push({
        state: "TAINTED",
        type: "SERVER_ONLY",
        source: "server-only",
        line,
        expression: exprText,
        derived: false,
        originFile
      });
    } else if (NODE_NATIVE_MODULES.has(specifier)) {
      directTaints.push({
        state: "TAINTED",
        type: "NODE_NATIVE_API",
        source: specifier,
        line,
        expression: exprText,
        derived: false,
        originFile
      });
    } else if (ORM_MODULES.has(specifier)) {
      directTaints.push({
        state: "TAINTED",
        type: "NODE_NATIVE_API",
        source: specifier,
        line,
        expression: exprText,
        derived: false,
        originFile
      });
    } else if (specifier === "next/headers") {
      directTaints.push({
        state: "TAINTED",
        type: "SERVER_ONLY",
        source: "next/headers",
        line,
        expression: exprText,
        derived: false,
        originFile
      });
    }
  };

  sourceFile.getImportDeclarations().forEach((imp) => {
    const specifier = imp.getModuleSpecifierValue();
    const line = imp.getStartLineNumber();
    const exprText = imp.getText();
    processSpecifier(specifier, line, exprText);
  });

  sourceFile.getExportDeclarations().forEach((exp) => {
    const specifier = exp.getModuleSpecifierValue();
    if (specifier) {
      const line = exp.getStartLineNumber();
      const exprText = exp.getText();
      processSpecifier(specifier, line, exprText);
    }
  });

  sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    const parent = id.getParent();
    if (!parent) return;

    if (
      parent.isKind(SyntaxKind.ImportSpecifier) ||
      parent.isKind(SyntaxKind.ImportClause) ||
      parent.isKind(SyntaxKind.ExportSpecifier) ||
      parent.isKind(SyntaxKind.NamespaceImport) ||
      (parent.isKind(SyntaxKind.VariableDeclaration) && parent.getNameNode() === id) ||
      (parent.isKind(SyntaxKind.Parameter) && parent.getNameNode() === id) ||
      (parent.isKind(SyntaxKind.FunctionDeclaration) && (parent as any).getNameNode?.() === id)
    ) {
      return;
    }

    if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
      if (parent.getNameNode() === id) return;
    }

    const symbol = id.getSymbol();
    if (symbol) {
      const decls = symbol.getDeclarations();
      const isLocal = decls.some((decl) => {
        if (
          decl.isKind(SyntaxKind.ImportSpecifier) ||
          decl.isKind(SyntaxKind.ImportClause) ||
          decl.isKind(SyntaxKind.NamespaceImport)
        ) {
          const impDecl = decl.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
          if (impDecl) {
            const specVal = impDecl.getModuleSpecifierValue();
            if (specVal.startsWith(".") || path.isAbsolute(specVal)) {
              return true;
            }
          }
          return false;
        }
        const pathStr = decl.getSourceFile().getFilePath();
        return !pathStr.includes("typescript/lib") && !pathStr.includes("node_modules");
      });
      if (isLocal) return;
    }


    const line = id.getStartLineNumber();
    const expression = parent.getText();

    if (BROWSER_GLOBALS.has(name)) {
      const guarded = isNodeConditionallyGuarded(id);
      const state: TaintState = guarded ? "CONDITIONALLY_TAINTED" : "TAINTED";
      directTaints.push({
        state,
        type: "BROWSER_ONLY",
        source: name,
        line,
        expression,
        derived: false,
        originFile
      });
    }

    if (REQUEST_APIS.has(name)) {
      const guarded = isNodeConditionallyGuarded(id);
      directTaints.push({
        state: guarded ? "CONDITIONALLY_TAINTED" : "TAINTED",
        type: "REQUEST_CONTEXT",
        source: name,
        line,
        expression,
        derived: false,
        originFile
      });
    }

    if (name === "process" && parent.getText().includes("process.env")) {
      const guarded = isNodeConditionallyGuarded(id);
      directTaints.push({
        state: guarded ? "CONDITIONALLY_TAINTED" : "TAINTED",
        type: "PROCESS_ENV",
        source: "process.env",
        line,
        expression,
        derived: false,
        originFile
      });
    }
  });

  const edges = buildSymbolFlows(sourceFile);
  const fullTaints = propagateLocalTaints(sourceFile, directTaints, edges);
  (fullTaints as any).symbolFlows = edges;

  return fullTaints;
}

/**
 * Taint Engine that propagates taints through the dependency graph.
 */
export class TaintEngine {
  private moduleTaints: Map<string, ModuleTaintSummary> = new Map();

  constructor(
    private filePaths: string[],
    private graph: any,
    private nodes: Map<string, any>,
    private directTaintsMap: Map<string, TaintDetails[]>,
    private analyses?: any[]
  ) {}

  propagate(): Map<string, ModuleTaintSummary> {
    const visitedEdges = new Set<string>();

    for (const filePath of this.filePaths) {
      const direct = this.directTaintsMap.get(filePath) || [];
      const overallState: TaintState = direct.some((t) => t.state === "TAINTED")
        ? "TAINTED"
        : direct.some((t) => t.state === "CONDITIONALLY_TAINTED")
          ? "CONDITIONALLY_TAINTED"
          : "CLEAN";

      this.moduleTaints.set(filePath, {
        filePath,
        overallState,
        taints: [...direct]
      });
    }

    const queue: string[] = [...this.filePaths];

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currSummary = this.moduleTaints.get(curr);
      if (!currSummary || currSummary.overallState === "CLEAN") continue;

      const importers = this.graph?.predecessors(curr) || [];

      for (const importer of importers) {
        const importerSummary = this.moduleTaints.get(importer);
        if (!importerSummary) continue;

        let changed = false;

        if (this.analyses) {
          const importerAnalysis = this.analyses.find((a) => a.filePath === importer);
          if (importerAnalysis) {
            const importsFromB = importerAnalysis.importDetails.filter((imp: any) => {
              const resolved = path.resolve(path.dirname(importer), imp.moduleSpecifier).replace(/\\/g, "/");
              return resolved.replace(/\.[a-zA-Z]+$/, "") === curr.replace(/\.[a-zA-Z]+$/, "");
            });

            const importedSymbols = new Set<string>();
            for (const imp of importsFromB) {
              if (imp.defaultImport) importedSymbols.add(imp.defaultImport);
              if (imp.namespaceImport) importedSymbols.add(imp.namespaceImport);
              for (const name of imp.namedImports) {
                importedSymbols.add(name);
              }
            }

            for (const taint of currSummary.taints) {
              const isCapabilityTaint =
                taint.type === "SERVER_ONLY" ||
                taint.type === "REQUEST_CONTEXT" ||
                taint.type === "NODE_NATIVE_API" ||
                taint.type === "PROCESS_ENV" ||
                taint.type === "BROWSER_ONLY";

              if (isCapabilityTaint) {
                // Transitive module-level bundle contamination analysis
                const symbol = path.basename(curr, path.extname(curr));
                const edgeKey = `${curr}->${importer}:${symbol}:${taint.type}`;
                if (!visitedEdges.has(edgeKey)) {
                  visitedEdges.add(edgeKey);

                  const hasTaint = importerSummary.taints.some(
                    (t) => t.type === taint.type && t.originFile === (taint.originFile || curr)
                  );

                  if (!hasTaint) {
                    const matchedImport = importsFromB[0];
                    const importLine = matchedImport && typeof matchedImport.line === "number" ? matchedImport.line : 1;

                    importerSummary.taints.push({
                      state: taint.state,
                      type: taint.type,
                      source: symbol,
                      line: importLine,
                      expression: `import from ${path.basename(curr)}`,
                      derived: true,
                      originFile: taint.originFile || curr
                    });
                    changed = true;
                  }
                }
              } else if (importedSymbols.has(taint.source)) {
                // Symbol-level flow analysis for serialization taints
                const localEdges = importerAnalysis.symbolFlows || [];
                const reachable = new Set<string>([taint.source]);
                const q = [taint.source];
                while (q.length > 0) {
                  const s = q.shift()!;
                  for (const edge of localEdges) {
                    if (edge.from === s && !reachable.has(edge.to)) {
                      reachable.add(edge.to);
                      q.push(edge.to);
                    }
                  }
                }

                for (const symbol of reachable) {
                  const edgeKey = `${curr}->${importer}:${symbol}:${taint.type}`;
                  if (visitedEdges.has(edgeKey)) continue;
                  visitedEdges.add(edgeKey);

                  const hasTaint = importerSummary.taints.some(
                    (t) => t.source === symbol && t.type === taint.type && t.state === taint.state
                  );

                  if (!hasTaint) {
                    const declLine = importerAnalysis.exportDetails.find((e: any) => e.name === symbol)?.line || 1;
                    
                    importerSummary.taints.push({
                      state: taint.state,
                      type: taint.type,
                      source: symbol,
                      line: declLine,
                      expression: `(propagated from ${path.basename(curr)}) ${symbol}`,
                      derived: true,
                      originFile: taint.originFile || curr
                    });
                    changed = true;
                  }
                }
              }
            }
          }
        } else {
          for (const taint of currSummary.taints) {
            const edgeKey = `${curr}->${importer}:${taint.source}:${taint.type}`;
            if (visitedEdges.has(edgeKey)) continue;
            visitedEdges.add(edgeKey);

            const hasTaint = importerSummary.taints.some(
              (t) => t.source === taint.source && t.type === taint.type && t.state === taint.state
            );

            if (!hasTaint) {
              const importerNode = this.nodes.get(importer);
              const isClientContext =
                importerNode?.isClientComponent || 
                importerNode?.semanticKind === "client-component" ||
                importerNode?.semanticKind === "client-util";

              if (taint.state === "TAINTED" || isClientContext) {
                let importLine = 1;
                try {
                  const content = fs.readFileSync(importer, "utf8");
                  const currBase = path.basename(curr, path.extname(curr));
                  const lines = content.split("\n");
                  for (let i = 0; i < lines.length; i++) {
                    if (lines[i]!.includes(currBase) && (lines[i]!.includes("import") || lines[i]!.includes("require"))) {
                      importLine = i + 1;
                      break;
                    }
                  }
                } catch {}

                importerSummary.taints.push({
                  ...taint,
                  line: importLine,
                  expression: `(propagated from ${path.basename(curr)}) ${taint.expression}`,
                  derived: true,
                  originFile: taint.originFile || curr
                });
                changed = true;
              }
            }
          }
        }

        if (changed) {
          const hasTainted = importerSummary.taints.some((t) => t.state === "TAINTED");
          const hasCondTainted = importerSummary.taints.some((t) => t.state === "CONDITIONALLY_TAINTED");
          importerSummary.overallState = hasTainted
            ? "TAINTED"
            : hasCondTainted
              ? "CONDITIONALLY_TAINTED"
              : "CLEAN";

          queue.push(importer);
        }
      }
    }

    return this.moduleTaints;
  }
}
