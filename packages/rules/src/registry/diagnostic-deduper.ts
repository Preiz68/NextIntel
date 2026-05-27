import { Diagnostic } from "../types.js";

/**
 * Creates a unique hash for a diagnostic to prevent syntactic duplication.
 */
export function createDiagnosticIdentityHash(d: Diagnostic): string {
  return `${d.file}:${d.line ?? 0}:${d.id || d.ruleId}:${d.message}`;
}

/**
 * Collapses cascading diagnostics pointing to the same root file.
 * Returns only the root-cause diagnostics, with propagated files attached.
 */
export function deduplicateDiagnostics(
  diagnostics: Diagnostic[],
  resolveRootFile: (d: Diagnostic) => string
): Diagnostic[] {
  const seenHashes = new Set<string>();
  const uniqueDiags = diagnostics.filter((d) => {
    const hash = createDiagnosticIdentityHash(d);
    if (seenHashes.has(hash)) return false;
    seenHashes.add(hash);
    return true;
  });

  const rootGroups = new Map<string, Diagnostic[]>();

  for (const d of uniqueDiags) {
    const rootFile = resolveRootFile(d);
    const ruleId = d.id || d.ruleId;
    const groupKey = `${rootFile}:${ruleId}`;

    if (!rootGroups.has(groupKey)) {
      rootGroups.set(groupKey, []);
    }
    rootGroups.get(groupKey)!.push(d);
  }

  const collapsed: Diagnostic[] = [];

  for (const [groupKey, list] of rootGroups.entries()) {
    const parts = groupKey.split(":");
    const rootFile = parts.slice(0, parts.length - 1).join(":");

    // Find the diagnostic belonging to the root file, if exists
    let rootDiag = list.find((d) => d.file === rootFile);
    let originalFile = "";
    if (rootDiag) {
      originalFile = rootDiag.file;
      rootDiag = { ...rootDiag };
    } else {
      originalFile = list[0]!.file;
      rootDiag = { ...list[0]! };
      rootDiag.file = rootFile;
    }

    (rootDiag as any).rootViolationOrigin = rootFile;
    if (originalFile !== rootFile) {
      (rootDiag as any).propagationImpact = originalFile;
    }

    const propagatedSeen = new Set<string>();
    const propagated = list
      .filter((d) => d.file !== rootFile)
      .map((d) => ({ file: d.file, line: d.line }))
      .filter((item) => {
        const key = `${item.file}:${item.line}`;
        if (propagatedSeen.has(key)) return false;
        propagatedSeen.add(key);
        return true;
      });

    if (propagated.length > 0) {
      (rootDiag as any).propagatedTargets = propagated;
    }

    collapsed.push(rootDiag);
  }

  return collapsed;
}
