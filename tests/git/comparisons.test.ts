import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getChanges } from "../../src/git/gitAdapter.js";

describe("Git comparisons with real history", () => {
  let directory: string;
  const initialSource = "process.env.EXISTING;\n";

  function git(...args: string[]): string {
    return execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true, stdio: "pipe" }).trim();
  }

  function commit(message: string) {
    git("add", ".");
    git("commit", "--quiet", "-m", message);
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "changeradar-comparison-"));
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.name", "ChangeRadar Test");
    git("config", "user.email", "test@example.com");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(directory, "config.ts"), initialSource);
    writeFileSync(join(directory, "deleted.ts"), "export const deleted = true;\n");
    commit("Initial fixture");
    git("tag", "base");
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("compares a single reference to net working-tree contents including committed changes", async () => {
    writeFileSync(join(directory, "config.ts"), "process.env.COMMITTED;\n");
    commit("Committed edit");
    writeFileSync(join(directory, "config.ts"), "process.env.STAGED;\n");
    git("add", "config.ts");
    writeFileSync(join(directory, "config.ts"), "process.env.CURRENT;\n");
    const context = await getChanges(directory, { comparison: "HEAD~1", includeContent: () => true });
    expect(context.comparison).toEqual({ mode: "working-tree", baseRef: "HEAD~1", baseCommit: git("rev-parse", "base") });
    expect(context.fileContents).toEqual([{ path: "config.ts", before: initialSource, after: "process.env.CURRENT;\n" }]);
    expect(context.diff).toContain("+process.env.CURRENT;");
    expect(context.diff).not.toContain("STAGED");
  });

  it.each(["base..HEAD", "base...HEAD"])("pins committed endpoints for %s and ignores index/disk contents", async (comparison) => {
    writeFileSync(join(directory, "config.ts"), "process.env.COMMITTED;\n");
    commit("Committed edit");
    const targetCommit = git("rev-parse", "HEAD");
    writeFileSync(join(directory, "config.ts"), "process.env.STAGED;\n");
    git("add", "config.ts");
    unlinkSync(join(directory, "config.ts"));
    writeFileSync(join(directory, "local.ts"), "invalid local source");
    git("add", "local.ts");
    const context = await getChanges(directory, { comparison, includeContent: () => true });
    expect(context.files).toEqual([{ status: "modified", path: "config.ts" }]);
    expect(context.comparison).toMatchObject({ baseRef: "base", targetRef: "HEAD", baseCommit: git("rev-parse", "base"), targetCommit });
    expect(context.fileContents).toEqual([{ path: "config.ts", before: initialSource, after: "process.env.COMMITTED;\n" }]);
    expect(context.diff).toContain("+process.env.COMMITTED;");
    expect(context.diff).not.toContain("STAGED");
    expect(context.diff).not.toContain("local.ts");
  });

  it("reads a historical target, including additions, deletions, and renames, without checking it out", async () => {
    git("mv", "config.ts", "renamed [1].ts");
    unlinkSync(join(directory, "deleted.ts"));
    writeFileSync(join(directory, "added.ts"), "process.env.ADDED;\n");
    commit("Historical target");
    git("tag", "-a", "release", "-m", "Annotated release");
    writeFileSync(join(directory, "added.ts"), "process.env.LATER;\n");
    commit("Later HEAD");
    const context = await getChanges(directory, { comparison: "base..release", includeContent: () => true });
    expect(context.fileContents).toEqual([
      { path: "added.ts", before: "", after: "process.env.ADDED;\n" },
      { path: "deleted.ts", before: "export const deleted = true;\n", after: "" },
      { path: "renamed [1].ts", previousPath: "config.ts", before: initialSource, after: initialSource },
    ]);
    expect(context.comparison).toMatchObject({ targetCommit: git("rev-parse", "release^{commit}") });
    expect(context.diff).not.toContain("LATER");
  });

  it("uses the common ancestor for three-dot comparisons of divergent branches", async () => {
    git("checkout", "--quiet", "-b", "feature");
    writeFileSync(join(directory, "feature.ts"), "process.env.FEATURE;\n");
    commit("Feature edit");
    git("checkout", "--quiet", "main");
    writeFileSync(join(directory, "main.ts"), "process.env.MAIN;\n");
    commit("Main edit");
    const twoDot = await getChanges(directory, { comparison: "main..feature", includeContent: () => true });
    const threeDot = await getChanges(directory, { comparison: "main...feature", includeContent: () => true });
    expect(twoDot.files).toEqual([{ status: "added", path: "feature.ts" }, { status: "deleted", path: "main.ts" }]);
    expect(threeDot.files).toEqual([{ status: "added", path: "feature.ts" }]);
    expect(threeDot.fileContents).toEqual([{ path: "feature.ts", before: "", after: "process.env.FEATURE;\n" }]);
    expect(threeDot.comparison).toMatchObject({ mode: "three-dot", baseCommit: git("rev-parse", "base"), targetCommit: git("rev-parse", "feature") });
  });

  it("retains secret-file exclusions for committed comparisons", async () => {
    writeFileSync(join(directory, ".env.local"), "SECRET=never-print-this\n");
    writeFileSync(join(directory, ".env.example"), "NEW_NAME=placeholder\n");
    git("add", "--force", ".env.local", ".env.example");
    git("commit", "--quiet", "-m", "Environment fixtures");
    const context = await getChanges(directory, { comparison: "base..HEAD", includeContent: () => true });
    expect(context.files).toContainEqual({ status: "added", path: ".env.local" });
    expect(context.diff).not.toContain("never-print-this");
    expect(context.fileContents).toEqual([{ path: ".env.example", before: "", after: "NEW_NAME=placeholder\n" }]);
  });

  it("analyzes committed comparisons from subdirectories despite diff.relative configuration", async () => {
    mkdirSync(join(directory, "nested"));
    writeFileSync(join(directory, "config.ts"), "process.env.NEW;\n");
    commit("Root source edit");
    git("config", "diff.relative", "true");
    const context = await getChanges(join(directory, "nested"), { comparison: "base..HEAD" });
    expect(context.files).toEqual([{ status: "modified", path: "config.ts" }]);
    expect(context.diff).toContain("+process.env.NEW;");
  });

  it.each(["missing", "HEAD~99", "HEAD^{tree}", "HEAD:config.ts", "base..missing", "missing...HEAD"])(
    "rejects a missing or non-commit reference in %s", async (comparison) => {
      await expect(getChanges(directory, { comparison })).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
    },
  );

  it.each(["", " ", "..HEAD", "HEAD...", "HEAD....HEAD", "HEAD..HEAD..HEAD", "--output=unwanted", "HEAD\n"])(
    "rejects malformed comparison %j", async (comparison) => {
      await expect(getChanges(directory, { comparison })).rejects.toMatchObject({ code: "INVALID_COMPARISON" });
    },
  );

  it("reports unrelated histories and still allows an explicit two-dot comparison", async () => {
    git("checkout", "--quiet", "--orphan", "unrelated");
    git("rm", "-rf", ".");
    writeFileSync(join(directory, "unrelated.txt"), "Other history\n");
    commit("Unrelated root");
    await expect(getChanges(directory, { comparison: "main...unrelated" })).rejects.toMatchObject({ code: "NO_MERGE_BASE" });
    expect((await getChanges(directory, { comparison: "main..unrelated" })).files.length).toBeGreaterThan(0);
  });

  it("accepts a detached commit hash and returns no changes for equal endpoints", async () => {
    const commitHash = git("rev-parse", "HEAD");
    git("checkout", "--quiet", "--detach", commitHash);
    expect((await getChanges(directory, { comparison: `${commitHash}..HEAD` })).files).toEqual([]);
  });

  it("directs users of bare repositories to a working tree", async () => {
    const bare = join(directory, "bare.git");
    execFileSync("git", ["init", "--quiet", "--bare", bare], { windowsHide: true, stdio: "pipe" });
    await expect(getChanges(bare)).rejects.toMatchObject({ code: "NOT_A_REPOSITORY", message: expect.stringContaining("working tree") });
  });

  it("rejects unresolved index conflicts in working-tree mode but allows committed comparisons", async () => {
    git("checkout", "--quiet", "-b", "feature");
    writeFileSync(join(directory, "config.ts"), "process.env.FEATURE;\n");
    commit("Feature edit");
    git("checkout", "--quiet", "main");
    writeFileSync(join(directory, "config.ts"), "process.env.MAIN;\n");
    commit("Main edit");
    expect(() => git("merge", "--no-edit", "feature")).toThrow();
    // A resolved-looking file still has unmerged index entries until it is staged.
    writeFileSync(join(directory, "config.ts"), "process.env.RESOLVED;\n");
    await expect(getChanges(directory, { includeDiff: false })).rejects.toMatchObject({ code: "UNMERGED_CHANGES" });
    await expect(getChanges(directory, { comparison: "base", includeDiff: false })).rejects.toMatchObject({ code: "UNMERGED_CHANGES" });
    const committed = await getChanges(directory, { comparison: "main...feature", includeContent: () => true });
    expect(committed.fileContents).toEqual([{ path: "config.ts", before: initialSource, after: "process.env.FEATURE;\n" }]);
    git("add", "config.ts");
    expect((await getChanges(directory)).files).toEqual([{ status: "modified", path: "config.ts" }]);
  });
});
