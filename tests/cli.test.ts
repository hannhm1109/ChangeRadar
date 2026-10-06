import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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

  function git(...args: string[]) {
    execFileSync("git", args, { cwd: directory, windowsHide: true, stdio: "pipe" });
  }

  function initializeRepository() {
    git("init", "--quiet");
    git("config", "user.name", "ChangeRadar Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(directory, "README.md"), "Test repository\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Initial fixture");
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

  it("reports a clean repository with exit code 0", () => {
    initializeRepository();
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("0 files changed against HEAD");
    expect(result.stdout).toContain("No changed files to analyze.");
    expect(result.stderr).toBe("");
  });

  it("reports unrelated edits without findings or raw file contents", () => {
    initializeRepository();
    writeFileSync(join(directory, "README.md"), "Content that must not be printed\n");
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 file changed against HEAD");
    expect(result.stdout).toContain("0 deployment impacts detected");
    expect(result.stdout).not.toContain("Content that must not be printed");
  });

  it("reports staged migrations with exit code 1 and one shared deployment check", () => {
    initializeRepository();
    for (const name of ["first", "second"]) {
      const migrationDirectory = join(directory, "prisma", "migrations", name);
      mkdirSync(migrationDirectory, { recursive: true });
      writeFileSync(join(migrationDirectory, "migration.sql"), "CREATE TABLE orders (id INT);\n");
    }
    git("add", "prisma");
    const result = run(["analyze"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 files changed against HEAD");
    expect(result.stdout).toContain("2 deployment impacts detected");
    expect(result.stdout).toContain("\nHIGH\n");
    expect(result.stdout).toContain('"prisma/migrations/first/migration.sql"');
    expect(result.stdout).toContain('"prisma/migrations/second/migration.sql"');
    expect(result.stdout.match(/\[ \]/g)).toHaveLength(1);
    expect(result.stdout).not.toContain("CREATE TABLE");
    expect(result.stderr).toBe("");
  });
});
