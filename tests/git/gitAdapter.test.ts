import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChanges } from "../../src/git/gitAdapter.js";

describe("getChanges with a real repository", () => {
  let directory: string;

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "changeradar-test-"));
    git("init", "--quiet");
    git("config", "user.name", "ChangeRadar Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("config", "diff.renames", "copies");
    writeFileSync(join(directory, "existing.ts"), "export const value = 1;\n");
    writeFileSync(join(directory, "deleted.ts"), "export const deleted = true;\n");
    git("add", ".");
    git("commit", "--quiet", "-m", "Initial fixture");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns empty changes for a clean repository", async () => {
    const context = await getChanges(directory);
    expect(resolve(context.repositoryRoot)).toBe(resolve(directory));
    expect(context.files).toEqual([]);
    expect(context.diff).toBe("");
  });

  it("collects staged and unstaged changes while excluding untracked files", async () => {
    writeFileSync(join(directory, "added file.ts"), "export const added = true;\n");
    git("add", "added file.ts");
    writeFileSync(join(directory, "existing.ts"), "export const value = 2;\n");
    unlinkSync(join(directory, "deleted.ts"));
    writeFileSync(join(directory, "untracked.ts"), "not staged\n");

    const context = await getChanges(directory);
    expect(context.files).toEqual([
      { status: "added", path: "added file.ts" },
      { status: "deleted", path: "deleted.ts" },
      { status: "modified", path: "existing.ts" },
    ]);
    expect(context.diff).toContain("+export const value = 2;");
    expect(context.diff).toContain("+export const added = true;");
    expect(context.diff).toContain("-export const deleted = true;");
    expect(context.diff).not.toContain("untracked.ts");
  });

  it("uses the net working-tree change against HEAD", async () => {
    const original = readFileSync(join(directory, "existing.ts"), "utf8");
    writeFileSync(join(directory, "existing.ts"), "staged edit\n");
    git("add", "existing.ts");
    writeFileSync(join(directory, "existing.ts"), original);
    expect((await getChanges(directory)).files).toEqual([]);
  });

  it("detects renames even when Git is configured to detect copies", async () => {
    git("mv", "existing.ts", "renamed.ts");
    const context = await getChanges(directory);
    expect(context.files).toEqual([
      { status: "renamed", previousPath: "existing.ts", path: "renamed.ts" },
    ]);
    expect(context.diff).toContain("rename to renamed.ts");
  });

  it("analyzes the whole repository when invoked from a subdirectory", async () => {
    const nested = join(directory, "nested");
    mkdirSync(nested);
    writeFileSync(join(directory, "existing.ts"), "changed from outside nested\n");
    expect((await getChanges(nested)).files).toEqual([
      { status: "modified", path: "existing.ts" },
    ]);
  });

  it("reports a directory outside a Git repository", async () => {
    const outside = join(directory, "outside");
    mkdirSync(outside);
    rmSync(join(directory, ".git"), { recursive: true, force: true });
    await expect(getChanges(outside)).rejects.toMatchObject({ code: "NOT_A_REPOSITORY" });
  });

  it("reports a repository without an initial commit", async () => {
    const empty = join(directory, "empty");
    mkdirSync(empty);
    execFileSync("git", ["init", "--quiet"], { cwd: empty, windowsHide: true });
    await expect(getChanges(empty)).rejects.toMatchObject({ code: "NO_COMMITS" });
  });

  it("loads selected before-and-after contents from HEAD and the current working tree", async () => {
    writeFileSync(join(directory, "existing.ts"), "const staged = process.env.STAGED;\n");
    git("add", "existing.ts");
    writeFileSync(join(directory, "existing.ts"), "const current = process.env.CURRENT;\n");
    writeFileSync(join(directory, "unrelated.txt"), "excluded contents\n");
    git("add", "unrelated.txt");
    const context = await getChanges(directory, { includeContent: (path) => path.endsWith(".ts") });
    expect(context.fileContents).toEqual([{
      path: "existing.ts", before: "export const value = 1;\n", after: "const current = process.env.CURRENT;\n",
    }]);
  });

  it("loads empty sides for added and deleted sources and preserves rename paths", async () => {
    writeFileSync(join(directory, "added.ts"), "process.env.NEW_KEY;\n");
    git("add", "added.ts");
    unlinkSync(join(directory, "deleted.ts"));
    git("mv", "existing.ts", "renamed [1].ts");
    const context = await getChanges(directory, { includeContent: (path) => path.endsWith(".ts") });
    expect(context.fileContents).toEqual([
      { path: "added.ts", before: "", after: "process.env.NEW_KEY;\n" },
      { path: "deleted.ts", before: "export const deleted = true;\n", after: "" },
      { path: "renamed [1].ts", previousPath: "existing.ts", before: "export const value = 1;\n", after: "export const value = 1;\n" },
    ]);
  });

  it("excludes real environment-file values from patches while preserving file metadata", async () => {
    writeFileSync(join(directory, ".env.local"), "API_KEY=old-private-value\n");
    git("add", "--force", ".env.local");
    git("commit", "--quiet", "-m", "Track a secret-file fixture");
    writeFileSync(join(directory, ".env.local"), "API_KEY=new-private-value\n");
    writeFileSync(join(directory, ".env.example"), "PUBLIC_NAME=placeholder\n");
    git("add", "--force", ".env.example");
    const context = await getChanges(directory, { includeContent: (path) => path.endsWith(".ts") });
    expect(context.files).toContainEqual({ status: "modified", path: ".env.local" });
    expect(context.diff).not.toContain("private-value");
    expect(context.diff).toContain("PUBLIC_NAME=placeholder");
    expect(context.fileContents).toEqual([]);
    const allContents = await getChanges(directory, { includeContent: () => true });
    expect(allContents.fileContents?.map((file) => file.path)).toEqual([".env.example"]);
    expect(JSON.stringify(allContents.fileContents)).not.toContain("private-value");
  });

  it("does not load the unsupported side of a renamed source", async () => {
    git("mv", "existing.ts", "renamed.txt");
    const context = await getChanges(directory, { includeContent: (path) => path.endsWith(".ts") });
    expect(context.fileContents).toEqual([{
      path: "renamed.txt", previousPath: "existing.ts", before: "export const value = 1;\n", after: "",
    }]);
  });

  it("can skip raw patches without losing changed-file metadata or selected snapshots", async () => {
    writeFileSync(join(directory, "existing.ts"), "process.env.CURRENT;\n");
    const context = await getChanges(directory, { includeDiff: false, includeContent: (path) => path.endsWith(".ts") });
    expect(context.diff).toBe("");
    expect(context.files).toEqual([{ status: "modified", path: "existing.ts" }]);
    expect(context.fileContents).toEqual([{ path: "existing.ts", before: "export const value = 1;\n", after: "process.env.CURRENT;\n" }]);
  });

  it.each([
    { from: ".env.local", to: "config.txt" },
    { from: "config.txt", to: ".env.production" },
    { from: ".env", to: ".env.example" },
  ])("excludes both sides of private-file rename $from -> $to from raw patches", async ({ from, to }) => {
    writeFileSync(join(directory, from), "API_KEY=never-load-this-value\n");
    git("add", "--force", from);
    git("commit", "--quiet", "-m", "Rename fixture");
    git("mv", from, to);
    const context = await getChanges(directory);
    expect(context.files).toEqual([{ status: "renamed", previousPath: from, path: to }]);
    expect(context.diff).toBe("");
    git("commit", "--quiet", "-m", "Rename file");
    const committed = await getChanges(directory, { comparison: "HEAD~1..HEAD" });
    expect(committed.files).toEqual(context.files);
    expect(committed.diff).toBe("");
  });

  it.each(["config.ts", ".env.example", "package.json"])(
    "fails clearly instead of reading private-file contents renamed to %s", async (path) => {
      writeFileSync(join(directory, ".env.local"), "API_KEY=never-load-this-value\n");
      git("add", "--force", ".env.local");
      git("commit", "--quiet", "-m", "Private fixture");
      git("mv", ".env.local", path);
      await expect(getChanges(directory, { includeDiff: false, includeContent: () => true }))
        .rejects.toMatchObject({ code: "SECRET_FILE_RENAME", message: expect.not.stringContaining("never-load-this-value") });
      git("commit", "--quiet", "-m", "Private rename");
      await expect(getChanges(directory, { comparison: "HEAD~1..HEAD", includeContent: () => true }))
        .rejects.toMatchObject({ code: "SECRET_FILE_RENAME" });
    },
  );

  it.each([".env.local\nbackup", ".env.example\n"])("excludes private filename %j in committed trees", async (path) => {
    git("config", "core.protectNTFS", "false");
    const blob = execFileSync("git", ["hash-object", "-w", "--stdin"], {
      cwd: directory, encoding: "utf8", windowsHide: true, input: "API_KEY=never-load-this-value\n",
    }).trim();
    // Build the tree entry directly: this is a valid Git path but cannot be checked out on Windows.
    git("update-index", "--add", "--cacheinfo", `100644,${blob},${path}`);
    git("commit", "--quiet", "-m", "Unusual private-file fixture");
    const context = await getChanges(directory, { comparison: "HEAD~1..HEAD", includeContent: () => true });
    expect(context.files).toEqual([{ status: "added", path }]);
    expect(context.diff).toBe("");
    expect(context.fileContents).toEqual([]);
  });
});
