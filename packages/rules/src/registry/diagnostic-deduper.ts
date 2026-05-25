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
  resolveRootFile: (file: string, ruleId: string) => string
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
    const ruleId = d.id || d.ruleId;
    const rootFile = resolveRootFile(d.file, ruleId);
    const groupKey = `${rootFile}:${ruleId}`;

    if (!rootGroups.has(groupKey)) {
      rootGroups.set(groupKey, []);
    }
    rootGroups.get(groupKey)!.push(d);
  }

  const collapsed: Diagnostic[] = [];

  for (const [groupKey, list] of rootGroups.entries()) {
    const [rootFile] = groupKey.split(":");
    // Find the diagnostic belonging to the root file, if exists
    let rootDiag = list.find((d) => d.file === rootFile);
    if (!rootDiag) {
      rootDiag = list[0]!;
    }

    const propagated = list
      .filter((d) => d.file !== rootDiag!.file)
      .map((d) => ({ file: d.file, line: d.line }));

    if (propagated.length > 0) {
      (rootDiag as any).propagatedTargets = propagated;
    }

    collapsed.push(rootDiag);
  }

  return collapsed;
}
