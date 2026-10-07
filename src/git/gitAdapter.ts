import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChangeComparison, ChangeContext, ChangedFile, FileContentChange } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";
import { parseNameStatus } from "./parseNameStatus.js";
import { resolveComparison } from "./resolveComparison.js";

const execFileAsync = promisify(execFile);

export interface GitChangeOptions {
  comparison?: string;
  includeContent?: (path: string) => boolean;
}

function isSecretEnvironmentFile(path: string): boolean {
  return /(?:^|\/)\.env(?:\..*)?$/.test(path) && !/(?:^|\/)\.env\.example$/.test(path);
}

async function readWorkingFile(repositoryRoot: string, path: string): Promise<string> {
  try {
    const absolutePath = join(repositoryRoot, path);
    const info = await lstat(absolutePath);
    // Do not follow source-file symlinks into secret files or external locations.
    if (!info.isFile()) return "";
    if (info.size > 20 * 1024 * 1024) throw new Error("File exceeds the content limit");
    return await readFile(absolutePath, "utf8");
  } catch (cause) {
    throw new ChangeRadarError(
      "FILE_READ_FAILED",
      `Unable to read changed file ${JSON.stringify(path)}. Check access and file size.`,
      { cause },
    );
  }
}

async function readCommittedFile(repositoryRoot: string, path: string, commit: string): Promise<string> {
  const entry = await runGit(["ls-tree", "-z", commit, "--", `:(literal)${path}`], repositoryRoot);
  if (!entry.startsWith("100")) return "";
  return runGit(["show", `${commit}:${path}`], repositoryRoot);
}

async function readContentChange(
  repositoryRoot: string,
  file: ChangedFile,
  includeContent: (path: string) => boolean,
  comparison: ChangeComparison,
): Promise<FileContentChange> {
  const previousPath = file.status === "renamed" ? file.previousPath : file.path;
  const before = file.status !== "added" && includeContent(previousPath)
    ? await readCommittedFile(repositoryRoot, previousPath, comparison.baseCommit)
    : "";
  const after = file.status !== "deleted" && includeContent(file.path)
    ? comparison.mode === "working-tree"
      ? await readWorkingFile(repositoryRoot, file.path)
      : await readCommittedFile(repositoryRoot, file.path, comparison.targetCommit)
    : "";
  return file.status === "renamed"
    ? { path: file.path, previousPath, before, after }
    : { path: file.path, before, after };
}

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

/** Reads working-tree changes against a ref, or committed changes between range endpoints. */
export async function getChanges(cwd = process.cwd(), options: GitChangeOptions = {}): Promise<ChangeContext> {
  let repositoryRoot: string;
  try {
    repositoryRoot = (await runGit(["rev-parse", "--show-toplevel"], cwd))
      .replace(/\r?\n$/, "");
  } catch (cause) {
    if (gitStderr(cause).includes("not a git repository")
      || gitStderr(cause).includes("must be run in a work tree")) {
      throw new ChangeRadarError(
        "NOT_A_REPOSITORY",
        "Not a Git repository. Run ChangeRadar inside a Git working tree.",
        { cause },
      );
    }
    throw cause;
  }

  const comparison = await resolveComparison(options.comparison,
    (args) => runGit(args, repositoryRoot));
  const revisions = comparison.mode === "working-tree"
    ? [comparison.baseCommit] : [comparison.baseCommit, comparison.targetCommit];

  const diffOptions = ["--no-ext-diff", "--no-textconv", "--find-renames", "--no-relative", "--ignore-submodules=none"];
  const nameStatus = await runGit(
    ["diff", ...diffOptions, "--name-status", "-z", ...revisions, "--"],
    repositoryRoot,
  );
  const files = parseNameStatus(nameStatus);
  const secretPaths = new Set(files.flatMap((file) => file.status === "renamed"
    ? [file.previousPath, file.path] : [file.path]).filter(isSecretEnvironmentFile));
  const diff = files.length === 0 ? "" : await runGit(
    ["diff", ...diffOptions, "--no-color", "--unified=0", ...revisions, "--", ".",
      ...[...secretPaths].map((path) => `:(exclude,literal)${path}`)],
    repositoryRoot,
  );

  const context: ChangeContext = { repositoryRoot, files, diff, comparison };
  const contentFilter = options.includeContent;
  if (contentFilter) {
    const includeContent = (path: string) => !isSecretEnvironmentFile(path) && contentFilter(path);
    context.fileContents = [];
    for (const file of files) {
      if (includeContent(file.path)
        || (file.status === "renamed" && includeContent(file.previousPath))) {
        context.fileContents.push(await readContentChange(repositoryRoot, file, includeContent, comparison));
      }
    }
  }
  return context;
}
