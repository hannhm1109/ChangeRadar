#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command, CommanderError } from "commander";
import { ChangeRadarError } from "./errors/ChangeRadarError.js";
import { getChanges } from "./git/gitAdapter.js";

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
  .description("List staged and unstaged tracked-file changes against HEAD")
  .addHelpText("after", "\nNew files must be staged with git add to appear in the analysis.")
  .action(async () => {
    const context = await getChanges();
    const count = context.files.length;
    const lines = ["ChangeRadar", "", `${count} ${count === 1 ? "file" : "files"} changed against HEAD`];
    for (const file of context.files) {
      const path = JSON.stringify(file.path);
      lines.push(file.status === "renamed"
        ? `  renamed   ${JSON.stringify(file.previousPath)} -> ${path}`
        : `  ${file.status.padEnd(9)} ${path}`);
    }
    lines.push("", "Deployment detectors are not implemented yet.");
    process.stdout.write(`${lines.join("\n")}\n`);
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
