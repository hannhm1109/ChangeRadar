#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, CommanderError, Option } from "commander";
import { ChangeRadarError } from "./errors/ChangeRadarError.js";
import { getChanges } from "./git/gitAdapter.js";
import { runDetectors } from "./core/runDetectors.js";
import { getAnalysisExitCode } from "./core/exitCodes.js";
import { migrationDetector } from "./detectors/migrationDetector.js";
import { apiRouteDetector } from "./detectors/apiRouteDetector.js";
import { dependencyDetector, isDependencyManifest } from "./detectors/dependencyDetector.js";
import { cronConfigDetector } from "./detectors/cronConfigDetector.js";
import { formatTerminalReport } from "./reporters/terminalReporter.js";
import { formatJsonReport } from "./reporters/jsonReporter.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command()
  .name("changeradar")
  .description("Inspect Git changes for deployment-impacting modifications")
  .version(version)
  .option("--no-color", "Disable terminal colors")
  .addOption(new Option("--format <format>", "Report format").choices(["text", "json"]).default("text"))
  .showHelpAfterError()
  .configureHelp({ showGlobalOptions: true })
  .exitOverride()
  .addHelpText("after", "\nRunning changeradar without a command is equivalent to changeradar analyze.");

program.command("analyze", { isDefault: true })
  .description("Analyze deployment impacts in working-tree or committed changes")
  .argument("[comparison]", "Commit reference, A..B, or A...B (default: HEAD vs working tree)")
  .addHelpText("after", [
    "", "Examples:",
    "  changeradar                         Net staged and unstaged changes against HEAD",
    "  changeradar analyze HEAD~1          Working tree against the previous commit",
    "  changeradar analyze v1.0..HEAD      Committed endpoint comparison",
    "  changeradar analyze main...HEAD     Merge base of main and HEAD to committed HEAD",
    "  changeradar analyze main...HEAD --format json > report.json",
    "", "Ranges require both endpoints and ignore staged/unstaged changes.",
    "Working-tree mode excludes untracked files; stage new files with git add.",
    "Colors are automatic in terminals; CI, --no-color, or NO_COLOR disables them.",
    "JSON reports contain metadata and findings only, never raw diffs or source contents.",
    "Analysis errors leave stdout empty and write diagnostics to stderr, in either format.",
    "Exit codes: 0 = no HIGH findings; 1 = HIGH findings; 2 = usage or tool error.",
  ].join("\n"))
  .action(async (comparison: string | undefined) => {
    const { environmentDetector, isEnvironmentSource } = await import("./detectors/environmentDetector.js");
    const context = await getChanges(process.cwd(), {
      ...(comparison === undefined ? {} : { comparison }),
      includeContent: (path) => isEnvironmentSource(path) || isDependencyManifest(path),
    });
    const findings = runDetectors(context, [
      migrationDetector, environmentDetector, apiRouteDetector, dependencyDetector, cronConfigDetector,
    ]);
    const options = program.opts<{ color: boolean; format: "text" | "json" }>();
    const color = Boolean(process.stdout.isTTY) && options.color && !process.env.CI
      && process.env.NO_COLOR === undefined && process.env.NODE_DISABLE_COLORS === undefined
      && process.env.TERM !== "dumb";
    process.stdout.write(options.format === "json"
      ? formatJsonReport(context, findings) : formatTerminalReport(context, findings, { color }));
    process.exitCode = getAnalysisExitCode(findings);
  });

try {
  await program.parseAsync(process.argv);
} catch (error) {
  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode === 0 ? 0 : 2;
  } else {
    const message = error instanceof ChangeRadarError
      ? error.message
      : "Unexpected error while running ChangeRadar.";
    process.stderr.write(`ChangeRadar: ${message}\n`);
    process.exitCode = 2;
  }
}
