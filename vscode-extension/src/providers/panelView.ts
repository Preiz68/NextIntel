import { Diagnostic as RuleDiagnostic } from "rules";
import { parseExample } from "./exampleParser";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function severityClass(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "error") return "error";
  if (s === "warning") return "warning";
  return "info";
}

function severityIcon(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "error") return "🔴";
  if (s === "warning") return "🟡";
  return "🔵";
}

function severityLabel(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "error") return "Error";
  if (s === "warning") return "Warning";
  if (s === "info" || s === "information") return "Info";
  return "Hint";
}

function listItems(items: string[], cls: string, bullet: string): string {
  if (!items?.length) return "";
  return items
    .map((item) => `<li class="${cls}"><span class="bullet">${bullet}</span>${esc(item)}</li>`)
    .join("");
}

function codeBlock(code: string, label: string, variant: "bad" | "good"): string {
  const icon = variant === "bad" ? "✕" : "✓";
  const cls = variant === "bad" ? "code-bad" : "code-good";
  return `
    <div class="code-example ${cls}">
      <div class="code-label"><span class="code-label-icon">${icon}</span>${label}</div>
      <pre><code>${esc(code)}</code></pre>
    </div>`;
}

function exampleBlock(code: string, label: string, variant: "bad" | "good"): string {
  const parsed = parseExample(code);
  const icon = variant === "bad" ? "✕" : "✓";
  const cls = variant === "bad" ? "code-bad" : "code-good";
  
  let html = `
    <div class="example-group ${cls}">
      <div class="example-header"><span class="example-header-icon">${icon}</span>${label}</div>`;
  
  if (parsed.description) {
    html += `
      <div class="example-description">${esc(parsed.description)}</div>`;
  }
  
  for (const file of parsed.files) {
    html += `
      <div class="code-example-item">`;
    if (file.filename) {
      html += `
        <div class="code-filename">📄 ${esc(file.filename)}</div>`;
    }
    html += `
        <pre><code>${esc(file.code)}</code></pre>
      </div>`;
  }
  
  html += `
    </div>`;
  return html;
}

// ─── Card builder ─────────────────────────────────────────────────────────────

function buildDiagCard(d: RuleDiagnostic, idx: number): string {
  const sev = String(d.severity).toLowerCase();
  const cls = severityClass(sev);
  const fixes = d.quickFixes?.length ? d.quickFixes : d.fix ? [d.fix] : [];

  const sections: string[] = [];

  // Why it matters
  if (d.whyItMatters) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">💡</span>
          <span class="section-title">Why It Matters</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body open">
          <p>${esc(d.whyItMatters)}</p>
        </div>
      </div>`);
  }

  // Quick fixes
  if (fixes.length) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">🔧</span>
          <span class="section-title">Quick Fixes</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body open">
          <ul class="item-list">${listItems(fixes, "fix-item", "✓")}</ul>
        </div>
      </div>`);
  }

  // Safe refactor
  if (d.safeRefactorSuggestion) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">🔁</span>
          <span class="section-title">Refactor Preview</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body open">
          ${codeBlock(d.safeRefactorSuggestion, "Suggested refactor", "good")}
        </div>
      </div>`);
  }

  // Optimization
  if (d.optimizationGuidance?.length) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">🚀</span>
          <span class="section-title">Optimization</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body">
          <ul class="item-list">${listItems(d.optimizationGuidance, "opt-item", "→")}</ul>
        </div>
      </div>`);
  }

  // Architecture
  if (d.architectureSuggestions?.length) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">🏗</span>
          <span class="section-title">Architecture</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body">
          <ul class="item-list">${listItems(d.architectureSuggestions, "arch-item", "◆")}</ul>
        </div>
      </div>`);
  }

  // Production risks
  if (d.productionRisks?.length) {
    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">⚠️</span>
          <span class="section-title">Production Risks</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body">
          <ul class="item-list">${listItems(d.productionRisks, "risk-item", "!")}</ul>
        </div>
      </div>`);
  }

  // Code examples
  if (d.examples?.invalid?.length || d.examples?.valid?.length) {
    const invalidBlocks = (d.examples.invalid || [])
      .map((code, idx) => {
        const label = d.examples!.invalid!.length > 1 ? `Avoid (Example ${idx + 1})` : "Avoid";
        return exampleBlock(code, label, "bad");
      })
      .join("");
    const validBlocks = (d.examples.valid || [])
      .map((code, idx) => {
        const label = d.examples!.valid!.length > 1 ? `Prefer (Example ${idx + 1})` : "Prefer";
        return exampleBlock(code, label, "good");
      })
      .join("");
    const examplesHtml = invalidBlocks + validBlocks;

    sections.push(`
      <div class="section">
        <div class="section-header" onclick="toggleSection(this)">
          <span class="section-icon">📖</span>
          <span class="section-title">Code Examples</span>
          <span class="chevron">›</span>
        </div>
        <div class="section-body open">${examplesHtml}</div>
      </div>`);
  }

  const guardedBadge = d.isGuarded
    ? `<span class="badge guarded">🛡 Guarded</span>`
    : "";

  return `
    <div class="diag-card" style="animation-delay: ${idx * 60}ms">
      <div class="card-header ${cls}">
        <div class="card-header-top">
          <div class="card-identity">
            <span class="sev-icon">${severityIcon(sev)}</span>
            <span class="sev-label badge ${cls}">${severityLabel(sev)}</span>
            <span class="constraint-id">${esc(d.id)}</span>
            ${guardedBadge}
          </div>
          <span class="rule-chip">${esc(d.ruleId)}</span>
        </div>
        <div class="card-message">${esc(d.message)}</div>
      </div>
      <div class="card-sections">${sections.join("")}</div>
    </div>`;
}

