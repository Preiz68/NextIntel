import bundling from "../../../knowledge/concepts/bundling.json" with { type: "json" };
import caching from "../../../knowledge/concepts/caching.json" with { type: "json" };
import clientComponents from "../../../knowledge/concepts/client-components.json" with { type: "json" };
import dataFetching from "../../../knowledge/concepts/data-fetching.json" with { type: "json" };
import errorBoundaries from "../../../knowledge/concepts/error-boundaries.json" with { type: "json" };
import hydration from "../../../knowledge/concepts/hydration.json" with { type: "json" };
import metadata from "../../../knowledge/concepts/metadata.json" with { type: "json" };
import middleware from "../../../knowledge/concepts/middleware.json" with { type: "json" };
import observability from "../../../knowledge/concepts/observability.json" with { type: "json" };
import performance from "../../../knowledge/concepts/performance.json" with { type: "json" };
import rendering from "../../../knowledge/concepts/rendering.json" with { type: "json" };
import revalidation from "../../../knowledge/concepts/revalidation.json" with { type: "json" };
import routing from "../../../knowledge/concepts/routing.json" with { type: "json" };
import runtime from "../../../knowledge/concepts/runtime.json" with { type: "json" };
import security from "../../../knowledge/concepts/security.json" with { type: "json" };
import serverActions from "../../../knowledge/concepts/server-actions.json" with { type: "json" };
import serverComponents from "../../../knowledge/concepts/server-components.json" with { type: "json" };
import streaming from "../../../knowledge/concepts/streaming.json" with { type: "json" };

import {
  KnowledgeConceptSchema,
  type KnowledgeConcept,
  type ConceptDefinition,
  type ConstraintDefinition,
} from "./schema.js";

// ---------------------------------------------------------------------------
// KnowledgeRegistry
//
// Eagerly bundles all knowledge concept JSON objects to make registry checks
// completely filesystem-independent and robust in any environment (including
// bundled VS Code extension, CLI, and web environments).
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
  // Private: load all JSON files statically from bundled inputs
  // -------------------------------------------------------------------------

  private loadAll(): void {
    const rawConcepts = [
      bundling,
      caching,
      clientComponents,
      dataFetching,
      errorBoundaries,
      hydration,
      metadata,
      middleware,
      observability,
      performance,
      rendering,
      revalidation,
      routing,
      runtime,
      security,
      serverActions,
      serverComponents,
      streaming,
    ];

    for (const raw of rawConcepts) {
      const result = KnowledgeConceptSchema.safeParse(raw);

      if (!result.success) {
        console.warn(
          `[KnowledgeRegistry] Schema validation failed for embedded concept:\n`,
          result.error.format(),
        );
        continue;
      }

      const concept = result.data;
      const slug = concept.concept.toLowerCase().replace(/\s+/g, "-");
      this.concepts.set(concept.concept, concept);
      this.conceptsByCategory.set(slug, concept);
      // Map category fallback for backward compatibility
      this.conceptsByCategory.set(concept.category, concept);
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
