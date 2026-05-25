import path from "node:path";
import { getLastGraphNodes, resolvedOwnerships, resolvedRuntimes } from "./engine.js";

const SYMBOL_MAPPINGS: Record<string, { module?: string; reference?: string; requirement: string }> = {
  headers: { module: "next/headers", requirement: "requires request context" },
  cookies: { module: "next/headers", requirement: "requires request context" },
  draftmode: { module: "next/headers", requirement: "requires request context" },
  serveronly: { module: "server-only", requirement: "requires server runtime" },
  "server-only": { module: "server-only", requirement: "requires server runtime" },
  localstorage: { reference: "localStorage", requirement: "requires browser environment" },
  window: { reference: "window", requirement: "requires browser environment" },
  navigator: { reference: "navigator", requirement: "requires browser environment" },
  document: { reference: "document", requirement: "requires browser environment" },
  revalidatepath: { module: "next/cache", requirement: "requires server runtime" },
  revalidatetag: { module: "next/cache", requirement: "requires server runtime" },
};

function getFileSuffix(filePath: string): string {
  const nodes = getLastGraphNodes();
  const node = nodes?.get(filePath);
  
  if (node) {
    if (node.semanticKind === "client-component" || node.isClientComponent) {
      return " (client)";
    }
    if (node.semanticKind === "server-component" || node.isServerComponent) {
      return " (server)";
    }
    if (node.semanticKind === "server-action") {
      return " (server action)";
    }
  }

  return "";
}

/**
 * Generates an ASCII visual representation of the execution path,
 * highlighting boundaries and invalid transition segments in a tree structure.
 */
export function generateExecutionGraph(
  tracePath: string[],
  _resolvedOwnerships: Map<string, string>,
  _resolvedRuntimes: Map<string, string>
): string {
  if (tracePath.length === 0) return "";

  let output = "";
  let indentLevel = 0;

  for (let i = 0; i < tracePath.length; i++) {
    const item = tracePath[i]!;
    const isFile = (item.includes("/") || item.includes("\\") || item.includes(".")) && !item.includes("(");
    const prefix = indentLevel === 0 ? "" : " ".repeat(6 * indentLevel - 4) + "└── ";

    if (isFile) {
      const base = path.basename(item);
      const suffix = getFileSuffix(item);
      
      if (i === 0) {
        output += `${base}${suffix}`;
      } else {
        output += `\n${prefix}imports ${base}${suffix}`;
      }
      indentLevel++;
    } else {
      // It is a symbol / API reference or module name
      const key = item.toLowerCase().replace(/[()]/g, "");
      const mapping = SYMBOL_MAPPINGS[key];

      if (mapping) {
        if (mapping.module) {
          output += `\n${prefix}imports ${mapping.module}`;
          indentLevel++;
          const subPrefix = " ".repeat(6 * indentLevel - 4) + "└── ";
          output += `\n${subPrefix}${mapping.requirement}`;
        } else if (mapping.reference) {
          output += `\n${prefix}references ${mapping.reference}`;
          indentLevel++;
          const subPrefix = " ".repeat(6 * indentLevel - 4) + "└── ";
          output += `\n${subPrefix}${mapping.requirement}`;
        }
      } else {
        const actionWord = (tracePath.length === 2 && i === 1) ? "exports" : "references";
        output += `\n${prefix}${actionWord} ${item}`;
      }
      indentLevel++;
    }
  }

  return output;
}

