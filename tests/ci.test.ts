import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { JsonReport } from "../src/reporters/jsonReporter.js";

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const loader = import.meta.resolve("tsx");

describe("CI analysis", () => {
  let directory: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  }

  function commit(message: string) {
    git("add", ".");
    git("commit", "--quiet", "-m", message);
  }

  function run(args: string[], cwd = directory) {
    return spawnSync(process.execPath, ["--import", loader, cliPath, ...args], {
      cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, env: { ...process.env, CI: "true" },
    });
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "changeradar-ci-"));
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "ChangeRadar Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(directory, "README.md"), "Fixture\n");
    commit("Base");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("supports JSON in default analysis with no findings", () => {
    const result = run(["--format", "json"]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout) as JsonReport;
    expect(report.schemaVersion).toBe(1);
    expect(report.comparison).toEqual({ mode: "working-tree", baseRef: "HEAD", baseCommit: git("rev-parse", "HEAD") });
    expect(report.summary).toEqual({ changedFileCount: 0, findingCount: 0, bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 }, exitCode: result.status });
    expect(report.findings).toEqual([]);
  });

  it("does not fail CI for MEDIUM and LOW findings, in either output format", () => {
    writeFileSync(join(directory, "config.ts"), "process.env.API_KEY;\n");
    writeFileSync(join(directory, "package.json"), '{"dependencies":{"stripe":"1"}}\n');
    commit("Non-blocking impacts");
    const json = run(["analyze", "HEAD~1..HEAD", "--format", "json"]);
    const text = run(["analyze", "HEAD~1..HEAD", "--format", "text"]);
    expect(json.status).toBe(0);
    expect(text.status).toBe(json.status);
    const report = JSON.parse(json.stdout) as JsonReport;
    expect(report.summary).toMatchObject({ findingCount: 2, bySeverity: { HIGH: 0, MEDIUM: 1, LOW: 1 }, exitCode: 0 });
    for (const finding of report.findings) expect(text.stdout).toContain(finding.title);
    expect(text.stdout).not.toContain("\u001b[");
    expect(json.stderr).toBe("");
    expect(text.stderr).toBe("");
  });

  it("writes a complete JSON report even when HIGH findings fail CI", () => {
    mkdirSync(join(directory, "migrations"));
    mkdirSync(join(directory, "pages", "api"), { recursive: true });
    writeFileSync(join(directory, "migrations", "001.sql"), "CREATE TABLE orders (id INT);\n");
    writeFileSync(join(directory, "pages", "api", "orders.ts"), "export const key = process.env.API_KEY;\n");
    writeFileSync(join(directory, "package.json"), '{"dependencies":{"stripe":"git+https://credential-private-value@example.com/repo.git"}}\n');
    writeFileSync(join(directory, "vercel.json"), "{}\n");
    writeFileSync(join(directory, ".env.local"), "SECRET=environment-private-value\n");
    writeFileSync(join(directory, ".env.example"), "API_KEY=template-private-value\n");
    commit("All detector categories");
    const base = git("rev-parse", "HEAD~1");
    const head = git("rev-parse", "HEAD");
    writeFileSync(join(directory, "package.json"), "{malformed local manifest");
    const result = run(["analyze", `${base}...${head}`, "--format", "json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("private-value");
    expect(result.stdout).not.toContain("CREATE TABLE");
    expect(result.stdout).not.toContain("process.env");
    expect(result.stdout).not.toContain(directory);
    expect(result.stdout).not.toContain("\u001b[");
    const report = JSON.parse(result.stdout) as JsonReport;
    expect(report.comparison).toEqual({ mode: "three-dot", baseRef: base, targetRef: head, baseCommit: base, targetCommit: head });
    expect(report.summary).toEqual({ changedFileCount: 6, findingCount: 5, bySeverity: { HIGH: 1, MEDIUM: 3, LOW: 1 }, exitCode: 1 });
    expect(new Set(report.findings.map((finding) => finding.detector)).size).toBe(5);
    expect(report.files).toContainEqual({ status: "added", path: ".env.local" });
    expect(report.suggestedChecks).toHaveLength(5);
    const text = run(["analyze", `${base}...${head}`]);
    expect(text.status).toBe(result.status);
    for (const finding of report.findings) expect(text.stdout).toContain(finding.title);
  });

  it("never emits a partial success document if a detector fails after a HIGH finding", () => {
    mkdirSync(join(directory, "migrations"));
    writeFileSync(join(directory, "migrations", "001.sql"), "CREATE TABLE orders (id INT);\n");
    writeFileSync(join(directory, "broken.ts"), 'const value = "source-private-value');
    git("add", ".");
    const result = run(["analyze", "--format", "json"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('Unable to parse environment references in "broken.ts"');
    expect(result.stderr).not.toContain("source-private-value");
  });

  it.each([
    { args: ["analyze", "missing", "--format", "json"] },
    { args: ["analyze", "HEAD...", "--format", "json"] },
    { args: ["analyze", "--format", "yaml"] },
    { args: ["analyze", "--format"] },
    { args: ["analyze", "--format", "json", "--unknown"] },
  ])("reports usage/reference errors with exit code 2: $args", ({ args }) => {
    const result = run(args);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).not.toContain("at getChanges");
  });

  it("rejects missing shallow-checkout history rather than reporting a clean deployment", () => {
    mkdirSync(join(directory, "migrations"));
    writeFileSync(join(directory, "migrations", "001.sql"), "CREATE TABLE orders (id INT);\n");
    commit("Migration");
    const shallow = join(directory, "shallow");
    git("clone", "--quiet", "--no-local", "--depth=1", directory, shallow);
    const result = run(["analyze", "HEAD~1...HEAD", "--format", "json"], shallow);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("fetch missing history");
    execFileSync("git", ["fetch", "--quiet", "--unshallow"], { cwd: shallow, windowsHide: true, stdio: "pipe" });
    const complete = run(["analyze", "HEAD~1...HEAD", "--format", "json"], shallow);
    expect(complete.status).toBe(1);
    expect((JSON.parse(complete.stdout) as JsonReport).summary).toMatchObject({ findingCount: 1, exitCode: 1 });
  });
});
