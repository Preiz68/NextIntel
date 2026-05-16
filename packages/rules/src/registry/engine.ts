import { Rule, RuleContext, Diagnostic } from "../types.js";

export class RuleEngine {
  private rules: Rule[] = [];

  registerRule(rule: Rule) {
    this.rules.push(rule);
  }

  run(context: RuleContext): Diagnostic[] {
    const allDiagnostics: Diagnostic[] = [];

    for (const rule of this.rules) {
      try {
        const diagnostics = rule.run(context);
        allDiagnostics.push(...diagnostics);
      } catch (err: any) {
        console.error(`Error running rule ${rule.id}:`, err.message);
      }
    }

    return allDiagnostics;
  }
}
