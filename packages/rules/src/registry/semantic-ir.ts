import { Capability, ExportNode, GraphEdge, ModuleSemanticNode, ExecutionPhase } from "../types.js";
import path from "node:path";

const NODE_NATIVE_MODULES = new Set([
  "fs", "node:fs", "path", "node:path", "net", "node:net", "crypto", "node:crypto",
  "os", "node:os", "child_process", "node:child_process", "dns", "node:dns",
  "http", "node:http", "https", "node:https", "tls", "node:tls", "dgram", "node:dgram"
]);

export function buildSemanticIR(
  graph: any,
  nodes: Map<string, any>,
  analyses: any[]
): Map<string, ModuleSemanticNode> {
  const semanticIR = new Map<string, ModuleSemanticNode>();

  // 1. Initialize nodes
  for (const analysis of analyses) {
    const filePath = analysis.filePath;
    const node = nodes.get(filePath);
    const kind = node?.semanticKind ?? analysis.semanticKind ?? "unknown";

    // Runtimes
    let runtime: "node" | "browser" | "edge" | "shared" = "node";
    if (analysis.runtime === "client" || node?.isClientComponent || kind === "client-component") {
      runtime = "browser";
    } else if (analysis.isEdgeRuntime || analysis.runtime === "edge") {
      runtime = "edge";
    } else if (analysis.runtime === "shared" || kind === "shared-util") {
      runtime = "shared";
    }

    // Execution Phases Access
    const phaseAccess: ExecutionPhase[] = [];
    if (kind === "client-component" || kind === "client-util") {
      phaseAccess.push("CLIENT_RENDER", "HYDRATION");
    } else if (kind === "server-component" || ["page", "layout", "template", "loading", "error", "not-found", "global-error", "default"].includes(kind)) {
      phaseAccess.push("RSC_RENDER");
    } else if (kind === "server-action") {
      phaseAccess.push("SERVER_ACTION");
    } else if (kind === "route-handler") {
      phaseAccess.push("RSC_RENDER", "SERVER_ACTION");
    } else {
      phaseAccess.push("RSC_RENDER", "CLIENT_RENDER", "HYDRATION");
    }

    // Imports
    const imports: GraphEdge[] = [];
    if (analysis.importDetails) {
      for (const imp of analysis.importDetails) {
        let resolved = imp.moduleSpecifier;
        if (imp.moduleSpecifier.startsWith(".")) {
          resolved = path.resolve(path.dirname(filePath), imp.moduleSpecifier).replace(/\\/g, "/");
        }
        imports.push({
          from: filePath,
          to: resolved,
          specifier: imp.moduleSpecifier
        });
      }
    }

    // Exports & Serializability
    const exports: ExportNode[] = [];
    let hasNonSerializableExport = false;
    if (analysis.exportDetails) {
      for (const exp of analysis.exportDetails) {
        const isSerializable = exp.kind !== "function" && exp.kind !== "class";
        if (!isSerializable) {
          hasNonSerializableExport = true;
        }
        exports.push({
          name: exp.name,
          kind: exp.kind,
          isSerializable
        });
      }
    }

    // Initialize Capabilities
    const capabilities: Capability[] = [];

    // Is Server Only?
    const hasServerOnlyTaint = analysis.taints?.some((t: any) => t.type === "SERVER_ONLY" && t.state === "TAINTED");
    const importsServerOnly = analysis.imports?.some((imp: string) => imp === "server-only" || imp.includes("server-only"));
    if (kind === "server-component" || kind === "server-util" || kind === "server-action" || hasServerOnlyTaint || importsServerOnly) {
      capabilities.push("SERVER_ONLY");
    }

    // Request Context?
    const hasRequestContextTaint = analysis.taints?.some((t: any) => t.type === "REQUEST_CONTEXT" && t.state === "TAINTED");
    const importsHeaders = analysis.imports?.some((imp: string) => imp === "next/headers");
    if (hasRequestContextTaint || importsHeaders) {
      capabilities.push("REQUEST_CONTEXT");
    }

    // Node Runtime?
    const hasNodeTaint = analysis.taints?.some((t: any) => t.type === "NODE_NATIVE_API" && t.state === "TAINTED");
    const importsNodeNative = analysis.imports?.some((imp: string) => NODE_NATIVE_MODULES.has(imp));
    if (hasNodeTaint || importsNodeNative) {
      capabilities.push("NODE_RUNTIME");
    }

    // Browser Runtime?
    const hasBrowserTaint = analysis.taints?.some((t: any) => t.type === "BROWSER_ONLY" && t.state === "TAINTED");
    if (analysis.usesBrowserAPI || hasBrowserTaint) {
      capabilities.push("BROWSER_RUNTIME");
    }

    // Client Safe?
    if (node?.isClientComponent || kind === "client-component" || kind === "client-util") {
      if (!capabilities.includes("SERVER_ONLY")) {
        capabilities.push("CLIENT_SAFE");
      }
    }

    // Hydration Unsafe?
    const hasNondeterminism = analysis.hydration?.nonDeterministicExpressions?.length > 0 ||
      analysis.simulationFindings?.some((f: any) => f.type === "hydration_nondeterminism");
    if (hasNondeterminism) {
      capabilities.push("HYDRATION_UNSAFE");
    }

    // Non Serializable?
    if (hasNonSerializableExport) {
      capabilities.push("NON_SERIALIZABLE");
    }

    // RSC / Action Safe?
    if (!capabilities.includes("BROWSER_RUNTIME") && !capabilities.includes("HYDRATION_UNSAFE")) {
      capabilities.push("RSC_SAFE");
    }
    if (!capabilities.includes("BROWSER_RUNTIME") && !capabilities.includes("NON_SERIALIZABLE")) {
      capabilities.push("ACTION_SAFE");
    }

    semanticIR.set(filePath, {
      filePath,
      kind,
      capabilities,
      imports,
      exports,
      runtime,
      phaseAccess
    });
  }

  // 2. Propagate capabilities upward (imported to importer / successors to predecessors)
  const queue = Array.from(semanticIR.keys());
  while (queue.length > 0) {
    const curr = queue.shift()!;
    const currNode = semanticIR.get(curr)!;
    const predecessors = graph?.predecessors(curr) || [];

    for (const pred of predecessors) {
      const predNode = semanticIR.get(pred);
      if (!predNode) continue;

      let changed = false;
      for (const cap of currNode.capabilities) {
        if (
          cap === "SERVER_ONLY" ||
          cap === "REQUEST_CONTEXT" ||
          cap === "NODE_RUNTIME" ||
          cap === "BROWSER_RUNTIME" ||
          cap === "HYDRATION_UNSAFE" ||
          cap === "NON_SERIALIZABLE"
        ) {
          if (!predNode.capabilities.includes(cap)) {
            predNode.capabilities.push(cap);
            changed = true;
          }
        }
      }
      if (changed) {
        queue.push(pred);
      }
    }
  }

  return semanticIR;
}
