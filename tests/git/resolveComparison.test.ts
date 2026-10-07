import { describe, expect, it, vi } from "vitest";
import { ChangeRadarError } from "../../src/errors/ChangeRadarError.js";
import { resolveComparison } from "../../src/git/resolveComparison.js";

describe("resolveComparison", () => {
  it("verifies commits with an option boundary and uses resolved hashes for merge-base", async () => {
    const runGit = vi.fn<(args: string[]) => Promise<string>>()
      .mockResolvedValueOnce("base-hash\n")
      .mockResolvedValueOnce("target-hash\n")
      .mockResolvedValueOnce("ancestor-hash\n");
    expect(await resolveComparison("main...feature", runGit)).toEqual({
      mode: "three-dot", baseRef: "main", targetRef: "feature", baseCommit: "ancestor-hash", targetCommit: "target-hash",
    });
    expect(runGit.mock.calls).toEqual([
      [["rev-parse", "--verify", "--quiet", "--end-of-options", "main^{commit}"]],
      [["rev-parse", "--verify", "--quiet", "--end-of-options", "feature^{commit}"]],
      [["merge-base", "base-hash", "target-hash"]],
    ]);
  });

  it.each([undefined, "missing"])("classifies missing %s while preserving the cause", async (input) => {
    const cause = new ChangeRadarError("GIT_EXECUTION_FAILED", "Git error", { cause: { code: 1 } });
    await expect(resolveComparison(input, vi.fn().mockRejectedValue(cause)))
      .rejects.toMatchObject({ code: input === undefined ? "NO_COMMITS" : "INVALID_REFERENCE", cause });
  });

  it.each(["GIT_NOT_INSTALLED", "GIT_EXECUTION_FAILED"] as const)("preserves infrastructure errors: %s", async (code) => {
    const error = new ChangeRadarError(code, "Infrastructure error", { cause: { code: "ETIMEDOUT" } });
    await expect(resolveComparison("main", vi.fn().mockRejectedValue(error))).rejects.toBe(error);
    const rangeRunner = vi.fn().mockResolvedValueOnce("base\n").mockResolvedValueOnce("target\n").mockRejectedValueOnce(error);
    await expect(resolveComparison("main...feature", rangeRunner)).rejects.toBe(error);
  });

  it.each(["..HEAD", "HEAD..", "HEAD....HEAD", "HEAD..HEAD..HEAD", "--output=bad", "HEAD\u001b[31m"])(
    "rejects unsafe or unsupported input %j before executing Git", async (input) => {
      const runGit = vi.fn();
      await expect(resolveComparison(input, runGit)).rejects.toMatchObject({ code: "INVALID_COMPARISON" });
      expect(runGit).not.toHaveBeenCalled();
    },
  );
});
