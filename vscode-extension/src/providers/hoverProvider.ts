import * as vscode from "vscode";
import { Diagnostic as RuleDiagnostic } from "rules";
import { parseExample } from "./exampleParser";

// ─── Severity display maps ───────────────────────────────────────────────────

const SEV_ICON: Record<string, string> = {
  error: "🔴",
  warning: "🟡",
  info: "🔵",
  information: "🔵",
  hint: "⚪",
};

const SEV_LABEL: Record<string, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
  information: "Info",
  hint: "Hint",
};

// ─── Provider ────────────────────────────────────────────────────────────────

export class NextIntelHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly documentDiagnostics: Map<string, RuleDiagnostic[]>,
    private readonly isHoverAllowed?: () => boolean
  ) {}

  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.Hover | null {
    const key = document.uri.toString();
    const allDiags = this.documentDiagnostics.get(key);
    if (!allDiags || allDiags.length === 0) return null;

    // Match diagnostics on the hovered line (d.line is 1-based)
    const hoveredLine = position.line + 1;
    const matching = allDiags.filter((d) => (d.line ?? 1) === hoveredLine);
    if (matching.length === 0) return null;

    // Trigger opening the webview panel on hover (except on immediate editor open)
    if (!this.isHoverAllowed || this.isHoverAllowed()) {
      vscode.commands.executeCommand("next-intel.showPanel", key, position.line, matching);
    }

    const contents = matching.map((d) => this.buildCard(d));

    // Highlight the entire non-whitespace span of the line
    const lineText = document.lineAt(position.line).text;
    const firstNonWS = lineText.search(/\S/);
    const hoverRange = new vscode.Range(
      position.line,
      firstNonWS >= 0 ? firstNonWS : 0,
      position.line,
      lineText.length
    );

    return new vscode.Hover(contents, hoverRange);
  }

  private buildCard(d: RuleDiagnostic): vscode.MarkdownString {
    const md = new vscode.MarkdownString("", true);
    md.isTrusted = true;
    md.supportThemeIcons = true;

    const sev = String(d.severity).toLowerCase();
    const icon = SEV_ICON[sev] ?? "⚪";
    const label = SEV_LABEL[sev] ?? "Notice";

    // ── Header ──────────────────────────────────────────────────────────────
    md.appendMarkdown(`### $(zap) NextIntel\n\n`);
    md.appendMarkdown(
      `${icon} **${label}** &nbsp;|&nbsp; ` +
      `\`${d.id}\` &nbsp;|&nbsp; \`${d.ruleId}\`\n\n`
    );

    // ── Guarded indicator ────────────────────────────────────────────────────
    if (d.isGuarded) {
      md.appendMarkdown(`> $(shield) *Guarded — severity reduced to warning.*\n\n`);
    }

    md.appendMarkdown(`---\n\n`);

    // ── Violation message ────────────────────────────────────────────────────
    md.appendMarkdown(`**${d.message}**\n\n`);

    // ── Why it matters ───────────────────────────────────────────────────────
    if (d.whyItMatters) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`#### $(info) Why It Matters\n\n`);
      md.appendMarkdown(`${d.whyItMatters}\n\n`);
    }

    // ── Quick fixes ──────────────────────────────────────────────────────────
    const fixes = d.quickFixes?.length
      ? d.quickFixes
      : d.fix
      ? [d.fix]
      : [];

    if (fixes.length > 0) {
      md.appendMarkdown(`#### $(wrench) Quick Fixes\n\n`);
      for (const fix of fixes) {
        md.appendMarkdown(`- ${fix}\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // ── Safe refactor suggestion (code preview) ──────────────────────────────
    if (d.safeRefactorSuggestion) {
      md.appendMarkdown(`#### $(symbol-snippet) Refactor Preview\n\n`);
      md.appendCodeblock(d.safeRefactorSuggestion, "typescript");
    }

    // ── Optimization guidance ────────────────────────────────────────────────
    if (d.optimizationGuidance?.length) {
      md.appendMarkdown(`#### $(rocket) Optimization\n\n`);
      for (const o of d.optimizationGuidance) {
        md.appendMarkdown(`- ${o}\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // ── Architecture suggestions ─────────────────────────────────────────────
    if (d.architectureSuggestions?.length) {
      md.appendMarkdown(`#### $(symbol-structure) Architecture\n\n`);
      for (const s of d.architectureSuggestions) {
        md.appendMarkdown(`- ${s}\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // ── Production risks ─────────────────────────────────────────────────────
    if (d.productionRisks?.length) {
      md.appendMarkdown(`#### $(warning) Production Risks\n\n`);
      for (const r of d.productionRisks) {
        md.appendMarkdown(`- ${r}\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // ── Code examples ─────────────────────────────────────────────────────────
    const appendStructuredExample = (rawCode: string, label: string, icon: string) => {
      const parsed = parseExample(rawCode);
      md.appendMarkdown(`#### ${icon} ${label}\n\n`);
      if (parsed.description) {
        md.appendMarkdown(`*${parsed.description}*\n\n`);
      }
      for (const file of parsed.files) {
        if (file.filename) {
          md.appendMarkdown(`📄 **${file.filename}**\n`);
        }
        md.appendCodeblock(file.code, "typescript");
      }
    };

    if (d.examples?.invalid?.length) {
      md.appendMarkdown(`---\n\n`);
      appendStructuredExample(d.examples.invalid[0]!, "Avoid", "$(error)");
    }
    if (d.examples?.valid?.length) {
      if (!d.examples?.invalid?.length) {
        md.appendMarkdown(`---\n\n`);
      }
      appendStructuredExample(d.examples.valid[0]!, "Prefer", "$(pass-filled)");
    }

    return md;
  }
}
