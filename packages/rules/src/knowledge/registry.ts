import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  KnowledgeConceptSchema,
  type KnowledgeConcept,
  type KnowledgeConstraint,
  type ConceptDefinition,
  type ConstraintDefinition,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Resolve the path to packages/knowledge/concepts at runtime.
//
// tsup compiles to both ESM and CJS. In ESM, import.meta.url is available.
// In CJS, __dirname is available natively. We resolve which to use at runtime.
// createRequire gives us a require() in ESM; we use its .resolve() to get
// the absolute path of this module, then derive __dirname from it.
// ---------------------------------------------------------------------------

// Build a module-local require anchored to this file.
// createRequire(import.meta.url) works in ESM; in the CJS build tsup injects
// a __filename global so we use that as the fallback via globalThis.
//
// Note: tsup's CJS shim already defines __filename in the module scope.
// We reference it via `(globalThis as any).__filename` only as a safety net
// — the `import.meta.url` branch runs in the ESM output.
//
// To avoid the "import.meta is not available" warning from tsup we use

// createRequire with an absolute path derived from process.env or a
// direct __dirname reference for CJS, and import.meta.url only where
// we KNOW we are in ESM (the check is done at module evaluation time).

// For path resolution we only need the directory of the compiled file.
// In CJS __dirname is a module global injected by Node. In ESM we derive
// it from import.meta.url. tsup handles both via __dirname injection in CJS.
/* eslint-disable @typescript-eslint/no-var-requires */
const localDir =
  typeof __dirname !== "undefined"
    ? __dirname
    : dirname(fileURLToPath(import.meta.url));

// Walk up parent directories to locate packages/knowledge/concepts
let conceptsDir = "";
let current = localDir;
for (let i = 0; i < 6; i++) {
  const candidate = join(current, "packages", "knowledge", "concepts");
  if (existsSync(candidate)) {
    conceptsDir = candidate;
    break;
  }
  const candidateDirect = join(current, "knowledge", "concepts");
  if (existsSync(candidateDirect)) {
    conceptsDir = candidateDirect;
    break;
  }
  const parent = dirname(current);
  if (parent === current) break;
  current = parent;
}

const CONCEPTS_DIR = conceptsDir;

// ---------------------------------------------------------------------------
// KnowledgeRegistry
//
// Loads ALL knowledge packs eagerly at construction time (synchronously, once).
// Rules query this registry during their run() to retrieve constraints and
// patterns without any hardcoded semantics in the rule files themselves.
// ---------------------------------------------------------------------------

export class KnowledgeRegistry {
  /** Map keyed by concept name (e.g. "Server Components", "Caching") */
  private readonly concepts: Map<string, KnowledgeConcept> = new Map();

  /** Map keyed by concept category slug (e.g. "server-components", "caching") */
  private readonly conceptsByCategory: Map<string, KnowledgeConcept> =
    new Map();

  constructor() {
    this.loadAll();
  }

  // -------------------------------------------------------------------------
  // Private: load all JSON files from the concepts directory
  // -------------------------------------------------------------------------

  private loadAll(): void {
    let files: string[];

    try {
      files = readdirSync(CONCEPTS_DIR).filter((f) => f.endsWith(".json"));
    } catch (err: any) {
      console.error(
        `[KnowledgeRegistry] Failed to read concepts directory at "${CONCEPTS_DIR}": ${err.message}`,
      );
      return;
    }

    for (const file of files) {
      const filePath = join(CONCEPTS_DIR, file);
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        const result = KnowledgeConceptSchema.safeParse(raw);

        if (!result.success) {
          console.warn(
            `[KnowledgeRegistry] Schema validation failed for "${file}":\n`,
            result.error.format(),
          );
          continue;
        }

        const concept = result.data;
        const slug = file.replace(".json", "");
        this.concepts.set(concept.concept, concept);
        this.conceptsByCategory.set(slug, concept);
        // Map category fallback for backward compatibility
        this.conceptsByCategory.set(concept.category, concept);
      } catch (err: any) {
        console.error(
          `[KnowledgeRegistry] Failed to load "${file}": ${err.message}`,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Retrieve a full knowledge concept by its human-readable concept name or slug.
   *
   * @example getConcept("Server Components") or getConcept("server-components")
   */
  getConcept(concept: string): ConceptDefinition | undefined {
    return this.concepts.get(concept) ?? this.conceptsByCategory.get(concept);
  }

  /**
   * Retrieve a full knowledge concept by its category slug.
   *
   * @example getConceptByCategory("server-components")
   */
  getConceptByCategory(category: string): ConceptDefinition | undefined {
    return this.conceptsByCategory.get(category);
  }

  /**
   * Retrieve a specific constraint by pack name/slug and constraint ID.
   */
  getConstraint(
    pack: string,
    constraintId: string,
  ): ConstraintDefinition | undefined {
    const concept = this.getConcept(pack);
    if (!concept) return undefined;
    return concept.constraints.find((c) => c.id === constraintId);
  }

  /**
   * Retrieve patterns of type 'forbidden' or 'allowed' for a given pack.
   */
  getPatterns(pack: string, type: "forbidden" | "allowed"): string[] {
    const concept = this.getConcept(pack);
    if (!concept) return [];
    const patterns: string[] = [];
    for (const constraint of concept.constraints) {
      const list =
        type === "forbidden"
          ? constraint.forbiddenPatterns
          : constraint.allowedPatterns;
      patterns.push(...list);
    }
    return patterns;
  }

  /**
   * Retrieve a specific constraint by its stable ID (e.g. "SC-001").
   *
   * @example getConstraintById("SC-001")
   */
  getConstraintById(id: string): ConstraintDefinition | undefined {
    for (const concept of this.concepts.values()) {
      const found = concept.constraints.find((c) => c.id === id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * List all loaded concept names. Useful for debugging and diagnostics.
   */
  listConcepts(): string[] {
    return Array.from(this.concepts.keys());
  }
}
