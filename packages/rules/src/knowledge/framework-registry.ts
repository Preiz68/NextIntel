/**
 * framework-registry.ts
 *
 * NextIntel Framework Knowledge Layer — Registry & Query API
 *
 * Provides a typed interface to query the FRAMEWORK_APIS database.
 * Rules, the execution model engine, and diagnostic formatters
 * query this instead of hardcoding module/API lists.
 */

import {
  FRAMEWORK_APIS,
  type FrameworkAPI,
  type SemanticContext,
  type FrameworkRuntime,
} from "./framework-apis.js";

export type { FrameworkAPI, SemanticContext, FrameworkRuntime } from "./framework-apis.js";

// ---------------------------------------------------------------------------
// FrameworkRegistry
// ---------------------------------------------------------------------------

export class FrameworkRegistry {
  private readonly byModule = new Map<string, FrameworkAPI[]>();
  private readonly byExport = new Map<string, FrameworkAPI[]>();

  constructor() {
    this.index();
  }

  // ── Indexing ──────────────────────────────────────────────────────────────

  private index(): void {
    for (const api of FRAMEWORK_APIS) {
      // Index by module
      const byMod = this.byModule.get(api.module) ?? [];
      byMod.push(api);
      this.byModule.set(api.module, byMod);

      // Index by named export (for granular lookup)
      for (const exp of api.exports) {
        const byExp = this.byExport.get(exp) ?? [];
        byExp.push(api);
        this.byExport.set(exp, byExp);
      }
    }
  }

  // ── Public Query API ──────────────────────────────────────────────────────

  /**
   * Look up all descriptors for a given module specifier.
   * A module may have multiple entries for different export groups.
   *
   * @example lookup("next/headers") → [{ runtime: "server-only", ... }]
   */
  lookup(module: string): FrameworkAPI[] {
    return this.byModule.get(module) ?? [];
  }

  /**
   * Look up descriptors by a named export symbol.
   * Useful when you know the symbol but not which module it came from.
   *
   * @example lookupExport("useState") → [{ module: "react", runtime: "client-only", ... }]
   */
  lookupExport(exportName: string): FrameworkAPI[] {
    return this.byExport.get(exportName) ?? [];
  }

  /**
   * Determine whether a module (or specific export) is allowed in a given
   * semantic execution context.
   *
   * Returns true if any matching descriptor permits the context.
   * Returns true for unknown modules (permissive — only known APIs are constrained).
   *
   * @example isAllowedIn("next/headers", "client-component") → false
   * @example isAllowedIn("next/image", "server-component")   → true
   */
  isAllowedIn(module: string, context: SemanticContext, exportName?: string): boolean {
    const descriptors = exportName
      ? this.byExport.get(exportName)?.filter(d => d.module === module) ?? []
      : this.lookup(module);

    if (descriptors.length === 0) return true; // unknown module — permissive

    return descriptors.some(d => (d.allowedIn as string[]).includes(context));
  }

  /**
   * Get all modules classified as server-only.
   * Used by buildExecutionModel to detect server API usage.
   */
  getServerOnlyModules(): FrameworkAPI[] {
    return FRAMEWORK_APIS.filter(a => a.runtime === "server-only");
  }

  /**
   * Get the module specifiers of all server-only APIs.
   * Suitable for array `.includes()` / `.some()` checks.
   */
  getServerOnlyModuleNames(): string[] {
    return [...new Set(this.getServerOnlyModules().map(a => a.module))];
  }

  /**
   * Get the named exports of all server-only APIs.
   * Suitable for detecting individual symbol usage.
   */
  getServerOnlyExports(): string[] {
    const exports: string[] = [];
    for (const api of this.getServerOnlyModules()) {
      exports.push(...api.exports);
    }
    return [...new Set(exports)];
  }

  /**
   * Get all modules classified as client-only.
   */
  getClientOnlyModules(): FrameworkAPI[] {
    return FRAMEWORK_APIS.filter(a => a.runtime === "client-only");
  }

  /**
   * Get module specifiers for all client-only APIs.
   */
  getClientOnlyModuleNames(): string[] {
    return [...new Set(this.getClientOnlyModules().map(a => a.module))];
  }

  /**
   * Get all APIs that require an active HTTP request context
   * (i.e. must be called within a request lifecycle, not at module init).
   */
  getRequestContextAPIs(): FrameworkAPI[] {
    return FRAMEWORK_APIS.filter(a => a.requiresRequestContext);
  }

  /**
   * Get all named exports from APIs that require request context.
   */
  getRequestContextExports(): string[] {
    const exports: string[] = [];
    for (const api of this.getRequestContextAPIs()) {
      exports.push(...api.exports);
    }
    return [...new Set(exports)];
  }

  /**
   * Get all hard runtime-fencing modules (like "server-only", "client-only")
   * that produce build errors when imported across boundaries.
   */
  getFencingModules(): FrameworkAPI[] {
    return FRAMEWORK_APIS.filter(a => a.isFencingModule === true);
  }

  /**
   * Get all constraint IDs that can be triggered by APIs in a given module.
   */
  getConstraintsForModule(module: string): string[] {
    const descriptors = this.lookup(module);
    const ids = new Set<string>();
    for (const d of descriptors) {
      for (const c of d.triggersConstraints) {
        ids.add(c);
      }
    }
    return [...ids];
  }

  /**
   * Describe an API in human-readable form for diagnostic output.
   */
  describe(module: string, exportName?: string): string | undefined {
    const descriptors = exportName
      ? this.byExport.get(exportName)?.filter(d => d.module === module)
      : this.lookup(module);

    return descriptors?.[0]?.description;
  }

  /**
   * List all registered module specifiers. Useful for debugging.
   */
  listModules(): string[] {
    return [...this.byModule.keys()];
  }
}

// ---------------------------------------------------------------------------
// Singleton instance — import this everywhere instead of constructing
// ---------------------------------------------------------------------------

export const frameworkRegistry = new FrameworkRegistry();
