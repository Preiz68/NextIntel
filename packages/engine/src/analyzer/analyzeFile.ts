import { Project, ScriptKind, SourceFile } from "ts-morph";
import path from "node:path";
import fs from "node:fs";

import { extractImports } from "./extractImports.js";
import { extractExports } from "./extractExports.js";
import { extractHooks } from "./extractHooks.js";
import { extractFetchCalls } from "./extractFetch.js";
import { extractBrowserAPIs } from "./extractBrowserApis.js";
import type { FileAnalysis } from "./types.js";
import type { SemanticFileAnalysis } from "../classifier/types.js";
import { 
  detectSemanticKind, 
  detectRuntime, 
  detectRenderingMode, 
  detectHydration 
} from "../classifier/index.js";
import { 
  evaluateFetchSemantics, 
  attachConstraints 
} from "../intelligence/index.js";

// ─── Shared Project instance (reused across calls for performance) ────────────

let sharedProject: Project | null = null;

function getProject(tsConfigPath?: string): Project {
  if (sharedProject) return sharedProject;

  sharedProject = new Project({
    tsConfigFilePath: tsConfigPath,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4, // JsxEmit.ReactJSX
      strict: false,
    },
  });

  return sharedProject;
}

// ─── Directive detection ──────────────────────────────────────────────────────

function detectDirective(sourceFile: SourceFile): {
  isClient: boolean;
  isServer: boolean;
} {
  // "use client" / "use server" must be the very first statement,
  // optionally preceded by comments.
  const statements = sourceFile.getStatements();
  const first = statements[0];

  if (!first) return { isClient: false, isServer: false };

  const text = first.getText().trim().replace(/;$/, "");
  if (text === '"use client"' || text === "'use client'") {
    return { isClient: true, isServer: false };
  }
  if (text === '"use server"' || text === "'use server'") {
    return { isClient: false, isServer: true };
  }

  return { isClient: false, isServer: true };
}

// ─── Async component detection ────────────────────────────────────────────────

function detectAsyncComponent(sourceFile: SourceFile): boolean {
  const exportedDecls = sourceFile.getExportedDeclarations();

  for (const [, declarations] of exportedDecls.entries()) {
    for (const decl of declarations) {
      // async function Component() {}
      if ("isAsync" in decl && typeof (decl as any).isAsync === "function") {
        if ((decl as any).isAsync()) return true;
      }
    }
  }

  return false;
}

// ─── Script kind resolution ───────────────────────────────────────────────────

