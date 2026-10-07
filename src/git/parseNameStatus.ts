import type { ChangedFile } from "../core/types.js";
import { ChangeRadarError } from "../errors/ChangeRadarError.js";

function invalidOutput(): never {
  throw new ChangeRadarError(
    "INVALID_GIT_OUTPUT",
    "Unable to parse Git changes: unexpected name-status output.",
  );
}

/** Parses `git diff --name-status -z` without splitting or trimming paths. */
export function parseNameStatus(output: string): ChangedFile[] {
  if (output === "") return [];
  if (!output.endsWith("\0")) invalidOutput();

  const fields = output.slice(0, -1).split("\0");
  const files: ChangedFile[] = [];
  let index = 0;

  function nextField(): string {
    const value = fields[index++];
    if (value === undefined || value === "") invalidOutput();
    return value;
  }

  while (index < fields.length) {
    const status = nextField();

    if (/^R(?:100|[0-9]{1,2})$/.test(status)) {
      const previousPath = nextField();
      files.push({ status: "renamed", previousPath, path: nextField() });
      continue;
    }

    switch (status) {
      case "A":
        files.push({ status: "added", path: nextField() });
        break;
      case "M":
      case "T":
        files.push({ status: "modified", path: nextField() });
        break;
      case "D":
        files.push({ status: "deleted", path: nextField() });
        break;
      case "U":
        nextField();
        throw new ChangeRadarError("UNMERGED_CHANGES",
          "Unresolved Git merge conflicts. Resolve and stage conflicted files before analyzing working-tree changes, or use a committed range.");
      default:
        invalidOutput();
    }
  }

  return files;
}
