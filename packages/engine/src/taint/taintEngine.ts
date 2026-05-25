import { SourceFile, SyntaxKind, Node } from "ts-morph";
import path from "node:path";

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

/**
 * Analyze direct taints in a single SourceFile.
 */
export function analyzeDirectTaints(sourceFile: SourceFile): TaintDetails[] {
  const taints: TaintDetails[] = [];

  // 1. Analyze Imports and Export re-exports
  const processSpecifier = (specifier: string, line: number, exprText: string) => {
    if (specifier === "server-only") {
      taints.push({
        state: "TAINTED",
        type: "SERVER_ONLY",
        source: "server-only",
        line,
        expression: exprText
      });
    } else if (NODE_NATIVE_MODULES.has(specifier)) {
      taints.push({
        state: "TAINTED",
        type: "NODE_NATIVE_API",
        source: specifier,
        line,
        expression: exprText
      });
    } else if (ORM_MODULES.has(specifier)) {
      taints.push({
        state: "TAINTED",
        type: "NODE_NATIVE_API",
        source: specifier,
        line,
        expression: exprText
      });
    } else if (specifier === "next/headers") {
      taints.push({
        state: "TAINTED",
        type: "SERVER_ONLY",
        source: "next/headers",
        line,
        expression: exprText
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

  // 2. Analyze Identifiers for Browser Globals & env & request contexts
  sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach((id) => {
    const name = id.getText();
    const parent = id.getParent();
    if (!parent) return;

    // Skip import declarations or variable names
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

    // Skip if it's a sub-property in property access (e.g. `foo.window`)
    if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
      if (parent.getNameNode() === id) return;
    }

    // Check symbol to ensure it's not a local user-defined variable named 'window' etc.
    const symbol = id.getSymbol();
    if (symbol) {
      const decls = symbol.getDeclarations();
      const isLocal = decls.some((decl) => {
        const pathStr = decl.getSourceFile().getFilePath();
        return !pathStr.includes("typescript/lib") && !pathStr.includes("node_modules");
      });
      if (isLocal) return; // local variable, skip
    }

    const line = id.getStartLineNumber();
    const expression = parent.getText();

    // Check browser globals
    if (BROWSER_GLOBALS.has(name)) {
      // If inside a deferred scope (like useEffect or click callback), browser globals are expected/allowed in Client context.
      // But they still carry taint if they leak to the render phase or into a server graph.
      // We check if it is guarded.
      const guarded = isNodeConditionallyGuarded(id);
      
      // Note: even if it's inside a deferred scope, we taint it if it's in a shared module.
      // But we lower its propagation urgency. For now, track it:
      const state: TaintState = guarded ? "CONDITIONALLY_TAINTED" : "TAINTED";
      taints.push({
        state,
        type: "BROWSER_ONLY",
        source: name,
        line,
        expression
      });
    }

    // Check Next.js request APIs
    if (REQUEST_APIS.has(name)) {
      const guarded = isNodeConditionallyGuarded(id);
      taints.push({
        state: guarded ? "CONDITIONALLY_TAINTED" : "TAINTED",
        type: "REQUEST_CONTEXT",
        source: name,
        line,
        expression
      });
    }

    // Check process.env (sensitive info)
    if (name === "process" && parent.getText().includes("process.env")) {
      const guarded = isNodeConditionallyGuarded(id);
      taints.push({
        state: guarded ? "CONDITIONALLY_TAINTED" : "TAINTED",
        type: "PROCESS_ENV",
        source: "process.env",
        line,
        expression
      });
    }
  });

  return taints;
}

/**
 * Taint Engine that propagates taints through the dependency graph.
 */
export class TaintEngine {
  private moduleTaints: Map<string, ModuleTaintSummary> = new Map();

  constructor(
    private filePaths: string[],
    private graph: any, // dagre-d3 or graphlib graph instance
    private nodes: Map<string, any>,
    private directTaintsMap: Map<string, TaintDetails[]>
  ) {}

  /**
   * Run the taint propagation algorithm.
   */
  propagate(): Map<string, ModuleTaintSummary> {
    // 1. Initialize summaries with direct taints
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

    // 2. Propagation pass: we propagate TAINTED always, and CONDITIONALLY_TAINTED selectively.
    // In Next.js, modules import dependencies.
    // If file A imports file B, then in the dependency graph, there is an edge A -> B (A depends on B).
    // If B is tainted, then A gets tainted because A imports B.
    // So taint propagates BACKWARDS along the dependency edge (B -> A).
    // Let's propagate in a worklist queue.
    const queue: string[] = [...this.filePaths];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const curr = queue.shift()!;
      const currSummary = this.moduleTaints.get(curr);
      if (!currSummary || currSummary.overallState === "CLEAN") continue;

      // Find who imports `curr` (predecessors in the dependency graph)
      // If A -> B, B is successor of A. So predecessors of `curr` are modules that depend on/import `curr`.
      const importers = this.graph?.predecessors(curr) || [];

      for (const importer of importers) {
        const importerSummary = this.moduleTaints.get(importer);
        if (!importerSummary) continue;

        let changed = false;

        for (const taint of currSummary.taints) {
          // Check if this taint is already in importer
          const hasTaint = importerSummary.taints.some(
            (t) => t.source === taint.source && t.type === taint.type && t.state === taint.state
          );

          if (!hasTaint) {
            // Apply Propagation Rules:
            // - TAINTED always propagates.
            // - CONDITIONALLY_TAINTED propagates ONLY if the importing module is a client module
            //   (which we check via nodes or metadata) or if it's imported by a client boundary.
            const importerNode = this.nodes.get(importer);
            const isClientContext =
              importerNode?.isClientComponent || 
              importerNode?.semanticKind === "client-component" ||
              importerNode?.semanticKind === "client-util";

            if (taint.state === "TAINTED" || isClientContext) {
              importerSummary.taints.push({
                ...taint,
                expression: `(propagated from ${path.basename(curr)}) ${taint.expression}`
              });
              changed = true;
            }
          }
        }

        if (changed) {
          // Re-evaluate overallState
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
