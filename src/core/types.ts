export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type ChangedFile =
  | { status: Exclude<ChangeStatus, "renamed">; path: string }
  | { status: "renamed"; path: string; previousPath: string };

export type ChangeComparison =
  | { mode: "working-tree"; baseRef: string; baseCommit: string }
  | {
    mode: "two-dot" | "three-dot";
    baseRef: string;
    targetRef: string;
    // For three-dot comparisons, this is the merge base, not the base ref's tip.
    baseCommit: string;
    targetCommit: string;
  };

export interface ChangeContext {
  repositoryRoot: string;
  files: ChangedFile[];
  diff: string;
  fileContents?: FileContentChange[];
  comparison?: ChangeComparison;
}

export interface FileContentChange {
  path: string;
  previousPath?: string;
  before: string;
  after: string;
}

export type Severity = "LOW" | "MEDIUM" | "HIGH";

export interface Finding {
  detector: string;
  severity: Severity;
  title: string;
  description?: string;
  files: string[];
  suggestedAction?: string;
}

export interface Detector {
  name: string;
  detect(context: ChangeContext): Finding[];
}
