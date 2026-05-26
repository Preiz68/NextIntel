import * as vscode from "vscode";
import { Diagnostic as RuleDiagnostic } from "rules";

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

// ─────────────────────────────────────────────
// RULE BEHAVIOR SYSTEM (RSC INTEGRATED)
// ─────────────────────────────────────────────

type RuleBehavior = {
  autoFix?: (document: vscode.TextDocument) => vscode.WorkspaceEdit | null;
};

const RULE_BEHAVIORS: Record<string, RuleBehavior> = {
  "no-hooks-in-server-components": {
    autoFix: (document) => {
      const firstLine = document.lineAt(0).text.trim();

      if (firstLine === '"use client";' || firstLine === "'use client';") {
        return null;
      }

      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), '"use client";\n\n');

      return edit;
    },
  },

  "no-browser-api-in-server-components": {
    autoFix: () => null,
  },
};

// Helpers
function isRscRule(ruleId: string | number | undefined) {
  return RULE_BEHAVIORS.hasOwnProperty(String(ruleId));
}

function getRuleBehavior(ruleId: string | number | undefined) {
  return RULE_BEHAVIORS[String(ruleId)];
}

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────

let ruleEngine: any;
let rulesLoaded = false;

let isReady = false;

const documentDiagnostics = new Map<string, RuleDiagnostic[]>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const cancelTokens = new Map<string, vscode.CancellationTokenSource>();

let diagnostics: vscode.DiagnosticCollection;

// ─────────────────────────────────────────────
// LAZY ENGINE INIT
// ─────────────────────────────────────────────

async function getRuleEngine() {
  if (rulesLoaded) return ruleEngine;

  const { RuleEngine, rules } = await import("rules");

  ruleEngine = new RuleEngine();

  for (const rule of rules) {
    ruleEngine.registerRule(rule);
  }

  rulesLoaded = true;
  return ruleEngine;
}

async function getAnalyzer() {
  return await import("engine");
}

// ─────────────────────────────────────────────
// ACTIVATION
// ─────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  console.log("NextIntel activated (light mode)");

  diagnostics = vscode.languages.createDiagnosticCollection("nextintel");
  context.subscriptions.push(diagnostics);

  const output = vscode.window.createOutputChannel("NextIntel");
  output.appendLine("🚀 NextIntel running in production mode");

  // READY GATE
  const readyTimer = setTimeout(() => {
    isReady = true;

    // 🔥 run initial analysis immediately
    if (vscode.window.activeTextEditor) {
      schedule(vscode.window.activeTextEditor.document);
    }
  }, 1000);

  context.subscriptions.push({
    dispose: () => clearTimeout(readyTimer),
  });

  // ─────────────────────────────────────────────
  // SAFE SCHEDULER
  // ─────────────────────────────────────────────

  function schedule(document: vscode.TextDocument) {
    if (!isReady) return;

    if (!SUPPORTED_LANGUAGES.has(document.languageId)) return;
    if (document.uri.scheme !== "file") return;

    const key = document.uri.toString();

    const existing = debounceTimers.get(key);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      key,
      setTimeout(() => runAnalysis(document), 500),
    );
  }

  // ─────────────────────────────────────────────
  // ANALYSIS PIPELINE
  // ─────────────────────────────────────────────

  async function runAnalysis(document: vscode.TextDocument) {
    const key = document.uri.toString();

    const prev = cancelTokens.get(key);
    if (prev) prev.cancel();

    const tokenSource = new vscode.CancellationTokenSource();
    cancelTokens.set(key, tokenSource);

    try {
      const [engineModule, ruleEngine] = await Promise.all([
        getAnalyzer(),
        getRuleEngine(),
      ]);

      const analyzeFile = engineModule.analyzeFile;

      const analysis = await analyzeFile(document.fileName, {
        fileContent: document.getText(),
      });

      if (tokenSource.token.isCancellationRequested) return;

      const results: RuleDiagnostic[] = ruleEngine.run({
        analyses: [analysis],
        graph: null,
        nodes: new Map(),
        edges: [],
      });

      documentDiagnostics.set(key, results);

      const vscodeDiags = results.map((d: RuleDiagnostic) => {
        const rawLine = (d.line ?? 1) - 1;
        const safeLine = Math.max(0, Math.min(rawLine, document.lineCount - 1));

        const lineText = document.lineAt(safeLine)?.text ?? "";

        const startColumn =
          typeof (d as any).column === "number"
            ? Math.max(0, (d as any).column)
            : 0;

        const endColumn =
          typeof (d as any).endColumn === "number"
            ? Math.max(startColumn + 1, (d as any).endColumn)
            : Math.min(startColumn + 1, lineText.length || 1);

        const safeEndColumn = Math.min(endColumn, lineText.length || 1);

        const range =
          lineText.length > 0
            ? new vscode.Range(safeLine, startColumn, safeLine, safeEndColumn)
            : new vscode.Range(safeLine, 0, safeLine, 1);

        let severity = vscode.DiagnosticSeverity.Warning;

        switch (String(d.severity).toLowerCase()) {
          case "error":
            severity = vscode.DiagnosticSeverity.Error;
            break;
          case "info":
          case "information":
            severity = vscode.DiagnosticSeverity.Information;
            break;
          case "hint":
            severity = vscode.DiagnosticSeverity.Hint;
            break;
        }

        const diag = new vscode.Diagnostic(range, d.message, severity);

        diag.code = d.ruleId;
        diag.source = "NextIntel";

        return diag;
      });

      // 🔥 ALWAYS set diagnostics (never skip)
      diagnostics.set(document.uri, vscodeDiags);
    } catch (err) {
      output.appendLine(`❌ Analysis failed: ${String(err)}`);
      console.error(err);
    } finally {
      cancelTokens.delete(key);
    }
  }

  // ─────────────────────────────────────────────
  // EVENTS
  // ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),

    vscode.workspace.onDidSaveTextDocument((doc) => schedule(doc)),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) schedule(editor.document);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();

      documentDiagnostics.delete(key);
      diagnostics.delete(doc.uri);

      const timer = debounceTimers.get(key);
      if (timer) clearTimeout(timer);

      const token = cancelTokens.get(key);
      if (token) token.cancel();
    }),

    {
      dispose: () => {
        rulesLoaded = false;
        isReady = false;
      },
    },
  );
}

export function deactivate() {}
