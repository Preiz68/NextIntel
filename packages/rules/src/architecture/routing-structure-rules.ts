import { Rule, RuleContext, Diagnostic } from "../types.js";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { Project, SyntaxKind } from "ts-morph";
import path from "node:path";

export const routingStructureRules: Rule = {
  id: "routing-structure-rules",

  meta: {
    description: "Enforce casing, link mapping, route groups, and structure rules in Next.js App Router.",
    severity: "warning",
  },

  run(context: RuleContext): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    const activeRoutes = new Set<string>();
    for (const a of context.analyses) {
      const norm = a.filePath.replace(/\\/g, "/");
      const aAppIdx = norm.indexOf("/app/");
      if (aAppIdx !== -1) {
        const routeDir = path.dirname(norm.substring(aAppIdx + 5));
        activeRoutes.add(routeDir);
      }
    }

    for (const analysis of context.analyses) {
      const filePath = analysis.filePath;
      const normPath = filePath.replace(/\\/g, "/");
      const appIdx = normPath.indexOf("/app/");
      if (appIdx === -1) continue;

      const relativeAppPath = normPath.substring(appIdx + 5);
      const segments = relativeAppPath.split("/");
      const filename = segments[segments.length - 1]!;

      // 1. RO-LOWERCASE-FOLDERS (Directory casing check)
      const hasUppercaseDir = segments.slice(0, -1).some(s => /[A-Z]/.test(s) && !s.startsWith("(") && !s.startsWith("["));
      if (hasUppercaseDir) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-LOWERCASE-FOLDERS",
          message: `Uppercase characters detected in route segment directory path '/app/${segments.slice(0, -1).join("/")}'. Route folders should use lowercase names to prevent platform-specific routing mismatches.`,
          whyItMatters: "Case-sensitive web servers (like Linux hosting environments) will fail to resolve routes if links use different capitalization than the directories, causing 404 errors."
        });
      }

      // 2. RO-EMPTY-GROUPS (Empty route groups)
      const groupSeg = segments.find(s => s.startsWith("(") && s.endsWith(")"));
      if (groupSeg) {
        const appRelativeDir = segments.slice(0, segments.indexOf(groupSeg) + 1).join("/");
        const fullDirPath = normPath.substring(0, normPath.indexOf(groupSeg) + groupSeg.length);
        try {
          if (existsSync(fullDirPath) && readdirSync(fullDirPath).length === 0) {
            diagnostics.push({
              file: filePath,
              line: 1,
              severity: "warning",
              ruleId: this.id,
              id: "RO-EMPTY-GROUPS",
              message: `Empty route group directory '/app/${appRelativeDir}' detected. Clean up unused route folders.`,
              whyItMatters: "Unused folders increase project nesting complexity without providing routing benefits."
            });
          }
        } catch {}
      }

      // 3. RO-IDENTICAL-GROUPS (Identical route groups nested)
      const groupSegments = segments.filter(s => s.startsWith("(") && s.endsWith(")"));
      const uniqueGroups = new Set(groupSegments);
      if (groupSegments.length !== uniqueGroups.size) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-IDENTICAL-GROUPS",
          message: `Route group directory path contains duplicate nested group names: ${groupSegments.join(" -> ")}. Rename nested groups to maintain clarity.`,
          whyItMatters: "Nested route groups with identical names create ambiguous filesystem layouts and complicate layout inheritance."
        });
      }

      // 4. RO-DEEP-SEGMENTS (Deep dynamics check)
      const dynamicCount = segments.filter(s => s.startsWith("[") && s.endsWith("]")).length;
      if (dynamicCount > 3) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-DEEP-SEGMENTS",
          message: `Dynamic routing segments nested more than 3 levels deep at '/app/${segments.slice(0, -1).join("/")}'. Redesign nesting paths.`,
          whyItMatters: "Very deep dynamic route nesting results in complex page lookups and slows dynamic rendering optimization."
        });
      }

      let content = "";
      try {
        if (existsSync(filePath)) {
          content = readFileSync(filePath, "utf-8");
        }
      } catch {
        continue;
      }

      if (!content) continue;

      // 5. RO-CLIENT-METADATA (Metadata in Client Components)
      if (analysis.isClientComponent && (content.includes("generateMetadata") || content.includes("export const metadata"))) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-CLIENT-METADATA",
          message: `Metadata or 'generateMetadata' exported from Client Component '${filename}'. Metadata exports are only supported in Server Components.`,
          whyItMatters: "Next.js ignores metadata exports in Client Components, causing configuration warnings and failing to apply head updates."
        });
      }

      // 6. RO-CO-LOCATED-ASSETS (Assets in routing folder)
      const matchesAsset = /\.(png|jpg|jpeg|svg|gif|webp|css|scss|sass)$/i.test(filename);
      const isUnderRoute = segments.length > 1 && !segments.includes("public") && !segments.includes("assets");
      if (matchesAsset && isUnderRoute) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-CO-LOCATED-ASSETS",
          message: `Co-located asset file '${filename}' found inside routing folder '/app/${segments.slice(0, -1).join("/")}'. Move it to '/public' or '/assets' directory.`,
          whyItMatters: "App Router segment directories should only house routing configurations and components. Storing static files inside /app complicates build outputs."
        });
      }

      // 7. RO-MISSING-NOT-FOUND (Suggestion for not-found on dynamic pages)
      const isDynamicPage = filename.startsWith("page") && segments.some(s => s.startsWith("[") && s.endsWith("]"));
      if (isDynamicPage) {
        const parentDir = path.dirname(filePath);
        const hasNotFound = ["not-found.tsx", "not-found.jsx", "not-found.js"].some(f => existsSync(path.join(parentDir, f)));
        if (!hasNotFound) {
          diagnostics.push({
            file: filePath,
            line: 1,
            severity: "warning",
            ruleId: this.id,
            id: "RO-MISSING-NOT-FOUND",
            message: `Dynamic route page '${filename}' lacks a sibling 'not-found.tsx' boundary. Consider adding one to handle invalid dynamic route param queries.`,
            whyItMatters: "Adding not-found.tsx locally allows calling the notFound() helper to stream a localized 404 page instead of triggering the root fallback."
          });
        }
      }

      // 8. RO-PRIVATE-LINK-LEAK (Link leaks)
      const linkMatch = /<Link[^>]+href=['"`]\/app\/_([^'"`]+)['"`]/g.exec(content);
      if (linkMatch) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-PRIVATE-LINK-LEAK",
          message: `Link component targets private folder '/_mock_path_or_folder'. Private folders (prefix with _) are excluded from routing.`,
          whyItMatters: "Private folders starting with an underscore are ignored by the Next.js router. Linking to them will result in broken links."
        });
      }

      // 9. RO-DIRECT-QUERY-MUTATION (Pushstate check)
      if (content.includes("window.history.pushState") && !content.includes("useRouter")) {
        diagnostics.push({
          file: filePath,
          line: 1,
          severity: "warning",
          ruleId: this.id,
          id: "RO-DIRECT-QUERY-MUTATION",
          message: `Direct usage of 'window.history.pushState' to modify search parameters. Use Next.js 'useRouter()' and 'usePathname()' for router state coordination.`,
          whyItMatters: "Modifying browser history directly bypasses Next.js Router Cache updates, causing state desynchronization in nested layout renders."
        });
      }

      // 10. RO-GROUP-LAYOUT (No layout inside route group override)
      const isRouteGroupPage = filename.startsWith("page") && segments.some(s => s.startsWith("(") && s.endsWith(")"));
      if (isRouteGroupPage) {
        const groupFolder = segments.find(s => s.startsWith("(") && s.endsWith(")"))!;
        const groupIndex = segments.indexOf(groupFolder);
        const parentPath = segments.slice(0, groupIndex + 1).join("/");
        const parentDir = path.dirname(filePath);
        
        const hasLocalLayout = ["layout.tsx", "layout.jsx", "layout.js"].some(f => existsSync(path.join(parentDir, f)));
        if (!hasLocalLayout && groupIndex === segments.length - 2) {
          diagnostics.push({
            file: filePath,
            line: 1,
            severity: "warning",
            ruleId: this.id,
            id: "RO-GROUP-LAYOUT",
            message: `Route group folder '/app/${parentPath}' contains a page but lacks an isolation 'layout.tsx' file.`,
            whyItMatters: "Route groups are typically created to isolate layout inheritance. Omitting layout.tsx in a group segment often indicates a missing layout boundary."
          });
        }
      }
    }

    return diagnostics;
  }
};