function resolveScriptKind(filePath: string): ScriptKind {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".tsx":
      return ScriptKind.TSX;
    case ".ts":
      return ScriptKind.TS;
    case ".jsx":
      return ScriptKind.JSX;
    case ".mjs":
    case ".cjs":
    case ".js":
      return ScriptKind.JS;
    default:
      return ScriptKind.TS;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AnalyzeOptions {
  tsConfigPath?: string;
}

/**
 * Analyse a single TypeScript / JavaScript file and return a strongly typed
 * SemanticFileAnalysis object describing its imports, exports, hooks, fetch calls,
 * browser API usage, client/server classification, and Next.js semantics.
 *
 * @param filePath - Absolute path to the file.
 * @param options  - Optional path to the project's tsconfig.json.
 */
export async function analyzeFile(
  filePath: string,
  options: AnalyzeOptions = {},
): Promise<SemanticFileAnalysis> {
  const errors: string[] = [];

  if (!fs.existsSync(filePath)) {
    throw new Error(`[analyzeFile] File not found: ${filePath}`);
  }

  let sourceFile: SourceFile;

  try {
    const project = getProject(options.tsConfigPath);
    const scriptKind = resolveScriptKind(filePath);

    // Use addSourceFileAtPath so ts-morph handles reading from disk.
    const existingFile = project.getSourceFile(filePath);
    if (existingFile) {
      await existingFile.refreshFromFileSystem();
      sourceFile = existingFile;
    } else {
      sourceFile = project.addSourceFileAtPath(filePath);
    }

    // Re-add with explicit script kind if extension is ambiguous.
    if (!sourceFile) {
      sourceFile = project.createSourceFile(
        filePath,
        fs.readFileSync(filePath, "utf8"),
        { scriptKind, overwrite: true },
      );
    }
  } catch (err: any) {
    throw new Error(
      `[analyzeFile] Failed to parse ${filePath}: ${err.message}`,
    );
  }

  // ── Run all extractors ───────────────────────────────────────────────────

  let importDetails = [] as Awaited<ReturnType<typeof extractImports>>;
  let exportDetails = [] as Awaited<ReturnType<typeof extractExports>>;
  let hookDetails = [] as Awaited<ReturnType<typeof extractHooks>>;
  let fetchCalls = [] as Awaited<ReturnType<typeof extractFetchCalls>>;
  let browserAPIs = [] as Awaited<ReturnType<typeof extractBrowserAPIs>>;
  let directive = { isClient: false, isServer: false };
  let hasAsyncComponent = false;

  try {
    importDetails = extractImports(sourceFile);
  } catch (e: any) {
    errors.push(`imports: ${e.message}`);
  }
  try {
    exportDetails = extractExports(sourceFile);
  } catch (e: any) {
    errors.push(`exports: ${e.message}`);
  }
  try {
    hookDetails = extractHooks(sourceFile);
  } catch (e: any) {
    errors.push(`hooks: ${e.message}`);
  }
  try {
    fetchCalls = extractFetchCalls(sourceFile);
  } catch (e: any) {
    errors.push(`fetch: ${e.message}`);
  }
  try {
    browserAPIs = extractBrowserAPIs(sourceFile);
  } catch (e: any) {
    errors.push(`browserAPIs: ${e.message}`);
  }
  try {
    directive = detectDirective(sourceFile);
  } catch (e: any) {
    errors.push(`directive: ${e.message}`);
  }
  try {
    hasAsyncComponent = detectAsyncComponent(sourceFile);
  } catch (e: any) {
    errors.push(`async: ${e.message}`);
  }

  // ── Assemble raw AST result ──────────────────────────────────────────────

  const rawAnalysis: FileAnalysis = {
    filePath,
    isClientComponent: directive.isClient,
    isServerComponent: directive.isServer,
    imports: importDetails.map((i) => i.moduleSpecifier),
    importDetails,
    exports: exportDetails.map((e) => e.name),
    exportDetails,
    hooks: hookDetails.map((h) => h.name),
    hookDetails,
    usesBrowserAPI: browserAPIs.length > 0,
    browserAPIs,
    fetchCalls,
    hasAsyncComponent,
    errors,
  };

  // ── Apply Semantic Classification & Intelligence ─────────────────────────

  const enhancedFetchCalls = evaluateFetchSemantics(rawAnalysis.fetchCalls, rawAnalysis.isClientComponent);
  const semanticKind = detectSemanticKind(rawAnalysis);
  const runtime = detectRuntime(rawAnalysis);
  const rendering = detectRenderingMode(rawAnalysis);
  const hydration = detectHydration(rawAnalysis);

  const enrichedPayload: Omit<SemanticFileAnalysis, "violatedConstraints"> = {
    ...rawAnalysis,
    fetchCalls: enhancedFetchCalls,
    semanticKind,
    runtime,
    rendering,
    hydration,
  };

  const violatedConstraints = attachConstraints(enrichedPayload);

  return {
    ...enrichedPayload,
    violatedConstraints,
  };
}

/**
 * Analyse multiple files in parallel.
 * Failed files surface their error inside `FileAnalysis.errors` rather than
 * rejecting the whole batch.
 */
export async function analyzeFiles(
  filePaths: string[],
  options: AnalyzeOptions = {},
): Promise<SemanticFileAnalysis[]> {
  return Promise.all(
    filePaths.map((fp) =>
      analyzeFile(fp, options).catch(
        (err: Error) => {
          const raw: FileAnalysis = {
            filePath: fp,
            isClientComponent: false,
            isServerComponent: false,
            imports: [],
            importDetails: [],
            exports: [],
            exportDetails: [],
            hooks: [],
            hookDetails: [],
            usesBrowserAPI: false,
            browserAPIs: [],
            fetchCalls: [],
            hasAsyncComponent: false,
            errors: [err.message],
          };
          
          const semanticKind = detectSemanticKind(raw);
          const runtime = detectRuntime(raw);
          const rendering = detectRenderingMode(raw);
          const hydration = detectHydration(raw);
          
          return {
            ...raw,
            fetchCalls: [],
            semanticKind,
            runtime,
            rendering,
            hydration,
            violatedConstraints: [],
          } satisfies SemanticFileAnalysis;
        }
      ),
    ),
  );
}

/** Reset the shared ts-morph Project (useful between test runs). */
export function resetProject(): void {
  sharedProject = null;
}
