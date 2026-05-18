import { z } from "zod";

// ---------------------------------------------------------------------------
// Constraint — the atomic unit of semantic knowledge
// ---------------------------------------------------------------------------

export const KnowledgeExamplesSchema = z.object({
  invalid: z.array(z.string()),
  valid: z.array(z.string()),
});

export const KnowledgeConstraintSchema = z.object({
  id: z.string(),
  title: z.string(),
  problem: z.string(),
  whyItMatters: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  forbiddenPatterns: z.array(z.string()),
  allowedPatterns: z.array(z.string()),
  productionRisks: z.array(z.string()),
  architectureImplications: z.array(z.string()),
  optimizationGuidance: z.array(z.string()),
  quickFixes: z.array(z.string()),
  architectureSuggestions: z.array(z.string()),
  examples: KnowledgeExamplesSchema,
});

// ---------------------------------------------------------------------------
// Top-level knowledge pack (one per JSON file)
// ---------------------------------------------------------------------------

export const KnowledgeConceptSchema = z.object({
  concept: z.string(),
  category: z.string(),
  description: z.string(),
  constraints: z.array(KnowledgeConstraintSchema),
});

// ---------------------------------------------------------------------------
// Inferred TypeScript types from Zod schemas
// ---------------------------------------------------------------------------

export type KnowledgeExamples = z.infer<typeof KnowledgeExamplesSchema>;
export type KnowledgeConstraint = z.infer<typeof KnowledgeConstraintSchema>;
export type KnowledgeConcept = z.infer<typeof KnowledgeConceptSchema>;

export type ConceptDefinition = KnowledgeConcept;
export type ConstraintDefinition = KnowledgeConstraint;
