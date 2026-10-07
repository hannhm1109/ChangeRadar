import type { ChangeComparison } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

type GitRunner = (args: string[]) => Promise<string>;

function exitedWith(error: unknown, code: number): boolean {
  return error instanceof ChangeRadarError && error.code === "GIT_EXECUTION_FAILED"
    && (error.cause as { code?: unknown } | undefined)?.code === code;
}

function invalidComparison(input: string): never {
  throw new ChangeRadarError("INVALID_COMPARISON",
    `Invalid comparison ${JSON.stringify(input)}. Use a commit reference, A..B, or A...B with both endpoints specified.`);
}

async function resolveCommit(ref: string, runGit: GitRunner, defaultHead = false): Promise<string> {
  if (!ref.trim() || ref.startsWith("-") || /[\u0000-\u001f\u007f-\u009f]/.test(ref)) {
    invalidComparison(ref);
  }
  try {
    return (await runGit(["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`])).trim();
  } catch (cause) {
    if (!exitedWith(cause, 1)) throw cause;
    if (defaultHead) {
      throw new ChangeRadarError("NO_COMMITS",
        "This repository has no commits yet. Create an initial commit before analyzing changes.", { cause });
    }
    throw new ChangeRadarError("INVALID_REFERENCE",
      `Cannot resolve ${JSON.stringify(ref)} to a commit. Check the reference and fetch missing history if needed.`,
      { cause });
  }
}

export async function resolveComparison(input: string | undefined, runGit: GitRunner): Promise<ChangeComparison> {
  const parts = (input ?? "HEAD").split(/(\.{2,})/);
  const baseRef = parts[0]!;
  if (parts.length === 1) {
    return { mode: "working-tree", baseRef, baseCommit: await resolveCommit(baseRef, runGit, input === undefined) };
  }
  const separator = parts[1];
  const targetRef = parts[2];
  if (parts.length !== 3 || (separator !== ".." && separator !== "...") || !baseRef || !targetRef) {
    invalidComparison(input!);
  }
  let baseCommit = await resolveCommit(baseRef, runGit);
  const targetCommit = await resolveCommit(targetRef, runGit);
  if (separator === "...") {
    try {
      baseCommit = (await runGit(["merge-base", baseCommit, targetCommit])).trim();
    } catch (cause) {
      if (!exitedWith(cause, 1)) throw cause;
      throw new ChangeRadarError("NO_MERGE_BASE",
        `No common ancestor for ${JSON.stringify(baseRef)} and ${JSON.stringify(targetRef)}. Fetch missing history or use A..B for an endpoint comparison.`,
        { cause });
    }
  }
  return { mode: separator === ".." ? "two-dot" : "three-dot", baseRef, targetRef, baseCommit, targetCommit };
}
