import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import path from "node:path";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

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
            succNode?.isServerAction ||
            succ.toLowerCase().includes("action");
          if (isServerAction) continue;

          if (!visited.has(succ)) {
            visited.add(succ);
            parentMap.set(succ, curr);

            const isServer = succNode?.isServerComponent || succNode?.semanticKind === "server-component";
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

        // Resolve the line where this import statement starts
        let line = 1;
        try {
          const content = readFileSync(nodePath, "utf-8");
          const lines = content.split("\n");
          const targetBase = path
            .basename(nextHop, path.extname(nextHop))
            .replace(/^temp-/, "");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i]!.includes(targetBase)) {
              // Scan backwards to find the start of the import statement
              let importLine = i;
              while (importLine >= 0 && !lines[importLine]!.includes("import")) {
                importLine--;
              }
              line = (importLine >= 0 ? importLine : i) + 1;
              break;
            }
          }
        } catch {
          // ignore
        }

        diagnostics.push(
          mapEventToDiagnostic(
            "SERVER_IMPORT_IN_CLIENT_COMPONENT",
            "CC-SERVER-IMPORT-001",
            this.id,
            nodePath,
            line,
            `Client Component '${nodePath}' imports Server Component/Module '${target}'.`
          )
        );
      }
    }

    return diagnostics;
  },
};
