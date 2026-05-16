# 🚀 NextIntel: Next.js Intelligence Engine

**NextIntel** is a high-performance static analysis extension for VS Code, specifically architected for the **Next.js App Router**. It scans your codebase in real-time to ensure your application follows best practices for architecture, performance, and the React Server Components (RSC) paradigm.

---

## ✨ Features

### 🧠 Real-Time Intelligence
*   **RSC Boundary Guard**: Automatically detects when you're accidentally using Browser APIs (`window`, `localStorage`) or React Hooks (`useState`, `useEffect`) inside Server Components.
*   **Live Diagnostics**: Get immediate feedback via red squiggles as you save or switch files.
*   **Smart Quick-Fixes**: When a boundary violation is detected, a 💡 lightbulb appears. One click adds the `"use client";` directive to the top of your file.

### ⚡ Performance-First Design
*   **Debounced Scanning**: Intelligent analysis that waits for you to finish typing/saving before running, keeping your editor responsive.
*   **AST-Powered**: Uses a custom-built, deep-analysis engine (powered by `ts-morph`) that understands your code structure better than a standard linter.

### 📊 Health Scoring (Coming Soon)
*   **Intelligence Score**: A real-time health score of your project’s architecture, deductucting points for critical errors and warnings.

---

## 🛠️ Getting Started

1.  Open any Next.js project.
2.  NextIntel will automatically activate and begin scanning your active files.
3.  Check the **Problems** tab in VS Code for any detected architectural risks.

---

## ⚙️ Configuration

NextIntel works out of the box with zero configuration for standard Next.js projects.

---

## 🏗️ Architecture

NextIntel is built as a monorepo consisting of:
- **`engine`**: The core static analysis and graph engine.
- **`rules`**: A deterministic rule system for Next.js best practices.
- **`cli`**: A standalone command-line tool for project-wide audits.
- **`vscode-extension`**: The real-time editor integration.

---

**Built by developers who want to master the App Router with confidence.**