// ─── Full panel HTML ──────────────────────────────────────────────────────────

export function buildPanelHtml(
  diags: RuleDiagnostic[],
  filePath: string,
  line: number
): string {
  const cards = diags.map((d, i) => buildDiagCard(d, i)).join("");
  const errorCount = diags.filter(
    (d) => String(d.severity).toLowerCase() === "error"
  ).length;
  const warnCount = diags.filter(
    (d) => String(d.severity).toLowerCase() === "warning"
  ).length;
  const infoCount = diags.length - errorCount - warnCount;

  const summaryParts: string[] = [];
  if (errorCount) summaryParts.push(`<span class="badge error">🔴 ${errorCount} error${errorCount !== 1 ? "s" : ""}</span>`);
  if (warnCount) summaryParts.push(`<span class="badge warning">🟡 ${warnCount} warning${warnCount !== 1 ? "s" : ""}</span>`);
  if (infoCount) summaryParts.push(`<span class="badge info">🔵 ${infoCount} suggestion${infoCount !== 1 ? "s" : ""}</span>`);

  const shortFile = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>NextIntel — Analysis</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --surface2: #1c2128;
      --border: rgba(255,255,255,0.08);
      --border-hover: rgba(255,255,255,0.16);
      --text: #e2e8f0;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --red: #f85149;
      --red-dim: rgba(248,81,73,0.15);
      --yellow: #e3b341;
      --yellow-dim: rgba(227,179,65,0.12);
      --blue: #58a6ff;
      --blue-dim: rgba(88,166,255,0.12);
      --green: #3fb950;
      --green-dim: rgba(63,185,80,0.12);
      --radius: 8px;
      --font-mono: 'Consolas', 'SF Mono', 'Monaco', monospace;
    }

    body {
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ── Top header bar ──────────────────────────────────── */
    .top-bar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: linear-gradient(135deg, #0d1117 0%, #161b22 100%);
      border-bottom: 1px solid var(--border);
      padding: 14px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      backdrop-filter: blur(8px);
    }

    .logo {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }

    .brand {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.3px;
      color: var(--text);
      flex: 1;
    }

    .brand span { color: var(--accent); }

    .summary-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    /* ── File info bar ───────────────────────────────────── */
    .file-bar {
      padding: 7px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .file-bar .file-icon { opacity: 0.6; }
    .file-bar .file-name { color: var(--accent); }
    .file-bar .line-num {
      background: var(--surface2);
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    /* ── Cards container ─────────────────────────────────── */
    .cards {
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    /* ── Diagnostic card ─────────────────────────────────── */
    .diag-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--surface);
      opacity: 0;
      transform: translateY(10px);
      animation: slideIn 0.3s ease forwards;
      transition: border-color 0.2s;
    }

    .diag-card:hover { border-color: var(--border-hover); }

    @keyframes slideIn {
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Card header ─────────────────────────────────────── */
    .card-header {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border);
    }

    .card-header.error  { border-left: 3px solid var(--red); }
    .card-header.warning { border-left: 3px solid var(--yellow); }
    .card-header.info   { border-left: 3px solid var(--blue); }

    .card-header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }

    .card-identity {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .sev-icon { font-size: 14px; line-height: 1; }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      border: 1px solid transparent;
    }

    .badge.error   { background: var(--red-dim);    color: var(--red);    border-color: rgba(248,81,73,0.25); }
    .badge.warning { background: var(--yellow-dim); color: var(--yellow); border-color: rgba(227,179,65,0.25); }
    .badge.info    { background: var(--blue-dim);   color: var(--blue);   border-color: rgba(88,166,255,0.25); }
    .badge.guarded { background: var(--green-dim);  color: var(--green);  border-color: rgba(63,185,80,0.25); }

    .constraint-id {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      background: var(--surface2);
      padding: 2px 7px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }

    .rule-chip {
      font-family: var(--font-mono);
      font-size: 10px;
      color: var(--text-muted);
      padding: 2px 6px;
      background: var(--surface2);
      border-radius: 4px;
      border: 1px solid var(--border);
      white-space: nowrap;
    }

    .card-message {
      font-size: 13px;
      font-weight: 500;
      color: var(--text);
      line-height: 1.5;
    }

    /* ── Sections ────────────────────────────────────────── */
    .card-sections { background: var(--surface); }

    .section {
      border-bottom: 1px solid var(--border);
    }

    .section:last-child { border-bottom: none; }

    .section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 16px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }

    .section-header:hover { background: rgba(255,255,255,0.03); }

    .section-icon { font-size: 13px; line-height: 1; flex-shrink: 0; }

    .section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      flex: 1;
    }

    .chevron {
      color: var(--text-muted);
      font-size: 16px;
      line-height: 1;
      transition: transform 0.2s;
      display: inline-block;
    }

    .section-header.collapsed .chevron { transform: rotate(-90deg); }

    .section-body {
      padding: 0 16px 12px;
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.65;
      display: none;
    }

    .section-body.open { display: block; }

    .section-body p { margin-bottom: 4px; }

    /* ── Lists ───────────────────────────────────────────── */
    .item-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-top: 2px;
    }

    .item-list li {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .bullet {
      flex-shrink: 0;
      font-size: 11px;
      margin-top: 3px;
      width: 14px;
    }

    .fix-item .bullet   { color: var(--green); }
    .opt-item .bullet   { color: var(--accent); }
    .arch-item .bullet  { color: #d2a8ff; }
    .risk-item .bullet  { color: var(--red); font-weight: bold; }

    /* ── Code blocks ─────────────────────────────────────── */
    .code-example {
      margin: 6px 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
    }

    .code-label {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }

    .code-label-icon { font-size: 12px; }

    .code-bad .code-label  { background: var(--red-dim); color: var(--red); }
    .code-good .code-label { background: var(--green-dim); color: var(--green); }

    /* ── Structured Examples ─────────────────────────────── */
    .example-group {
      margin: 14px 0;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border);
      background: rgba(0, 0, 0, 0.1);
    }

    .example-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    
    .example-header-icon {
      font-size: 12px;
      margin-right: 2px;
    }

    .example-group.code-bad { border-color: rgba(248,81,73,0.3); }
    .example-group.code-bad .example-header { background: var(--red-dim); color: var(--red); }
    
    .example-group.code-good { border-color: rgba(63,185,80,0.3); }
    .example-group.code-good .example-header { background: var(--green-dim); color: var(--green); }

    .example-description {
      padding: 10px 12px;
      font-size: 12px;
      color: var(--text-muted);
      font-style: italic;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.02);
      line-height: 1.5;
    }

    .code-example-item {
      border-bottom: 1px solid var(--border);
    }

    .code-example-item:last-child {
      border-bottom: none;
    }

    .code-filename {
      font-family: var(--font-mono);
      font-size: 11px;
      color: var(--text-muted);
      background: rgba(255, 255, 255, 0.04);
      padding: 4px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    }

    pre {
      padding: 10px 12px;
      background: rgba(0,0,0,0.25);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text);
      white-space: pre-wrap;
      word-wrap: break-word;
    }

    /* ── Empty state ─────────────────────────────────────── */
    .empty {
      padding: 60px 20px;
      text-align: center;
      color: var(--text-muted);
    }

    .empty-icon { font-size: 40px; margin-bottom: 12px; }
    .empty-title { font-size: 16px; font-weight: 600; color: var(--text); margin-bottom: 6px; }

    /* ── Scrollbar ───────────────────────────────────────── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.22); }
  </style>
</head>
<body>

  <header class="top-bar">
    <div class="logo">
      <svg viewBox="0 0 180 180" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="90" cy="90" r="88" fill="var(--bg)" stroke="var(--border)" stroke-width="4"/>
        <path d="M149.508 157.52L69.142 54H54v72h12.142V67.859l66.906 86.29a89.379 89.379 0 0016.46-16.629z" fill="var(--text)"/>
        <rect x="115" y="54" width="12" height="72" fill="url(#paint0_linear_logo)"/>
        <defs>
          <linearGradient id="paint0_linear_logo" x1="121" y1="54" x2="121" y2="126" gradientUnits="userSpaceOnUse">
            <stop stop-color="var(--text)"/>
            <stop offset="1" stop-color="var(--bg)" stop-opacity="0"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
    <div class="brand">Next<span>Intel</span></div>
    <div class="summary-chips">${summaryParts.join("")}</div>
  </header>

  <div class="file-bar">
    <span class="file-icon">📄</span>
    <span class="file-name">${esc(shortFile)}</span>
    <span>·</span>
    <span class="line-num">Line ${line + 1}</span>
  </div>

  <div class="cards">
    ${cards || `
      <div class="empty">
        <div class="empty-icon">✅</div>
        <div class="empty-title">No issues on this line</div>
        <p>NextIntel found no violations here.</p>
      </div>`}
  </div>

  <script>
    function toggleSection(header) {
      header.classList.toggle('collapsed');
      const body = header.nextElementSibling;
      body.classList.toggle('open');
    }
  </script>
</body>
</html>`;
}
