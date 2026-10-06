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
});
