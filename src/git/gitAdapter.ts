import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ChangeContext } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";
import { parseNameStatus } from "./parseNameStatus.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    });
    return stdout;
  } catch (cause) {
    const error = cause as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      throw new ChangeRadarError(
        "GIT_NOT_INSTALLED",
        "Git could not be started. Install Git and ensure it is on your PATH.",
        { cause },
      );
    }
    throw new ChangeRadarError(
      "GIT_EXECUTION_FAILED",
      "Unable to read Git changes. Check repository access and the size of the diff.",
      { cause },
    );
  }
}

function gitStderr(error: unknown): string {
  if (!(error instanceof ChangeRadarError)) return "";
  const cause = error.cause as { stderr?: unknown } | undefined;
  return typeof cause?.stderr === "string" ? cause.stderr : "";
}

/** Reads the net staged and unstaged changes to tracked files against HEAD. */
export async function getChanges(cwd = process.cwd()): Promise<ChangeContext> {
  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(["rev-parse", "--show-toplevel"], cwd))
      .replace(/\r?\n$/, "");
  } catch (cause) {
    if (gitStderr(cause).includes("not a git repository")) {
      throw new ChangeRadarError(
        "NOT_A_REPOSITORY",
        "Not a Git repository. Run ChangeRadar inside a Git working tree.",
        { cause },
      );
    }
    throw cause;
  }

  try {
    await runGit(["rev-parse", "--verify", "HEAD"], repositoryRoot);
  } catch (cause) {
    if (gitStderr(cause).includes("Needed a single revision")) {
      throw new ChangeRadarError(
        "NO_COMMITS",
        "This repository has no commits yet. Create an initial commit before analyzing changes.",
        { cause },
      );
    }
    throw cause;
  }

  const diffOptions = ["--no-ext-diff", "--no-textconv", "--find-renames", "--ignore-submodules=none"];
  const nameStatus = await runGit(
    ["diff", ...diffOptions, "--name-status", "-z", "HEAD", "--"],
    repositoryRoot,
  );
  const files = parseNameStatus(nameStatus);
  const diff = files.length === 0 ? "" : await runGit(
    ["diff", ...diffOptions, "--no-color", "--unified=0", "HEAD", "--"],
    repositoryRoot,
  );

  return { repositoryRoot, files, diff };
}
