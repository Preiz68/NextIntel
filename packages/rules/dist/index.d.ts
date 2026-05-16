import { Graph } from 'graphlib';

interface ImportInfo {
    moduleSpecifier: string;
    namedImports: string[];
    defaultImport: string | null;
    namespaceImport: string | null;
    isTypeOnly: boolean;
}
interface ExportInfo {
    name: string;
    isDefault: boolean;
    isTypeOnly: boolean;
    kind: "function" | "class" | "variable" | "type" | "interface" | "enum" | "unknown";
}
interface FetchCall {
    hasCacheConfig: boolean;
    cacheValue: string | null;
    hasRevalidate: boolean;
    revalidateValue: number | string | null;
    isDynamic: boolean;
}
interface HookUsage {
    name: string;
    isCustomHook: boolean;
    isBuiltIn: boolean;
}
interface BrowserAPIUsage {
    api: string;
    count: number;
}
interface FileAnalysis {
    filePath: string;
    isClientComponent: boolean;
    isServerComponent: boolean;
    imports: string[];
    importDetails: ImportInfo[];
    exports: string[];
    exportDetails: ExportInfo[];
    hooks: string[];
    hookDetails: HookUsage[];
    usesBrowserAPI: boolean;
    browserAPIs: BrowserAPIUsage[];
    fetchCalls: FetchCall[];
    hasAsyncComponent: boolean;
    errors: string[];
}

interface GraphNode {
    id: string;
    filePath: string;
    isClientComponent: boolean;
    isServerComponent: boolean;
    hasDefaultExport: boolean;
    kind: "page" | "component" | "hook" | "util" | "action" | "unknown";
}

type Severity = "error" | "warning" | "info";
interface Diagnostic {
    file: string;
    line?: number;
    severity: Severity;
    ruleId: string;
    message: string;
    fix?: string;
}
interface RuleContext {
    analyses: FileAnalysis[];
    graph: Graph;
    nodes: Map<string, GraphNode>;
    edges: any[];
}
interface Rule {
    id: string;
    meta: {
        description: string;
        severity: Severity;
    };
    run(context: RuleContext): Diagnostic[];
}

declare class RuleEngine {
    private rules;
    registerRule(rule: Rule): void;
    run(context: RuleContext): Diagnostic[];
}

declare const rules: Rule[];

export { type Diagnostic, type Rule, type RuleContext, RuleEngine, type Severity, rules };
