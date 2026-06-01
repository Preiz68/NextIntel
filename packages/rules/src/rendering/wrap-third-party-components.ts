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

/**
 * Packages that are known to be RSC-compatible: pure presentational components
 * (icons, SVGs, layout utilities) with no hooks, browser APIs, or event listeners.
 * These should never trigger wrap-third-party-components.
 */
const SAFE_RSC_PACKAGES = new Set([
  "lucide-react",
  "@heroicons/react",
  "@heroicons/react/24/outline",
  "@heroicons/react/24/solid",
  "@heroicons/react/20/solid",
  "react-icons",
  "react-icons/ai", "react-icons/bi", "react-icons/bs", "react-icons/cg",
  "react-icons/ci", "react-icons/di", "react-icons/fa", "react-icons/fa6",
  "react-icons/fc", "react-icons/fi", "react-icons/gi", "react-icons/go",
  "react-icons/gr", "react-icons/hi", "react-icons/hi2", "react-icons/im",
  "react-icons/io", "react-icons/io5", "react-icons/lu", "react-icons/md",
  "react-icons/pi", "react-icons/ri", "react-icons/rx", "react-icons/si",
  "react-icons/sl", "react-icons/tb", "react-icons/ti", "react-icons/vsc",
  "class-variance-authority",
  "clsx",
  "tailwind-merge",
]);

function isSafeForRSC(specifier: string): boolean {
  if (SAFE_RSC_PACKAGES.has(specifier)) return true;
  for (const safe of SAFE_RSC_PACKAGES) {
    if (specifier.startsWith(safe + "/") || specifier.startsWith(safe + "#")) return true;
  }
  return false;
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
      const isServer =
        !analysis.isClientComponent &&
        analysis.executionModel.componentType !== "client";
      if (!isServer) continue;

      const hasViolation = analysis.executionModel.boundaryViolations.includes(
        "third-party component used directly in server component",
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
                (i: any) =>
                  i.namedImports.includes(baseTagName) ||
                  i.defaultImport === baseTagName ||
                  i.namespaceImport === baseTagName,
              );

              if (imp && isThirdParty(imp.moduleSpecifier) && !isSafeForRSC(imp.moduleSpecifier)) {
                const line = node.getStartLineNumber();

                diagnostics.push(
                  mapEventToDiagnostic(
                    "BOUNDARY_VIOLATION_DETECTED",
                    "SC-THIRD-PARTY-001",
                    this.id,
                    analysis.filePath,
                    line,
                    `Third-party component '<${tagName}>' from '${imp.moduleSpecifier}' is used directly in a Server Component.`,
                  ),
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
            `Third-party components are used directly in a Server Component without wrapper.`,
          ),
        );
      }
    }

    return diagnostics;
  },
};
