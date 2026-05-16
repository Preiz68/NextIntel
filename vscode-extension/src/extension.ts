import * as vscode from "vscode";
import { analyzeFiles } from "engine";
import { RuleEngine, rules, Diagnostic as RuleDiagnostic } from "rules";

// Rule IDs — must exactly match rule definitions in packages/rules/src/
const RSC_BOUNDARY_RULE_IDS = new Set([
  "no-hooks-in-server-components",
  "no-browser-api-in-server-components",
]);

const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

export function activate(context: vscode.ExtensionContext) {
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("nextintel");

  const outputChannel = vscode.window.createOutputChannel("NextIntel");
  outputChannel.appendLine("✅ NextIntel activated");

  // Initialize Rule Engine once and reuse it
  const ruleEngine = new RuleEngine();
  for (const rule of rules) {
    ruleEngine.registerRule(rule);
  }

  // ─── Debounced Refresh ──────────────────────────────────────────────────────
  let timeout: ReturnType<typeof setTimeout> | undefined;

  function triggerRefresh(document: vscode.TextDocument) {
    if (!SUPPORTED_LANGUAGES.has(document.languageId)) {
      return;
    }
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      refreshDiagnostics(document);
    }, 400);
  }

  async function refreshDiagnostics(document: vscode.TextDocument) {
    // Guard: skip unsaved/untitled files & non-file URIs
    if (document.uri.scheme !== "file") {
      return;
    }

    try {
      const analyses = await analyzeFiles([document.fileName]);

      const diagnostics = ruleEngine.run({
        analyses,
        graph: null as any, // full graph not available per-file; graph rules are skipped
        nodes: new Map(),
        edges: [],
      });

      const vscodeDiagnostics: vscode.Diagnostic[] = diagnostics.map(
        (d: RuleDiagnostic) => {
          // Lines are 1-indexed from the engine; VS Code is 0-indexed
          const line = Math.max(0, (d.line ?? 1) - 1);
          const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);

          const severity =
            d.severity === "error"
              ? vscode.DiagnosticSeverity.Error
              : d.severity === "info"
                ? vscode.DiagnosticSeverity.Information
                : vscode.DiagnosticSeverity.Warning;

          const vsDiag = new vscode.Diagnostic(range, d.message, severity);
          vsDiag.code = d.ruleId;
          vsDiag.source = "NextIntel";

          return vsDiag;
        },
      );

      diagnosticCollection.set(document.uri, vscodeDiagnostics);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      outputChannel.appendLine(`⚠️  Analysis failed for ${document.fileName}: ${msg}`);
      // Clear stale diagnostics on error so squiggles don't get stuck
      diagnosticCollection.delete(document.uri);
    }
  }

  // ─── Code Actions (Quick Fixes) ──────────────────────────────────────────────
  const fixProvider = vscode.languages.registerCodeActionsProvider(
    [
      { scheme: "file", language: "typescript" },
      { scheme: "file", language: "typescriptreact" },
      { scheme: "file", language: "javascript" },
      { scheme: "file", language: "javascriptreact" },
    ],
    {
      provideCodeActions(
        document: vscode.TextDocument,
        _range: vscode.Range,
        context: vscode.CodeActionContext,
      ) {
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
          if (diagnostic.source !== "NextIntel") {
            continue;
          }
          if (!RSC_BOUNDARY_RULE_IDS.has(String(diagnostic.code))) {
            continue;
          }

          // Guard: don't add "use client" if it's already there
          const firstLine = document.lineAt(0).text.trim();
          if (firstLine === '"use client";' || firstLine === "'use client';") {
            continue;
          }

          const action = new vscode.CodeAction(
            'Add "use client" directive',
            vscode.CodeActionKind.QuickFix,
          );
          const edit = new vscode.WorkspaceEdit();
          edit.insert(document.uri, new vscode.Position(0, 0), '"use client";\n\n');
          action.edit = edit;
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }

        return actions;
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    },
  );

  // ─── Clear diagnostics for closed files ─────────────────────────────────────
  const onCloseListener = vscode.workspace.onDidCloseTextDocument((doc) => {
    diagnosticCollection.delete(doc.uri);
  });

  // ─── Subscriptions ───────────────────────────────────────────────────────────
  context.subscriptions.push(
    diagnosticCollection,
    outputChannel,
    fixProvider,
    onCloseListener,
    vscode.workspace.onDidSaveTextDocument((doc) => triggerRefresh(doc)),
    vscode.workspace.onDidOpenTextDocument((doc) => triggerRefresh(doc)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        triggerRefresh(editor.document);
      }
    }),
  );

  // Initial check on currently active file
  if (vscode.window.activeTextEditor) {
    triggerRefresh(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  // VS Code disposes all context.subscriptions automatically.
}
