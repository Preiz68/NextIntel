import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { Diagnostic as RuleDiagnostic } from "rules";
import { NextIntelHoverProvider } from "./providers/hoverProvider";
import { NextIntelCodeLensProvider } from "./providers/codeLensProvider";
import { buildPanelHtml } from "./providers/panelView";

// ─────────────────────────────────────────────
// NEXT.JS PROJECT DETECTION
// ─────────────────────────────────────────────

const isNextJsCache = new Map<string, boolean>();

function isNextJsWorkspace(document: vscode.TextDocument): boolean {
  const uri = document.uri;
  if (uri.scheme !== "file") return false;

  const dir = path.dirname(uri.fsPath);
  if (isNextJsCache.has(dir)) {
    return isNextJsCache.get(dir)!;
  }

  const result = checkIsNextJsWorkspace(document);
  isNextJsCache.set(dir, result);
  return result;
}

function checkIsNextJsWorkspace(document: vscode.TextDocument): boolean {
  try {
    const uri = document.uri;
    let dir = path.dirname(uri.fsPath);
    const root = path.parse(dir).root;

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const stopDir = folder ? path.dirname(folder.uri.fsPath) : root;

    while (dir && dir !== stopDir && dir !== root) {
      const configNames = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.jsx", "next.config.tsx"];
      for (const name of configNames) {
        if (fs.existsSync(path.join(dir, name))) {
          return true;
        }
      }

      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        try {
          const content = fs.readFileSync(pkgPath, "utf8");
          const pkg = JSON.parse(content);
          if (pkg.dependencies?.next || pkg.devDependencies?.next) {
            return true;
          }
        } catch {
          // ignore parsing error
        }
      }

      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch (e) {
    console.error("Error checking for Next.js workspace:", e);
  }
  return false;
}

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const SUPPORTED_LANGUAGES = new Set([
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
]);

const LANGUAGE_SELECTORS = [...SUPPORTED_LANGUAGES].map((lang) => ({
  language: lang,
  scheme: "file",
}));

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

function getRuleBehavior(ruleId: string | number | undefined) {
  return RULE_BEHAVIORS[String(ruleId)];
}

// ─────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────

let ruleEngine: any;
let rulesLoaded = false;
let isReady = false;

/** Rich rule diagnostics per document — shared with providers by reference. */
const documentDiagnostics = new Map<string, RuleDiagnostic[]>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const cancelTokens = new Map<string, vscode.CancellationTokenSource>();

let diagnostics: vscode.DiagnosticCollection;

// Workspace Cache State for Progressive Analysis
const cachedAnalyses = new Map<string, any>(); // filePath -> SemanticFileAnalysis
let cachedGraphResult: any = null; // BuildGraphResult
let workspaceRoot: string | null = null;
let isWorkspaceScanned = false;

// ─────────────────────────────────────────────
// LAZY ENGINE INIT
// ─────────────────────────────────────────────

async function getRuleEngine() {
  if (rulesLoaded) return ruleEngine;
  const { RuleEngine, rules } = await import("rules");
  ruleEngine = new RuleEngine();
  for (const rule of rules) ruleEngine.registerRule(rule);
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
  console.log("NextIntel activated");

  let lastEditorChangeTime = Date.now();

  diagnostics = vscode.languages.createDiagnosticCollection("nextintel");
  context.subscriptions.push(diagnostics);

  const output = vscode.window.createOutputChannel("NextIntel");
  output.appendLine("🚀 NextIntel running");

  // ─────────────────────────────────────────────
  // PROVIDERS
  // ─────────────────────────────────────────────

  const hoverProvider = new NextIntelHoverProvider(
    documentDiagnostics,
    () => (Date.now() - lastEditorChangeTime) > 500
  );
  const codeLensProvider = new NextIntelCodeLensProvider(documentDiagnostics);

  interface NextIntelTerminalLink extends vscode.TerminalLink {
    filePath: string;
    line: number;
  }

  const terminalLinkProvider = vscode.window.registerTerminalLinkProvider({
    provideTerminalLinks(context: vscode.TerminalLinkContext, _token: vscode.CancellationToken) {
      const links: NextIntelTerminalLink[] = [];
      const regex = /((?:[a-zA-Z]:[\\/]|[\\/])[^:?\r\n]+?):(\d+)/g;
      let match;
      while ((match = regex.exec(context.line)) !== null) {
        const filePath = match[1]!;
        const lineStr = match[2]!;
        const line = parseInt(lineStr, 10);
        
        links.push({
          startIndex: match.index,
          length: match[0].length,
          tooltip: "NextIntel: Open Details Panel",
          filePath,
          line,
        });
      }
      return links;
    },
    async handleTerminalLink(link: NextIntelTerminalLink) {
      try {
        const uri = vscode.Uri.file(link.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.One,
          preserveFocus: false,
        });
        
        const pos = new vscode.Position(link.line - 1, 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

        // Ensure analysis has run so that diagnostics are populated
        await runAnalysis(doc);

        const key = doc.uri.toString();
        const allDiags = documentDiagnostics.get(key) ?? [];
        const lineDiags = allDiags.filter((d) => (d.line ?? 1) === link.line);

        vscode.commands.executeCommand("next-intel.showPanel", key, link.line - 1, lineDiags, false);
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to open link: ${e}`);
      }
    }
  });

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(LANGUAGE_SELECTORS, hoverProvider),
    vscode.languages.registerCodeLensProvider(
      LANGUAGE_SELECTORS,
      codeLensProvider,
    ),
    terminalLinkProvider,
  );

  // ─────────────────────────────────────────────
  // INLINE DECORATIONS (end-of-line badges)
  // ─────────────────────────────────────────────

  const inlineDeco = vscode.window.createTextEditorDecorationType({
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    after: { margin: "0 0 0 3ch", fontStyle: "italic" },
  });
  context.subscriptions.push(inlineDeco);

  function updateDecorations(document: vscode.TextDocument) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === document.uri.toString(),
    );
    if (!editor) return;

    const allDiags = documentDiagnostics.get(document.uri.toString()) ?? [];
    if (allDiags.length === 0) {
      editor.setDecorations(inlineDeco, []);
      return;
    }

    // One badge per line — pick most severe
    const byLine = new Map<number, RuleDiagnostic>();
    for (const d of allDiags) {
      const line = Math.max(0, (d.line ?? 1) - 1);
      const existing = byLine.get(line);
      if (!existing) {
        byLine.set(line, d);
      } else {
        const rank = (s: string) =>
          s === "error" ? 0 : s === "warning" ? 1 : 2;
        if (rank(String(d.severity)) < rank(String(existing.severity))) {
          byLine.set(line, d);
        }
      }
    }

    const decoOpts: vscode.DecorationOptions[] = [];
    for (const [line, d] of byLine) {
      if (line >= document.lineCount) continue;
      const lineText = document.lineAt(line).text;
      const sev = String(d.severity).toLowerCase();
      const color =
        sev === "error"
          ? "rgba(248,81,73,0.55)"
          : sev === "warning"
            ? "rgba(227,179,65,0.5)"
            : "rgba(88,166,255,0.45)";
      const bullet = sev === "error" ? "⬤" : sev === "warning" ? "⬤" : "⬤";

      decoOpts.push({
        range: new vscode.Range(line, lineText.length, line, lineText.length),
        renderOptions: {
          after: {
            contentText: `  ${bullet} ${d.id}`,
            color,
          },
        },
      });
    }

    editor.setDecorations(inlineDeco, decoOpts);
  }

  // ─────────────────────────────────────────────
  // CODE ACTIONS (lightbulb quick-fixes)
  // ─────────────────────────────────────────────

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      LANGUAGE_SELECTORS,
      {
        provideCodeActions(document, _range, ctx) {
          const actions: vscode.CodeAction[] = [];
          for (const vsdiag of ctx.diagnostics) {
            if (vsdiag.source !== "NextIntel") continue;
            const ruleId = String(vsdiag.code);
            const behavior = getRuleBehavior(ruleId);
            if (!behavior?.autoFix) continue;
            const edit = behavior.autoFix(document);
            if (!edit) continue;
            const action = new vscode.CodeAction(
              `⚡ NextIntel: Apply fix for '${ruleId}'`,
              vscode.CodeActionKind.QuickFix,
            );
            action.edit = edit;
            action.diagnostics = [vsdiag];
            action.isPreferred = true;
            actions.push(action);
          }
          return actions;
        },
      },
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
  );

  // ─────────────────────────────────────────────
  // PANEL COMMAND  (CodeLens click → WebView)
  // ─────────────────────────────────────────────

  let panel: vscode.WebviewPanel | undefined;
  let panelColumn: vscode.ViewColumn | undefined;
  let tabGuardDisposable: vscode.Disposable | undefined;

  /**
   * Watches for any non-webview tab opening in the same column as the panel
   * and immediately moves it to ViewColumn.One so the panel column stays
   * exclusively reserved for the NextIntel details view.
   */
  function installTabGuard() {
    tabGuardDisposable?.dispose();
    tabGuardDisposable = vscode.window.tabGroups.onDidChangeTabs(async (e) => {
      if (!panel || panelColumn === undefined) return;

      for (const tab of e.opened) {
        // Only intercept regular file/text tabs (not the webview itself)
        if (!(tab.input instanceof vscode.TabInputText)) continue;

        // Check if this tab lives in the same view column as our panel
        const tabCol = tab.group.viewColumn as vscode.ViewColumn;
        if (tabCol !== panelColumn) continue;

        // It's a file tab in the panel's column — evict it.
        const fileUri = (tab.input as vscode.TabInputText).uri;
        try {
          // Close the tab in the panel column first
          await vscode.window.tabGroups.close(tab, true);
          // Re-open it in column 1 so the user doesn't lose their file
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false,
          });
        } catch {
          // Silently ignore — the tab may have already been closed
        }
      }
    });
    context.subscriptions.push(tabGuardDisposable);
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "next-intel.showPanel",
      (docUri: string, line: number, diags: RuleDiagnostic[], onlyIfOpen?: boolean) => {
        if (onlyIfOpen && !panel) {
          return;
        }

        if (panel) {
          panel.reveal(vscode.ViewColumn.Beside, true);
        } else {
          panel = vscode.window.createWebviewPanel(
            "nextintel.details",
            "NextIntel — Details",
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            { enableScripts: true, retainContextWhenHidden: true },
          );

          // Track which column the panel lives in
          panelColumn = panel.viewColumn ?? vscode.ViewColumn.Beside;

          // Keep the tracked column updated if the user moves the panel
          panel.onDidChangeViewState(
            (e) => {
              panelColumn = e.webviewPanel.viewColumn ?? panelColumn;
            },
            null,
            context.subscriptions,
          );

          panel.onDidDispose(
            () => {
              panel = undefined;
              panelColumn = undefined;
              tabGuardDisposable?.dispose();
              tabGuardDisposable = undefined;
            },
            null,
            context.subscriptions,
          );

          // Start guarding the panel column immediately
          installTabGuard();
        }

        panel.iconPath = vscode.Uri.parse(
          "data:image/svg+xml," +
            encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <text y="14" font-size="14">⚡</text>
          </svg>`),
        );

        panel.webview.html = buildPanelHtml(diags, docUri, line);
        panel.title = `NextIntel — Line ${line + 1}`;
      },
    ),
  );

  // ─────────────────────────────────────────────
  // SAFE SCHEDULER
  // ─────────────────────────────────────────────

  function schedule(document: vscode.TextDocument) {
    if (!isReady) return;
    if (!SUPPORTED_LANGUAGES.has(document.languageId)) return;
    if (document.uri.scheme !== "file") return;
    if (!isNextJsWorkspace(document)) return;

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

  function isWorkspaceNextJs(root: string): boolean {
    const configNames = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.jsx", "next.config.tsx"];
    for (const name of configNames) {
      if (fs.existsSync(path.join(root, name))) {
        return true;
      }
    }
    const pkgPath = path.join(root, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, "utf8");
        const pkg = JSON.parse(content);
        if (pkg.dependencies?.next || pkg.devDependencies?.next) {
          return true;
        }
      } catch {
        // ignore
      }
    }
    return false;
  }

  async function triggerWorkspaceScan() {
    if (isWorkspaceScanned) return;
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) return;
    
    workspaceRoot = folders[0]!.uri.fsPath;
    if (!isWorkspaceNextJs(workspaceRoot)) {
      output.appendLine(`ℹ️ Workspace at ${workspaceRoot} is not a Next.js project. Skipping scan.`);
      return;
    }

    isWorkspaceScanned = true;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Window,
      title: "NextIntel: Indexing Next.js project...",
      cancellable: false
    }, async () => {
      try {
        const [engineModule, re] = await Promise.all([
          getAnalyzer(),
          getRuleEngine(),
        ]);

        output.appendLine(`📂 Starting workspace scan at: ${workspaceRoot}`);
        const { files } = await engineModule.scanProject(workspaceRoot!, { scanRootFallback: true });
        output.appendLine(`📂 Found ${files.length} candidate files in workspace.`);
        
        const analyses = await engineModule.analyzeFiles(files);
        
        for (const analysis of analyses) {
          cachedAnalyses.set(analysis.filePath, analysis);
        }

        cachedGraphResult = engineModule.buildGraph(analyses, workspaceRoot!);
        output.appendLine(`✅ Initialized dependency graph with ${cachedGraphResult.nodes.size} nodes.`);

        const results = re.run({
          analyses: [...cachedAnalyses.values()],
          graph: cachedGraphResult.graph,
          nodes: cachedGraphResult.nodes,
          edges: cachedGraphResult.edges,
        });

        output.appendLine(`✅ Initial scan found ${results.length} diagnostics project-wide.`);
        updateWorkspaceDiagnostics(results);

      } catch (err) {
        output.appendLine(`❌ Initial workspace scan failed: ${String(err)}`);
        console.error(err);
      }
    });
  }

  function updateWorkspaceDiagnostics(results: RuleDiagnostic[]) {
    const diagsByFile = new Map<string, RuleDiagnostic[]>();
    for (const d of results) {
      if (!d.file) continue;
      const normalizedPath = d.file.replace(/\\/g, "/");
      if (!diagsByFile.has(normalizedPath)) {
        diagsByFile.set(normalizedPath, []);
      }
      diagsByFile.get(normalizedPath)!.push(d);
    }

    const filesToClear = new Set(documentDiagnostics.keys());

    for (const [filePath, fileDiags] of diagsByFile.entries()) {
      const uri = vscode.Uri.file(filePath);
      const key = uri.toString();
      
      filesToClear.delete(key);
      documentDiagnostics.set(key, fileDiags);

      const vscodeDiags = fileDiags.map((d) => {
        let parsedLine = typeof d.line === "number" ? d.line : parseInt(d.line as any, 10);
        if (isNaN(parsedLine)) parsedLine = 1;
        const rawLine = parsedLine - 1;
        
        const openDoc = vscode.workspace.textDocuments.find(doc => doc.uri.toString().toLowerCase() === key.toLowerCase());
        const lineText = openDoc && rawLine < openDoc.lineCount ? openDoc.lineAt(rawLine).text : "";
        
        let range: vscode.Range;
        if (lineText.length === 0) {
          range = new vscode.Range(rawLine, 0, rawLine, 100);
        } else {
          range = new vscode.Range(rawLine, 0, rawLine, lineText.length);
        }

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

      diagnostics.set(uri, vscodeDiags);
    }

    for (const key of filesToClear) {
      documentDiagnostics.delete(key);
      const uri = vscode.Uri.parse(key);
      diagnostics.delete(uri);
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
      updateDecorations(activeEditor.document);
    }
    codeLensProvider.refresh();
  }

  async function triggerIncrementalAnalysis() {
    if (!isWorkspaceScanned) return;
    try {
      const [engineModule, re] = await Promise.all([
        getAnalyzer(),
        getRuleEngine(),
      ]);

      if (!workspaceRoot) {
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders.length > 0) {
          workspaceRoot = folders[0]!.uri.fsPath;
        }
      }

      cachedGraphResult = engineModule.buildGraph([...cachedAnalyses.values()], workspaceRoot ?? "");
      
      const results = re.run({
        analyses: [...cachedAnalyses.values()],
        graph: cachedGraphResult.graph,
        nodes: cachedGraphResult.nodes,
        edges: cachedGraphResult.edges,
      });

      updateWorkspaceDiagnostics(results);
    } catch (err) {
      output.appendLine(`❌ Incremental analysis failed: ${String(err)}`);
    }
  }

  async function runAnalysis(document: vscode.TextDocument) {
    const key = document.uri.toString();
    if (!isNextJsWorkspace(document)) {
      if (documentDiagnostics.has(key)) {
        documentDiagnostics.delete(key);
        diagnostics.delete(document.uri);
        updateDecorations(document);
      }
      return;
    }

    if (!isWorkspaceScanned) {
      await triggerWorkspaceScan();
    }

    output.appendLine(`🔍 Running progressive analysis on: ${document.fileName}`);

    const prev = cancelTokens.get(key);
    if (prev) prev.cancel();

    const tokenSource = new vscode.CancellationTokenSource();
    cancelTokens.set(key, tokenSource);

    try {
      const [engineModule, re] = await Promise.all([
        getAnalyzer(),
        getRuleEngine(),
      ]);

      const analysis = await engineModule.analyzeFile(document.fileName, {
        fileContent: document.getText(),
      });

      if (tokenSource.token.isCancellationRequested) return;

      cachedAnalyses.set(analysis.filePath, analysis);

      cachedGraphResult = engineModule.buildGraph([...cachedAnalyses.values()], workspaceRoot ?? "");

      const results = re.run({
        analyses: [...cachedAnalyses.values()],
        graph: cachedGraphResult.graph,
        nodes: cachedGraphResult.nodes,
        edges: cachedGraphResult.edges,
      });

      output.appendLine(`✅ Found ${results.length} diagnostics total`);
      updateWorkspaceDiagnostics(results);

    } catch (err) {
      output.appendLine(`❌ Progressive analysis failed: ${String(err)}`);
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

    vscode.workspace.onDidSaveTextDocument((doc) => {
      const filename = path.basename(doc.fileName);
      if (filename === "package.json" || filename.startsWith("next.config.")) {
        isNextJsCache.clear();
      }
      schedule(doc);
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      lastEditorChangeTime = Date.now();
      if (editor) {
        schedule(editor.document);
        updateDecorations(editor.document);
      }
    }),

    vscode.window.onDidChangeTextEditorSelection((e) => {
      const editor = e.textEditor;
      if (!editor || !SUPPORTED_LANGUAGES.has(editor.document.languageId)) return;

      const key = editor.document.uri.toString();
      const allDiags = documentDiagnostics.get(key);
      if (!allDiags || allDiags.length === 0) return;

      const firstSelection = e.selections?.[0];
      if (!firstSelection) return;
      const line = firstSelection.active.line;
      const hoveredLine = line + 1;
      const matching = allDiags.filter((d) => (d.line ?? 1) === hoveredLine);
      if (matching.length === 0) return;

      const shouldOpenOrUpdate = panel !== undefined || e.kind === vscode.TextEditorSelectionChangeKind.Command;
      if (shouldOpenOrUpdate) {
        vscode.commands.executeCommand("next-intel.showPanel", key, line, matching);
      }
    }),

    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) updateDecorations(editor.document);
    }),

    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      // Keep diagnostics in memory so they persist even when the file is closed!
      // documentDiagnostics.delete(key);
      // diagnostics.delete(doc.uri);
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

  // File system watchers to keep cache in sync
  const fileWatcher = vscode.workspace.createFileSystemWatcher("**/*.{ts,tsx,js,jsx}");
  
  fileWatcher.onDidCreate(async (uri) => {
    try {
      const engineModule = await getAnalyzer();
      const filePath = engineModule.normalizePath(uri.fsPath);
      const analysis = await engineModule.analyzeFile(uri.fsPath);
      cachedAnalyses.set(filePath, analysis);
      triggerIncrementalAnalysis();
    } catch (err) {
      output.appendLine(`❌ Error handling file creation: ${String(err)}`);
    }
  });

  fileWatcher.onDidDelete((uri) => {
    try {
      const filePath = uri.fsPath.replace(/\\/g, "/");
      let foundKey = "";
      for (const k of cachedAnalyses.keys()) {
        if (k.toLowerCase() === filePath.toLowerCase().replace(/\\/g, "/")) {
          foundKey = k;
          break;
        }
      }
      if (foundKey) {
        cachedAnalyses.delete(foundKey);
        triggerIncrementalAnalysis();
      }
    } catch (err) {
      output.appendLine(`❌ Error handling file deletion: ${String(err)}`);
    }
  });

  context.subscriptions.push(fileWatcher);

  // ─────────────────────────────────────────────
  // READY GATE
  // ─────────────────────────────────────────────

  const readyTimer = setTimeout(async () => {
    isReady = true;
    await triggerWorkspaceScan();
    for (const doc of vscode.workspace.textDocuments) {
      if (
        SUPPORTED_LANGUAGES.has(doc.languageId) &&
        doc.uri.scheme === "file"
      ) {
        schedule(doc);
      }
    }
  }, 1000);

  context.subscriptions.push({ dispose: () => clearTimeout(readyTimer) });
}

export function deactivate() {}
