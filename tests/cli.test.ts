import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const loader = import.meta.resolve("tsx");

describe("CLI", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "changeradar-cli-"));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function run(args: string[], env = process.env) {
    return spawnSync(process.execPath, ["--import", loader, cliPath, ...args], {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
      env,
      timeout: 10_000,
    });
  }

  it("displays help without requiring a Git repository", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("analyze");
    expect(result.stderr).toBe("");
  });

  it("displays the package version", () => {
    const result = run(["--version"]);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  it("rejects unsupported reference input with exit code 2", () => {
    const result = run(["analyze", "HEAD~1"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("too many arguments");
  });

  it("reports a repository error without a stack trace", () => {
    const result = run(["analyze"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Not a Git repository");
    expect(result.stderr).not.toContain("at getChanges");
  });

  it("reports missing Git with exit code 2", () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH"),
    );
    const result = run(["analyze"], { ...env, PATH: "" });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("Git could not be started");
  });
});
