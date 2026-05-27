import { Rule, RuleContext, Diagnostic } from "../types.js";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

export const reactRenderPurity: Rule = {
  id: "react-render-purity",

  meta: {
    description: "Verifies React render purity and deterministic rendering.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const findings = analysis.simulationFindings || [];
      
      for (const f of findings) {
        if (f.type === "hydration_nondeterminism") {
          const diag = mapEventToDiagnostic(
            "HYDRATION_UNSTABLE_RENDER",
            "HY-NON-DETERMINISTIC-001",
            this.id,
            analysis.filePath,
            f.line,
            f.message
          );
          diag.safeRefactorSuggestion = `// Defer non-deterministic API access to useEffect or run only after mounting:
// 1. Using a functional lazy initializer deferral:
const [id, setId] = useState<string | null>(null);
useEffect(() => {
  setId(crypto.randomUUID());
}, []);

// 2. Or using a mounted-state flag:
const [mounted, setMounted] = useState(false);
useEffect(() => {
  setMounted(true);
}, []);
const value = mounted ? Math.random() : 0.5;`;
          diagnostics.push(diag);
        } else if (f.type === "render_mutation") {
          const diag = mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "HY-RENDER-MUTATION-001",
            this.id,
            analysis.filePath,
            f.line,
            f.message
          );
          diag.safeRefactorSuggestion = `// Component rendering must be pure. Move external mutations or state side effects into useEffect:
// Instead of mutating outside variables in top-level render:
useEffect(() => {
  externalCache.set(key, value);
}, [key, value]);`;
          diagnostics.push(diag);
        }
      }
    }

    return diagnostics;
  },
};
