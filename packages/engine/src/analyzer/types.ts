import type { ExportedDeclarations } from "ts-morph";

export interface ImportInfo {
  moduleSpecifier: string;
  namedImports: string[];
  defaultImport: string | null;
  namespaceImport: string | null;
  isTypeOnly: boolean;
}

export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isTypeOnly: boolean;
  kind:
    | "function"
    | "class"
    | "variable"
    | "type"
    | "interface"
    | "enum"
    | "unknown";
  declaredInFile?: string;
}

export interface FetchCall {
  hasCacheConfig: boolean;
  cacheValue: string | null;
  hasRevalidate: boolean;
  revalidateValue: number | string | null;
  isDynamic: boolean;
  line: number;
}

export interface HookUsage {
  name: string;
  isCustomHook: boolean;
  isBuiltIn: boolean;
  line: number;
}

export interface BrowserAPIUsage {
  api: string;
  count: number;
  line: number;
  affectsRender?: boolean;
  isGuarded?: boolean;
}

export interface FileAnalysis {
  filePath: string;
  isClientComponent: boolean;
  isServerComponent: boolean;
  hasTopLevelUseServer: boolean;
  isEdgeRuntime: boolean;
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
  taintState: "CLEAN" | "TAINTED" | "CONDITIONALLY_TAINTED";
  taints: any[];
  simulationFindings: any[];
}
