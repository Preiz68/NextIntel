import * as vscode from "vscode";
import { analyzeFiles, analyzeFile } from "engine";
import { RuleEngine, rules, Diagnostic as RuleDiagnostic, KnowledgeRegistry } from "rules";

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

  // Store rich diagnostics for Hover and Code Actions
  const documentDiagnostics = new Map<string, RuleDiagnostic[]>();

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
      // Use real-time unsaved document text!
      const analysis = await analyzeFile(document.fileName, { fileContent: document.getText() });
      const analyses = [analysis];

      const diagnostics = ruleEngine.run({
        analyses,
        graph: null as any, // full graph not available per-file; graph rules are skipped
        nodes: new Map(),
        edges: [],
      });

      // Save rich diagnostics for hover provider
      documentDiagnostics.set(document.uri.toString(), diagnostics);

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
        const fileDiagnostics = documentDiagnostics.get(document.uri.toString()) || [];

        for (const diagnostic of context.diagnostics) {
          if (diagnostic.source !== "NextIntel") {
            continue;
          }

          // 1. Dynamic Quick Fixes from Knowledge Pack
          const ruleDiag = fileDiagnostics.find(d => 
            d.ruleId === diagnostic.code && 
            Math.max(0, (d.line ?? 1) - 1) === diagnostic.range.start.line
          );

          if (ruleDiag?.quickFixes) {
            for (const fix of ruleDiag.quickFixes) {
              const action = new vscode.CodeAction(
                `💡 ${fix}`,
                vscode.CodeActionKind.QuickFix,
              );
              action.diagnostics = [diagnostic];
              actions.push(action);
            }
          }

          // 2. Automated Text Edit for 'use client' (Specific behavior)
          if (RSC_BOUNDARY_RULE_IDS.has(String(diagnostic.code))) {
            const firstLine = document.lineAt(0).text.trim();
            if (firstLine !== '"use client";' && firstLine !== "'use client';") {
              const action = new vscode.CodeAction(
                '⚡ Auto-fix: Add "use client" directive',
                vscode.CodeActionKind.QuickFix,
              );
              const edit = new vscode.WorkspaceEdit();
              edit.insert(document.uri, new vscode.Position(0, 0), '"use client";\n\n');
              action.edit = edit;
              action.diagnostics = [diagnostic];
              action.isPreferred = true;
              actions.push(action);
            }
          }
        }

        return actions;
      },
    },
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    },
  );

  // ─── Hover Provider (Rich Metadata) ─────────────────────────────────────────
  const hoverProvider = vscode.languages.registerHoverProvider(
    Array.from(SUPPORTED_LANGUAGES).map((lang) => ({ scheme: "file", language: lang })),
    {
      provideHover(document, position) {
        const fileDiagnostics = documentDiagnostics.get(document.uri.toString());
        if (!fileDiagnostics) {
          return null;
        }

        const hovers: vscode.MarkdownString[] = [];

        for (const d of fileDiagnostics) {
          const line = Math.max(0, (d.line ?? 1) - 1);
          if (position.line !== line) {
            continue;
          }

          const markdown = new vscode.MarkdownString();
          markdown.isTrusted = true;
          markdown.supportHtml = true;

          markdown.appendMarkdown(`### ⚠️ NextIntel: ${d.message}\n\n`);
          
          if (d.whyItMatters) {
            markdown.appendMarkdown(`**💡 Why It Matters:**\n${d.whyItMatters}\n\n`);
          }
          if (d.architectureSuggestions?.length) {
            markdown.appendMarkdown(`**🏗️ Architecture Suggestions:**\n`);
            d.architectureSuggestions.forEach(s => markdown.appendMarkdown(`- ${s}\n`));
            markdown.appendMarkdown(`\n`);
          }
          if (d.optimizationGuidance?.length) {
            markdown.appendMarkdown(`**⚡ Optimization Guidance:**\n`);
            d.optimizationGuidance.forEach(s => markdown.appendMarkdown(`- ${s}\n`));
            markdown.appendMarkdown(`\n`);
          }
          if (d.productionRisks?.length) {
            markdown.appendMarkdown(`**🔥 Production Risks:**\n`);
            d.productionRisks.forEach(s => markdown.appendMarkdown(`- ${s}\n`));
            markdown.appendMarkdown(`\n`);
          }
          if (d.examples?.invalid?.length || d.examples?.valid?.length) {
            markdown.appendMarkdown(`**✅ Examples:**\n`);
            if (d.examples.invalid?.length) {
              markdown.appendMarkdown(`*Invalid:*\n\`\`\`typescript\n${d.examples.invalid[0]}\n\`\`\`\n`);
            }
            if (d.examples.valid?.length) {
              markdown.appendMarkdown(`*Valid:*\n\`\`\`typescript\n${d.examples.valid[0]}\n\`\`\`\n`);
            }
          }

          hovers.push(markdown);
        }

        if (hovers.length === 0) {
          return null;
        }

        return new vscode.Hover(hovers);
      }
    }
  );

  // ─── Clear diagnostics for closed files ─────────────────────────────────────
  const onCloseListener = vscode.workspace.onDidCloseTextDocument((doc) => {
    diagnosticCollection.delete(doc.uri);
    documentDiagnostics.delete(doc.uri.toString());
  });

  // ─── Subscriptions ───────────────────────────────────────────────────────────
  context.subscriptions.push(
    diagnosticCollection,
    outputChannel,
    fixProvider,
    hoverProvider,
    onCloseListener,
    vscode.workspace.onDidChangeTextDocument((e) => triggerRefresh(e.document)),
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
