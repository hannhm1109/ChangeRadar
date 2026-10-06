export type ChangeStatus = "added" | "modified" | "deleted" | "renamed";

export type ChangedFile =
  | { status: Exclude<ChangeStatus, "renamed">; path: string }
  | { status: "renamed"; path: string; previousPath: string };

export interface ChangeContext {
  repositoryRoot: string;
  files: ChangedFile[];
  diff: string;
}
