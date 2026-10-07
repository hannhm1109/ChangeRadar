import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
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

  it("reports environment names once across source and example files without values", () => {
    initializeRepository();
    writeFileSync(join(directory, "config.ts"), "const key = process.env.PAYMENT_API_KEY;\n");
    writeFileSync(join(directory, ".env.example"), "PAYMENT_API_KEY=example-private-value\n");
    writeFileSync(join(directory, ".env.local"), "REAL_SECRET=actual-private-value\n");
    git("add", "--force", "config.ts", ".env.example", ".env.local");
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 deployment impact detected");
    expect(result.stdout).toContain("\nMEDIUM\n");
    expect(result.stdout).toContain("New environment variable detected: PAYMENT_API_KEY");
    expect(result.stdout).toContain('"config.ts"');
    expect(result.stdout).toContain('".env.example"');
    expect(result.stdout).not.toContain("REAL_SECRET");
    expect(result.stdout).not.toContain("private-value");
    expect(result.stderr).toBe("");
  });

  it("reports only new environment names after unstaged edits to committed code", () => {
    initializeRepository();
    writeFileSync(join(directory, "config.ts"), "const existing = process.env.EXISTING;\n");
    git("add", "config.ts");
    git("commit", "--quiet", "-m", "Existing environment reference");
    writeFileSync(join(directory, "config.ts"), "const renamed = process.env.EXISTING;\nconst added = process.env.ADDED;\n");
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("New environment variable detected: ADDED");
    expect(result.stdout).not.toContain("EXISTING");
  });

  it("reports both detectors and retains the HIGH exit code", () => {
    initializeRepository();
    mkdirSync(join(directory, "database", "migrations"), { recursive: true });
    writeFileSync(join(directory, "database", "migrations", "001.sql"), "CREATE TABLE orders (id INT);\n");
    writeFileSync(join(directory, "config.js"), "process.env.API_URL;\n");
    git("add", ".");
    const result = run(["analyze"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("2 deployment impacts detected");
    expect(result.stdout).toContain("Database migration added");
    expect(result.stdout).toContain("New environment variable detected: API_URL");
    expect(result.stdout.indexOf("\nHIGH\n")).toBeLessThan(result.stdout.indexOf("\nMEDIUM\n"));
  });

  it("reports modified, deleted, and moved migration files through Git", () => {
    initializeRepository();
    mkdirSync(join(directory, "migrations"));
    for (const name of ["modified", "deleted", "moved"]) {
      writeFileSync(join(directory, "migrations", `${name}.sql`), `-- ${name}\nCREATE TABLE ${name} (id INT);\n`);
    }
    git("add", "migrations");
    git("commit", "--quiet", "-m", "Existing migrations");
    writeFileSync(join(directory, "migrations", "modified.sql"), "-- modified\nCREATE TABLE modified (id TEXT);\n");
    unlinkSync(join(directory, "migrations", "deleted.sql"));
    git("mv", "migrations/moved.sql", "archived.sql");
    const result = run(["analyze"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("3 deployment impacts detected");
    expect(result.stdout).toContain("Database migration modified");
    expect(result.stdout).toContain("Database migration deleted");
    expect(result.stdout).toContain("Database migration renamed");
    expect(result.stdout).toContain("Moved out of a migration directory.");
  });

  it("fails with a useful syntax error without exposing source contents", () => {
    initializeRepository();
    writeFileSync(join(directory, "broken.ts"), 'const token = "never-print-this-value');
    git("add", "broken.ts");
    const result = run(["analyze"]);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('Unable to parse environment references in "broken.ts"');
    expect(result.stderr).not.toContain("never-print-this-value");
    expect(result.stderr).not.toContain("SyntaxError");
  });

  it("reports added App and Pages routes alongside environment and migration findings", () => {
    initializeRepository();
    mkdirSync(join(directory, "app", "api", "orders"), { recursive: true });
    mkdirSync(join(directory, "pages", "api"), { recursive: true });
    mkdirSync(join(directory, "migrations"));
    writeFileSync(join(directory, "app", "api", "orders", "route.ts"),
      "export function GET() { return Response.json({ key: process.env.API_KEY }); }\n");
    writeFileSync(join(directory, "pages", "api", "health.js"),
      "export default function handler(req, res) { res.json({ healthy: true }); }\n");
    writeFileSync(join(directory, "migrations", "001.sql"), "CREATE TABLE orders (id INT);\n");
    git("add", ".");
    const result = run(["analyze"]);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("4 deployment impacts detected");
    expect(result.stdout).toContain("API route added: /api/orders");
    expect(result.stdout).toContain("API route added: /api/health");
    expect(result.stdout).toContain("New environment variable detected: API_KEY");
    expect(result.stdout).toContain("Database migration added");
    expect(result.stderr).toBe("");
  });

  it("reports modified, deleted, and renamed src API routes with exit code 0", () => {
    initializeRepository();
    mkdirSync(join(directory, "src", "app", "api", "orders"), { recursive: true });
    mkdirSync(join(directory, "src", "pages", "api"), { recursive: true });
    const appPath = join(directory, "src", "app", "api", "orders", "route.ts");
    writeFileSync(appPath, "export function GET() { return Response.json({ version: 1 }); }\n");
    writeFileSync(join(directory, "src", "pages", "api", "removed.ts"),
      "export default function removed(req, res) { res.json({ removed: true }); }\n");
    writeFileSync(join(directory, "src", "pages", "api", "old.ts"),
      "export default function renamed(req, res) { res.json({ renamed: true }); }\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Existing routes");
    writeFileSync(appPath, "export function GET() { return Response.json({ version: 2 }); }\n");
    unlinkSync(join(directory, "src", "pages", "api", "removed.ts"));
    git("mv", "src/pages/api/old.ts", "src/pages/api/new.ts");
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("3 deployment impacts detected");
    expect(result.stdout).toContain("API route modified: /api/orders");
    expect(result.stdout).toContain("API route deleted: /api/removed");
    expect(result.stdout).toContain("API route renamed: /api/old -> /api/new");
    expect(result.stdout).toContain('"src/pages/api/old.ts"');
    expect(result.stdout).toContain('"src/pages/api/new.ts"');
    expect(result.stderr).toBe("");
  });

  it("reports a Pages-to-App move without claiming that the URL changed", () => {
    initializeRepository();
    mkdirSync(join(directory, "pages", "api"), { recursive: true });
    writeFileSync(join(directory, "pages", "api", "orders.js"),
      "export function GET() { return Response.json({ orders: [] }); }\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Existing route");
    mkdirSync(join(directory, "app", "api", "orders"), { recursive: true });
    git("mv", "pages/api/orders.js", "app/api/orders/route.ts");
    const result = run(["analyze"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 deployment impact detected");
    expect(result.stdout).toContain("API route modified: /api/orders");
    expect(result.stdout).toContain("Route file renamed; URL pattern is unchanged.");
    expect(result.stdout).not.toContain("API route renamed:");
    expect(result.stderr).toBe("");
  });
});
