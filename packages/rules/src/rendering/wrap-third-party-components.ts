import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync } from "node:fs";
import { Project } from "ts-morph";
import { mapEventToDiagnostic } from "../knowledge/atomicConstraints.js";

function isThirdParty(specifier: string): boolean {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("react") ||
    specifier.startsWith("next")
  ) {
    return false;
  }
  return true;
}

export const wrapThirdPartyComponents: Rule = {
  id: "wrap-third-party-components",

  meta: {
    description:
      "Third-party components that use client features without 'use client' must be wrapped.",
    severity: "error",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const analysis of context.analyses) {
      const isServerCtx = analysis.executionModel.componentType === "server";
      if (!isServerCtx) continue;

      const hasViolation = analysis.executionModel.boundaryViolations.includes(
        "third-party component used directly in server component"
      );
      if (!hasViolation) continue;

      let content = "";
      try {
        content = readFileSync(analysis.filePath, "utf-8");
      } catch {
        continue;
      }

      const project = new Project();
      const sourceFile = project.createSourceFile("temp.ts", content);

      let reported = false;

      sourceFile.forEachDescendant((node) => {
        const kind = node.getKindName();
        if (kind === "JsxOpeningElement" || kind === "JsxSelfClosingElement") {
          const tagNameNode = (node as any).getTagNameNode();
          if (tagNameNode) {
            const tagName = tagNameNode.getText();
            if (tagName && tagName[0] === tagName[0].toUpperCase()) {
              let baseTagName = tagName;
              if (tagName.includes(".")) {
                baseTagName = tagName.split(".")[0]!;
              }

              const imp = analysis.importDetails.find(
                (i) =>
                  i.namedImports.includes(baseTagName) ||
                  i.defaultImport === baseTagName ||
                  i.namespaceImport === baseTagName
              );

              if (imp && isThirdParty(imp.moduleSpecifier)) {
                const line = node.getStartLineNumber();

                diagnostics.push(
                  mapEventToDiagnostic(
                    "BOUNDARY_VIOLATION_DETECTED",
                    "SC-THIRD-PARTY-001",
                    this.id,
                    analysis.filePath,
                    line,
                    `Third-party component '<${tagName}>' from '${imp.moduleSpecifier}' is used directly in a Server Component.`
                  )
                );
                reported = true;
              }
            }
          }
        }
      });

      if (!reported) {
        diagnostics.push(
          mapEventToDiagnostic(
            "BOUNDARY_VIOLATION_DETECTED",
            "SC-THIRD-PARTY-001",
            this.id,
            analysis.filePath,
            1,
            `Third-party components are used directly in a Server Component without wrapper.`
          )
        );
      }
    }

    return diagnostics;
  },
};
