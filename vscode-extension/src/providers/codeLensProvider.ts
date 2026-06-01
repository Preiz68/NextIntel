import * as vscode from "vscode";
import { Diagnostic as RuleDiagnostic } from "rules";

export class NextIntelCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(
    private readonly documentDiagnostics: Map<string, RuleDiagnostic[]>
  ) {}

  /** Call after diagnostics update to force a CodeLens refresh. */
  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken
  ): vscode.CodeLens[] {
    const key = document.uri.toString();
    const allDiags = this.documentDiagnostics.get(key);
    if (!allDiags || allDiags.length === 0) return [];

    // Group diagnostics by 0-based line
    const byLine = new Map<number, RuleDiagnostic[]>();
    for (const d of allDiags) {
      const line = Math.max(0, (d.line ?? 1) - 1);
      if (!byLine.has(line)) byLine.set(line, []);
      byLine.get(line)!.push(d);
    }

    const lenses: vscode.CodeLens[] = [];

    for (const [line, diags] of byLine) {
      // Sort by severity: errors first
      const sorted = [...diags].sort((a, b) => {
        const rank = (s: string) =>
          s === "error" ? 0 : s === "warning" ? 1 : 2;
        return rank(String(a.severity)) - rank(String(b.severity));
      });

      const errors = sorted.filter(
        (d) => String(d.severity).toLowerCase() === "error"
      ).length;
      const warnings = sorted.filter(
        (d) => String(d.severity).toLowerCase() === "warning"
      ).length;
      const infos = sorted.filter((d) =>
        ["info", "information"].includes(String(d.severity).toLowerCase())
      ).length;

      const parts: string[] = [];
      if (errors > 0) parts.push(`🔴 ${errors} error${errors !== 1 ? "s" : ""}`);
      if (warnings > 0) parts.push(`🟡 ${warnings} warning${warnings !== 1 ? "s" : ""}`);
      if (infos > 0) parts.push(`🔵 ${infos} suggestion${infos !== 1 ? "s" : ""}`);

      const range = new vscode.Range(line, 0, line, 0);

      // ── Summary lens (always shown) ─────────────────────────────────────
      lenses.push(
        new vscode.CodeLens(range, {
          title: `⚡ NextIntel · ${parts.join(" · ")} — hover or click for details`,
          command: "next-intel.showPanel",
          arguments: [document.uri.toString(), line, sorted],
          tooltip: sorted.map((d) => `• [${d.id}] ${d.message}`).join("\n"),
        })
      );

      // ── Per-issue lenses (only when more than 1 issue) ──────────────────
      if (sorted.length > 1) {
        for (const d of sorted) {
          const sev = String(d.severity).toLowerCase();
          const bullet =
            sev === "error" ? "🔴" : sev === "warning" ? "🟡" : "🔵";
          const shortMsg =
            d.message.length > 70
              ? d.message.slice(0, 67) + "…"
              : d.message;
          lenses.push(
            new vscode.CodeLens(range, {
              title: `  ${bullet} ${d.id}: ${shortMsg}`,
              command: "next-intel.showPanel",
              arguments: [document.uri.toString(), line, [d]],
            })
          );
        }
      }
    }

    return lenses;
  }
}
