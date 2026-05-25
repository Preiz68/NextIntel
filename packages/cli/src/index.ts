import { Command } from "commander";
import pc from "picocolors";
import { analyzeFiles } from "../../engine/src/analyzer/analyzeFile.js";
import { scanProject } from "../../engine/src/scanner/scanProject.js";
import { buildGraph } from "../../engine/src/graph/buildGraph.js";
import { RuleEngine, rules, renderGroupedDiagnostics } from "../../rules/src/index.js";
import path from "node:path";

const program = new Command();

program
  .name("next-intel")
  .description("Static analysis engine for Next.js projects")
  .version("1.0.0");

program
  .command("analyze")
  .description("Analyze a Next.js project")
  .argument("[path]", "Path to the project root", ".")
  .option("-j, --json", "Output results in JSON format")
  .action(async (projectPath, options) => {
    const root = path.resolve(process.cwd(), projectPath);

    if (!options.json) {
      console.log(pc.cyan(`\n🔍 Analyzing project at: ${pc.bold(root)}\n`));
    }

    try {
      // 1. Scan and Analyze
      const { files } = await scanProject(root, { scanRootFallback: true });
      const analyses = await analyzeFiles(files);
      const { graph, nodes, edges } = buildGraph(analyses, root);

      // 2. Run Rules
      const engine = new RuleEngine();
      for (const rule of rules) {
        engine.registerRule(rule);
      }

      const diagnostics = engine.run({ analyses, graph, nodes, edges });

      // 3. Calculate Score
      const errorCount = diagnostics.filter(
        (d) => d.severity === "error",
      ).length;
      const warningCount = diagnostics.filter(
        (d) => d.severity === "warning",
      ).length;
      const infoCount = diagnostics.filter((d) => d.severity === "info").length;

      const fileCount = files.length;
      const totalIssues = errorCount + warningCount;

      // Simple scoring: start at 100, deduct for each issue weighted by severity
      const rawScore = 100 - errorCount * 10 - warningCount * 3;
      const score = Math.max(0, Math.min(100, rawScore));

      // 4. Output
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              projectPath: root,
              stats: {
                filesAnalyzed: fileCount,
                errors: errorCount,
                warnings: warningCount,
                info: infoCount,
              },
              score,
              diagnostics,
            },
            null,
            2,
          ),
        );
      } else {
        if (diagnostics.length === 0) {
          console.log(
            pc.green("✅ No issues found! Your project looks clean.\n"),
          );
        } else {
          console.log(renderGroupedDiagnostics(diagnostics));

          console.log(pc.bold("\n--- Summary ---"));
          console.log(`Files Analyzed: ${pc.cyan(fileCount)}`);
          console.log(`Errors:         ${pc.red(errorCount)}`);
          console.log(`Warnings:       ${pc.yellow(warningCount)}`);
          console.log(`Info:           ${pc.blue(infoCount)}`);

          const scoreColor =
            score > 80 ? pc.green : score > 50 ? pc.yellow : pc.red;
          console.log(
            `\nIntelligence Score: ${scoreColor(pc.bold(score + "/100"))}\n`,
          );
        }
      }
    } catch (error: any) {
      console.error(pc.red(`\n❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();
