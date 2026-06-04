import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

/**
 * Returns true only when the file path contains a path segment that is the
 * standalone word "action" or "actions", preventing false matches on files
 * like `satisfaction.ts` or `transactional.ts`.
 */
function isActionFilePath(filePath: string): boolean {
  const ACTION_SEGMENT_RE = /\bactions?\b/i;
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    const bare = seg.replace(/\.[^.]+$/, "");
    if (ACTION_SEGMENT_RE.test(bare)) return true;
  }
  return false;
}

export const noClientImportServerOnly: Rule = {
  id: "no-client-import-server-only",

  meta: {
    description:
      "Client Components cannot import Server Components or server-only modules directly.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const [nodePath, node] of context.nodes.entries()) {
      const isClient = node?.isClientComponent || node?.semanticKind === "client-component";
      if (!isClient) continue;

      // BFS to find reachable Server Components
      const visited = new Set<string>([nodePath]);
      const queue: string[] = [nodePath];
      const parentMap = new Map<string, string>();
      const targets: string[] = [];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const successors = (context as any).graph?.successors(curr) || [];
        for (const succ of successors) {
          const succNode = context.nodes.get(succ);
          const isServerAction =
            succNode?.semanticKind === "server-action" ||
            (succNode as any)?.isServerAction ||
            isActionFilePath(succ);
          if (isServerAction) continue;

          if (!visited.has(succ)) {
            visited.add(succ);
            parentMap.set(succ, curr);

            const succSemantic = context.semanticIR?.get(succ);
            const isServer = succNode?.isServerComponent || succNode?.semanticKind === "server-component" || succSemantic?.kind === "server-component";
            if (isServer) {
              targets.push(succ);
            } else {
              queue.push(succ);
            }
          }
        }
      }

      for (const target of targets) {
        // Trace back path to find the first hop
        const pathNodes: string[] = [];
        let curr: string | undefined = target;
        while (curr) {
          pathNodes.unshift(curr);
          curr = parentMap.get(curr);
        }

        const nextHop = pathNodes[1] || target;

        // Resolve the line and column where this import statement starts from AST analysis
        let line = 1;
        let column: number | undefined;
        let endColumn: number | undefined;

        const fileAnalysis = context.analyses.find((a) => a.filePath === nodePath);
        if (fileAnalysis) {
          const targetBase = path.basename(nextHop, path.extname(nextHop)).replace(/^temp-/, "");
          const imp = fileAnalysis.importDetails.find(
            (i) =>
              i.moduleSpecifier.includes(targetBase) ||
              (i.defaultImport && i.defaultImport.includes(targetBase)) ||
              i.namedImports.some((n) => n.includes(targetBase))
          );
          if (imp) {
            line = imp.line ?? 1;
            column = imp.column;
            endColumn = imp.endColumn;
          }
        }

        const diag = mapEventToDiagnostic(
          "SERVER_IMPORT_IN_CLIENT_COMPONENT",
          "CC-SERVER-IMPORT-001",
          this.id,
          nodePath,
          line,
          `Client Component '${nodePath}' imports Server Component/Module '${target}'.`,
          false,
          column,
          endColumn
        );
        diag.safeRefactorSuggestion = `// Pass the Server Component as children or slot props to preserve Server boundaries:
// 1. In the parent Server Component:
import ClientRoot from "./ClientRoot";
import ServerPanel from "./ServerPanel";

export default function Page() {
  return (
    <ClientRoot>
      <ServerPanel />
    </ClientRoot>
  );
}

// 2. In your Client Component (ClientRoot.tsx):
export default function ClientRoot({ children }: { children: React.ReactNode }) {
  return <div className="client-wrapper">{children}</div>;
}`;
        diagnostics.push(diag);
      }
    }

    return diagnostics;
  },
};
