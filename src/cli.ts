#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { ChangeRadarError } from "./errors/ChangeRadarError.js";
import { getChanges } from "./git/gitAdapter.js";
import { runDetectors } from "./core/runDetectors.js";
import { migrationDetector } from "./detectors/migrationDetector.js";
import { apiRouteDetector } from "./detectors/apiRouteDetector.js";
import { dependencyDetector, isDependencyManifest } from "./detectors/dependencyDetector.js";
import { cronConfigDetector } from "./detectors/cronConfigDetector.js";
import { formatTerminalReport } from "./reporters/terminalReporter.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command()
  .name("changeradar")
  .description("Inspect Git changes for deployment-impacting modifications")
  .version(version)
  .option("--no-color", "Disable terminal colors")
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
    "", "Ranges require both endpoints and ignore staged/unstaged changes.",
    "Working-tree mode excludes untracked files; stage new files with git add.",
    "Colors are automatic in terminals; --no-color or NO_COLOR disables them.",
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
    const color = Boolean(process.stdout.isTTY) && program.opts<{ color: boolean }>().color
      && process.env.NO_COLOR === undefined && process.env.NODE_DISABLE_COLORS === undefined
      && process.env.TERM !== "dumb";
    process.stdout.write(formatTerminalReport(context, findings, { color }));
    process.exitCode = findings.some((finding) => finding.severity === "HIGH") ? 1 : 0;
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
