#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { ChangeRadarError } from "./errors/ChangeRadarError.js";
import { getChanges } from "./git/gitAdapter.js";
import { runDetectors } from "./core/runDetectors.js";
import { migrationDetector } from "./detectors/migrationDetector.js";
import { formatTerminalReport } from "./reporters/terminalReporter.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command()
  .name("changeradar")
  .description("Inspect Git changes for deployment-impacting modifications")
  .version(version)
  .showHelpAfterError()
  .exitOverride();

program.command("analyze")
  .description("Analyze staged and unstaged tracked-file changes against HEAD")
  .addHelpText("after", "\nNew files must be staged with git add to appear in the analysis.")
  .action(async () => {
    const context = await getChanges();
    const findings = runDetectors(context, [migrationDetector]);
    process.stdout.write(formatTerminalReport(context, findings));
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
