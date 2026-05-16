# NextIntel

A high-performance intelligence engine and static analysis tool for Next.js App Router projects.

## 🏗️ Monorepo Structure

- **`packages/engine`**: Core static analysis engine powered by `ts-morph`.
- **`packages/rules`**: Deterministic rule system for Next.js architectural patterns.
- **`packages/cli`**: Command-line interface for project-wide audits.
- **`vscode-extension`**: Real-time editor integration with live diagnostics and quick-fixes.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- [pnpm](https://pnpm.io/)

### Installation
```bash
pnpm install
pnpm build
```

### Usage

**CLI Analysis:**
```bash
pnpm analyze .
```

**VS Code Extension:**
1. Open the `vscode-extension` folder.
2. Press `F5` to start debugging.

## 📜 License
MIT
