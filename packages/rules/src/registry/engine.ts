import { Rule, RuleContext, Diagnostic } from "../types.js";
import { KnowledgeRegistry } from "../knowledge/registry.js";

export class RuleEngine {
  private rules: Rule[] = [];

  /**
   * The registry is created once here and injected into every RuleContext so
   * all rules share the same loaded knowledge without re-reading disk.
   */
  private readonly knowledgeRegistry: KnowledgeRegistry =
    new KnowledgeRegistry();

  registerRule(rule: Rule) {
    this.rules.push(rule);
  }

  run(context: Omit<RuleContext, "knowledgeRegistry">): Diagnostic[] {
    const allDiagnostics: Diagnostic[] = [];

    // Attach the shared registry to the context before passing to rules
    const fullContext: RuleContext = {
      ...context,
      knowledgeRegistry: this.knowledgeRegistry,
    };

    for (const rule of this.rules) {
      try {
        const diagnostics = rule.run(fullContext);
        allDiagnostics.push(...diagnostics);
      } catch (err: any) {
        console.error(`Error running rule ${rule.id}:`, err.message);
      }
    }

    return allDiagnostics;
  }
}
