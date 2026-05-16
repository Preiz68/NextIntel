/**
 * Ambient type declarations for workspace packages that don't ship .d.ts files.
 * These are resolved at bundle-time by esbuild's alias map.
 */

declare module "rules" {
  export interface Diagnostic {
    file: string;
    line?: number;
    severity: "error" | "warning" | "info";
    ruleId: string;
    message: string;
    fix?: string;
  }

  export interface Rule {
    id: string;
    meta: {
      description: string;
      severity: "error" | "warning" | "info";
    };
    run(context: any): Diagnostic[];
  }

  export class RuleEngine {
    registerRule(rule: Rule): void;
    run(context: any): Diagnostic[];
  }

  export const rules: Rule[];
}

declare module "engine" {
  export interface FileAnalysis {
    filePath: string;
    isClientComponent: boolean;
    isServerComponent: boolean;
    imports: string[];
    importDetails: any[];
    exports: string[];
    exportDetails: any[];
    hooks: string[];
    hookDetails: any[];
    usesBrowserAPI: boolean;
    browserAPIs: Array<{ api: string; count: number }>;
    fetchCalls: Array<{
      hasCacheConfig: boolean;
      cacheValue: string | null;
      hasRevalidate: boolean;
      revalidateValue: number | string | null;
      isDynamic: boolean;
    }>;
    hasAsyncComponent: boolean;
    errors: string[];
  }

  export function analyzeFiles(
    filePaths: string[],
    options?: { tsConfigPath?: string },
  ): Promise<FileAnalysis[]>;

  export function analyzeFile(
    filePath: string,
    options?: { tsConfigPath?: string },
  ): Promise<FileAnalysis>;
}
